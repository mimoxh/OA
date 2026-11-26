package com.oa.suite.mobile;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 后台推送：前台服务（specialUse）常驻一条 /rt?client=bg WebSocket。
 * 认证复用 WebView 的会话 Cookie（CookieManager 可读 httpOnly Cookie）→ GET /api/realtime-token 换 rt 令牌。
 * 服务端按 src/lib/push/rules.ts 算好提醒（标题、渠道、免打扰 / @ / 本人 / 机器人规则）后发 push.notify，
 * 这里只负责显示；重连后用 /api/push/missed 补拉断线期间漏掉的提醒。后台连接不计入在线状态。
 */
public class RtService extends Service {

    private static final String TAG = "OARt";
    private static final int ONGOING_ID = 1;
    private static final long MAX_BACKOFF_MS = 60_000;
    /** “登录已失效”提醒占用的通知 tag（与会话 id 不冲突） */
    private static final String AUTH_TAG = "oa-auth";

    // 诊断状态（OAShell.getState / getPushState 读取）
    private static volatile String state = "stopped";
    private static volatile String lastError = null;
    private static volatile String server = null;
    private static volatile long connectedAt = 0;
    private static volatile long lastEventAt = 0;
    private static volatile int connects = 0;
    private static volatile int notified = 0;
    private static volatile int events = 0;
    private static volatile boolean pushCapable = false;
    private static volatile int missedShown = 0;
    private static volatile long lastNotifyAt = 0;
    private static volatile int tokenRequests = 0;

    private static volatile RtService instance;

    private OkHttpClient http;
    private HandlerThread thread;
    private Handler handler;
    private WebSocket ws;
    private int attempt = 0;
    private boolean fetchingToken = false;
    private String meId;
    /** 当前连接换令牌时用的 Cookie：页面里退出 / 换账号后 Cookie 会变，据此重新确认身份 */
    private String connectedCookie;
    /** 每次作废身份时加一，丢弃作废之前发出的令牌请求结果 */
    private int generation = 0;
    private final PushSession session = new PushSession();
    private Network lastNetwork;
    private ConnectivityManager.NetworkCallback netCallback;
    /** 会话 → 已提醒过的最大 seq：补拉与实时推送可能重叠（补拉请求发出时连接已建立），按 seq 去重 */
    private final Map<String, Integer> shownSeq = new HashMap<>();
    private final Runnable connectTask = this::connect;

    /** 是否应保持后台连接：已选服务器、未关闭后台保活、未关闭“我的 → 通知”总开关 */
    static boolean shouldRun(Context c) {
        return ServerStore.getServerUrl(c) != null && ServerStore.isKeepAlive(c) && ServerStore.isNotifyEnabled(c);
    }

    static void start(Context c) {
        try {
            ContextCompat.startForegroundService(c, new Intent(c, RtService.class));
        } catch (Exception e) {
            // Android 12+ 后台启动前台服务会抛 ForegroundServiceStartNotAllowedException
            lastError = "启动前台服务失败：" + e.getMessage();
            Log.w(TAG, lastError, e);
        }
    }

    /** 按当前设置启动或停止服务 */
    static void sync(Context c) {
        if (shouldRun(c)) start(c);
        else stop(c);
    }

    /**
     * App 回到前台或切到后台时调用：服务已在运行且当前未连接（例如刚登录）就立即重连，而不是等退避计时器；
     * 页面里的登录 Cookie 变了（退出、换账号）就断开旧连接重新换令牌，由令牌里的 userId 判断是否换了账号。
     */
    static void kick() {
        RtService s = instance;
        if (s == null) return;
        s.handler.post(() -> {
            if (server == null) return;
            String cookie = CookieManager.getInstance().getCookie(server);
            if (cookie == null || cookie.isEmpty()) {
                if (s.ws != null || s.meId != null) s.signOut("已退出登录");
                return;
            }
            if (s.ws != null && !cookie.equals(s.connectedCookie)) s.closeSocket();
            if (s.ws == null) {
                s.attempt = 0;
                s.schedule(0);
            }
        });
    }

    /**
     * 页面报告当前登录账号（RealtimeProvider 挂载时）或退出登录（userId 为 null，由退出按钮与登录页调用）。
     * 退出：立即断开后台连接，清掉该服务器的提醒、补拉游标与去重表，之后不再重连，直到再次登录。
     * 换成另一个账号：同样先清掉旧账号的一切，再用新会话换令牌。
     */
    static void onWebSession(Context c, String userId) {
        RtService s = instance;
        if (s == null) {
            if (userId == null) {
                Notifier.clear(c, null);
                ServerStore.clearLastSync(c, ServerStore.getServerUrl(c));
            } else if (shouldRun(c)) {
                start(c);
            }
            return;
        }
        s.handler.post(() -> s.applyWebSession(userId));
    }

    private void applyWebSession(String userId) {
        if (server == null) return;
        String cookie = CookieManager.getInstance().getCookie(server);
        boolean reset = session.onWebSession(userId, cookie);
        if (userId == null) {
            signOut("已退出登录");
            return;
        }
        if (reset) resetIdentity();
        if (ws == null) {
            attempt = 0;
            schedule(0);
        }
    }

    /** 退出登录：断开并作废旧账号状态，不再重连 */
    private void signOut(String why) {
        if (!session.isBlocked()) session.onWebSession(null, CookieManager.getInstance().getCookie(server));
        resetIdentity();
        setState("signed_out", why);
    }

    /** 作废当前账号：断开连接、撤销提醒、清空补拉游标与去重表 */
    private void resetIdentity() {
        generation++;
        handler.removeCallbacks(connectTask);
        closeSocket();
        shownSeq.clear();
        pushCapable = false;
        attempt = 0;
        meId = null;
        connectedCookie = null;
        Notifier.clear(this, null);
        ServerStore.clearLastSync(this, server);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, RtService.class));
    }

    static JSObject snapshot() {
        JSObject o = new JSObject();
        o.put("state", state);
        o.put("server", server);
        o.put("lastError", lastError);
        o.put("connectedAt", connectedAt);
        o.put("lastEventAt", lastEventAt);
        o.put("connects", connects);
        o.put("events", events);
        o.put("notified", notified);
        o.put("pushCapable", pushCapable);
        o.put("missedShown", missedShown);
        o.put("lastNotifyAt", lastNotifyAt);
        o.put("tokenRequests", tokenRequests);
        RtService s = instance;
        o.put("lastSync", s == null ? 0 : ServerStore.getLastSync(s, server, s.meId));
        o.put("userId", s == null ? null : s.meId);
        return o;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Notifier.ensureChannels(this);
        http = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            // WebSocket 是长连接，不设读超时；连接是否存活由 ping/pong 判断
            .readTimeout(0, TimeUnit.SECONDS)
            // 服务端每 30s ping 一次；客户端也 ping，用于尽快发现网络切换后的半开连接
            .pingInterval(25, TimeUnit.SECONDS)
            .build();
        thread = new HandlerThread("oa-rt");
        thread.start();
        handler = new Handler(thread.getLooper());
        registerNetworkCallback();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String url = ServerStore.getServerUrl(this);
        Notification n = Notifier.ongoing(this, host(url), "正在连接…");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ONGOING_ID, n);
        }
        if (!shouldRun(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.post(() -> {
            if (!url.equals(server)) {
                // 切换服务器：旧服务器的连接、提醒、游标、去重表与账号全部作废
                if (server != null) resetIdentity();
                session.forget();
                server = url;
                closeSocket();
                shownSeq.clear();
                pushCapable = false;
                attempt = 0;
                meId = null;
                connectedCookie = null;
            }
            if (ws == null) schedule(0);
        });
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (netCallback != null) {
            try {
                ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCallback);
            } catch (Exception ignored) {}
        }
        handler.removeCallbacksAndMessages(null);
        handler.post(() -> {
            closeSocket();
            thread.quitSafely();
        });
        state = "stopped";
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void schedule(long delayMs) {
        handler.removeCallbacks(connectTask);
        handler.postDelayed(connectTask, delayMs);
    }

    private long nextBackoff() {
        long wait = Math.min(1000L << Math.min(attempt, 6), MAX_BACKOFF_MS);
        attempt++;
        return wait;
    }

    private String userAgent() {
        String base;
        try {
            base = WebSettings.getDefaultUserAgent(this);
        } catch (Exception e) {
            base = "Android";
        }
        return base + " " + MainActivity.userAgentMark() + " OAMobileService";
    }

    private static String host(String url) {
        return url == null ? "" : url.replaceFirst("^https?://", "");
    }

    private void connect() {
        final String base = server;
        if (base == null || ws != null || fetchingToken) return;
        final String cookie = CookieManager.getInstance().getCookie(base);
        switch (session.gate(cookie)) {
            case SIGNED_OUT:
                // 不轮询：页面登录后会调用 onWebSession，App 切前后台时 kick 也会重新检查
                if (meId != null) resetIdentity();
                setState("signed_out", "WebView 中没有该服务器的登录 Cookie");
                return;
            case BLOCKED:
                return;
            default:
        }
        setState("connecting", null);
        final int gen = generation;
        Request req = new Request.Builder()
            .url(base + "/api/realtime-token")
            .header("Cookie", cookie)
            .header("User-Agent", userAgent())
            .header("Accept", "application/json")
            .build();
        fetchingToken = true;
        tokenRequests++;
        Call tokenCall = http.newCall(req);
        tokenCall.timeout().timeout(20, TimeUnit.SECONDS);
        tokenCall.enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                handler.post(() -> {
                    fetchingToken = false;
                    if (gen != generation) {
                        schedule(0);
                        return;
                    }
                    setState("disconnected", "获取令牌失败：" + e.getMessage());
                    schedule(nextBackoff());
                });
            }

            @Override
            public void onResponse(Call call, Response res) {
                String body = null;
                int code = res.code();
                try {
                    body = res.body() != null ? res.body().string() : null;
                } catch (IOException ignored) {
                } finally {
                    res.close();
                }
                final String text = body;
                handler.post(() -> {
                    fetchingToken = false;
                    if (gen != generation) {
                        // 请求期间退出或换了账号：结果作废，按最新的登录状态重新判断
                        schedule(0);
                        return;
                    }
                    onToken(base, cookie, code, text);
                });
            }
        });
    }

    private void onToken(String base, String cookie, int code, String body) {
        if (!base.equals(server) || ws != null) return;
        if (code == 401) {
            // 会话过期或已退出：不再拿同一个 Cookie 重试，提示重新登录；页面登录后 onWebSession / Cookie 变化会解除
            session.onUnauthorized(cookie);
            resetIdentity();
            setState("unauthorized", "登录已失效（401），请打开 App 重新登录");
            promptRelogin();
            return;
        }
        if (code != 200 || body == null) {
            setState("disconnected", "获取令牌失败：HTTP " + code);
            schedule(nextBackoff());
            return;
        }
        try {
            JSONObject j = new JSONObject(body);
            String token = j.getString("token");
            String url = j.getString("url");
            String uid = jwtUserId(token);
            if (session.onTokenUser(uid)) resetIdentity();
            meId = uid;
            connectedCookie = cookie;
            Notifier.clear(this, AUTH_TAG);
            String sep = url.contains("?") ? "&" : "?";
            Request wsReq = new Request.Builder()
                .url(url + sep + "token=" + URLEncoder.encode(token, StandardCharsets.UTF_8.name()) + "&client=bg")
                .header("User-Agent", userAgent())
                .build();
            pushCapable = false;
            ws = http.newWebSocket(wsReq, new Listener());
        } catch (Exception e) {
            setState("disconnected", "令牌响应无效：" + e.getMessage());
            schedule(nextBackoff());
        }
    }

    private void promptRelogin() {
        if (AppState.isForeground()) return;
        Notifier.show(this, AUTH_TAG, "system", "OA 登录已失效", "请打开 App 重新登录，登录后继续接收消息提醒", "/login", 1);
    }

    private static String jwtUserId(String token) {
        try {
            String[] parts = token.split("\\.");
            byte[] json = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            return new JSONObject(new String(json, StandardCharsets.UTF_8)).optString("userId", null);
        } catch (Exception e) {
            return null;
        }
    }

    private void closeSocket() {
        WebSocket s = ws;
        ws = null;
        if (s != null) s.cancel();
    }

    private final class Listener extends WebSocketListener {

        @Override
        public void onOpen(WebSocket socket, Response response) {
            handler.post(() -> {
                if (socket != ws) return;
                attempt = 0;
                connects++;
                connectedAt = System.currentTimeMillis();
                setState("connected", null);
                // 连接已建立再补拉：之后到达的消息走实时推送，重叠部分按 seq 去重
                fetchMissed(server);
            });
        }

        @Override
        public void onMessage(WebSocket socket, String text) {
            handler.post(() -> {
                if (socket == ws) handleEvent(text);
            });
        }

        @Override
        public void onClosing(WebSocket socket, int code, String reason) {
            socket.close(1000, null);
        }

        @Override
        public void onClosed(WebSocket socket, int code, String reason) {
            handler.post(() -> lost(socket, "连接关闭（" + code + "）"));
        }

        @Override
        public void onFailure(WebSocket socket, Throwable t, Response response) {
            String why = response != null ? "HTTP " + response.code() : t.getClass().getSimpleName() + ": " + t.getMessage();
            handler.post(() -> lost(socket, "连接失败：" + why));
        }
    }

    private void lost(WebSocket socket, String why) {
        if (socket != ws) return;
        ws = null;
        setState("disconnected", why);
        schedule(nextBackoff());
    }

    private void handleEvent(String text) {
        JSONObject ev;
        try {
            ev = new JSONObject(text);
        } catch (Exception e) {
            return;
        }
        events++;
        lastEventAt = System.currentTimeMillis();
        switch (ev.optString("type")) {
            case "push.hello":
                pushCapable = true;
                return;
            case "push.notify": {
                JSONObject n = ev.optJSONObject("notification");
                if (n == null) return;
                advanceSync(parseTime(n.optString("sentAt")));
                // 静默：用户正在电脑端使用 OA，只推进补拉游标
                if (ev.optBoolean("silent")) {
                    markShown(n);
                    return;
                }
                // App 在前台时由页面（?client=app）负责提醒，并能判断用户是否正停留在该会话
                if (AppState.isForeground()) {
                    markShown(n);
                    return;
                }
                showPush(n, false);
                return;
            }
            case "push.clear": {
                String conv = ev.optString("conversationId", null);
                if (conv != null) Notifier.clear(this, conv);
                return;
            }
            case "message.new":
                if (!pushCapable) legacyMessage(ev);
                return;
            default:
        }
    }

    private void markShown(JSONObject n) {
        String conv = n.optString("conversationId");
        int seq = n.optInt("seq", 0);
        Integer prev = shownSeq.get(conv);
        if (prev == null || seq > prev) shownSeq.put(conv, seq);
    }

    private boolean showPush(JSONObject n, boolean missed) {
        String conv = n.optString("conversationId");
        int seq = n.optInt("seq", 0);
        Integer prev = shownSeq.get(conv);
        if (prev != null && seq <= prev) return false;
        shownSeq.put(conv, seq);
        boolean shown = Notifier.show(
            this,
            conv,
            n.optString("channel", "dm"),
            n.optString("title", "新消息"),
            n.optString("body", ""),
            n.optString("path", "/messages/" + conv),
            Math.max(1, n.optInt("count", 1))
        );
        if (shown) {
            notified++;
            lastNotifyAt = System.currentTimeMillis();
            if (missed) missedShown++;
        } else if (!Notifier.hasPermission(this)) {
            lastError = "没有通知权限，已丢弃一条消息提醒";
        }
        return shown;
    }

    /** 旧服务端（没有 push.hello）：按 M0 的方式把 message.new 显示为提醒 */
    private void legacyMessage(JSONObject ev) {
        JSONObject msg = ev.optJSONObject("message");
        if (msg == null) return;
        JSONObject sender = msg.optJSONObject("sender");
        if (sender != null && meId != null && meId.equals(sender.optString("id"))) return;
        if (AppState.isForeground()) return;
        String conversationId = ev.optString("conversationId", msg.optString("conversationId"));
        String title = sender != null ? sender.optString("name", "新消息") : "系统通知";
        if (Notifier.show(this, conversationId, "dm", title, legacySummary(msg), "/messages/" + conversationId, 1)) {
            notified++;
            lastNotifyAt = System.currentTimeMillis();
        }
    }

    private static String legacySummary(JSONObject msg) {
        if (msg.optBoolean("recalled")) return "撤回了一条消息";
        String type = msg.optString("type");
        String t = msg.optString("text", "").trim();
        switch (type) {
            case "IMAGE":
                return "[图片]";
            case "FILE":
                return t.isEmpty() ? "[文件]" : "[文件] " + t;
            case "CARD":
                return t.isEmpty() ? "[卡片消息]" : t;
            default:
                return t.isEmpty() ? "[消息]" : t;
        }
    }

    private static long parseTime(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        try {
            return Instant.parse(iso).toEpochMilli();
        } catch (Exception e) {
            return 0;
        }
    }

    private void advanceSync(long serverTime) {
        if (serverTime <= 0 || server == null || meId == null) return;
        if (serverTime > ServerStore.getLastSync(this, server, meId)) ServerStore.setLastSync(this, server, meId, serverTime);
    }

    /** 补拉断线期间漏掉的提醒（每个会话一条，带未读条数）；首次连接只记录游标 */
    private void fetchMissed(String base) {
        if (base == null || meId == null) return;
        String cookie = CookieManager.getInstance().getCookie(base);
        if (cookie == null || cookie.isEmpty()) return;
        final String user = meId;
        long since = ServerStore.getLastSync(this, base, user);
        Request req = new Request.Builder()
            .url(base + "/api/push/missed" + (since > 0 ? "?since=" + since : ""))
            .header("Cookie", cookie)
            .header("User-Agent", userAgent())
            .header("Accept", "application/json")
            .build();
        Call c = http.newCall(req);
        c.timeout().timeout(20, TimeUnit.SECONDS);
        c.enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                Log.w(TAG, "missed push fetch failed", e);
            }

            @Override
            public void onResponse(Call call, Response res) {
                String body = null;
                int code = res.code();
                try {
                    body = res.body() != null ? res.body().string() : null;
                } catch (IOException ignored) {
                } finally {
                    res.close();
                }
                final String text = body;
                if (code != 200 || text == null) return;
                handler.post(() -> onMissed(base, user, text));
            }
        });
    }

    private void onMissed(String base, String user, String body) {
        // 补拉期间退出或换了账号：旧账号的提醒一律丢弃
        if (!base.equals(server) || !user.equals(meId)) return;
        try {
            JSONObject j = new JSONObject(body);
            JSONArray list = j.optJSONArray("notifications");
            if (list != null && !AppState.isForeground()) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject n = list.optJSONObject(i);
                    if (n != null) showPush(n, true);
                }
            } else if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject n = list.optJSONObject(i);
                    if (n != null) markShown(n);
                }
            }
            advanceSync(j.optLong("now", 0));
        } catch (Exception e) {
            Log.w(TAG, "invalid missed push response", e);
        }
    }

    private void setState(String s, String error) {
        state = s;
        if (error != null) lastError = error;
        String label;
        switch (s) {
            case "connected":
                label = "已连接，后台可接收新消息";
                break;
            case "connecting":
                label = "正在连接…";
                break;
            case "unauthorized":
                label = "登录已失效，请打开 App 重新登录";
                break;
            case "signed_out":
                label = "未登录，打开 App 登录后接收消息提醒";
                break;
            case "stopped":
                return;
            default:
                label = "连接中断，稍后自动重连";
        }
        if (Notifier.hasPermission(this)) {
            NotificationManagerCompat.from(this).notify(ONGOING_ID, Notifier.ongoing(this, host(server), label));
        }
    }

    private void registerNetworkCallback() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return;
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                handler.post(() -> {
                    boolean changed = lastNetwork != null && !lastNetwork.equals(network);
                    lastNetwork = network;
                    // 默认网络切换（Wi-Fi ⇄ 移动数据）后旧 socket 已失效，立即重连而不是等心跳超时
                    if (changed) closeSocket();
                    if (ws == null && server != null) {
                        attempt = 0;
                        schedule(500);
                    }
                });
            }
        };
        try {
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (Exception e) {
            Log.w(TAG, "registerDefaultNetworkCallback failed", e);
        }
    }
}
