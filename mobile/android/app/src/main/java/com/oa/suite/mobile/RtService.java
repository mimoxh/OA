package com.oa.suite.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

/**
 * M0 保活原型：前台服务（specialUse）常驻一条 /rt WebSocket。
 * 认证复用 WebView 的会话 Cookie（CookieManager 可读 httpOnly Cookie）→ GET /api/realtime-token 换 rt 令牌，
 * 与网页端 RealtimeProvider 走同一条链路，服务端无需改动。App 不在前台时把 message.new 显示为本地通知。
 */
public class RtService extends Service {

    private static final String TAG = "OARt";
    static final String CH_SERVICE = "oa_keepalive";
    static final String CH_MESSAGES = "oa_messages";
    private static final int ONGOING_ID = 1;
    private static final long MAX_BACKOFF_MS = 60_000;
    private static final long UNAUTHORIZED_RETRY_MS = 30_000;

    // 诊断状态（OAShell.getState 读取）
    private static volatile String state = "stopped";
    private static volatile String lastError = null;
    private static volatile String server = null;
    private static volatile long connectedAt = 0;
    private static volatile long lastEventAt = 0;
    private static volatile int connects = 0;
    private static volatile int notified = 0;
    private static volatile int events = 0;

    private static volatile RtService instance;

    private OkHttpClient http;
    private HandlerThread thread;
    private Handler handler;
    private WebSocket ws;
    private int attempt = 0;
    private boolean fetchingToken = false;
    private String meId;
    private Network lastNetwork;
    private ConnectivityManager.NetworkCallback netCallback;
    private final Runnable connectTask = this::connect;

    static void start(Context c) {
        try {
            ContextCompat.startForegroundService(c, new Intent(c, RtService.class));
        } catch (Exception e) {
            // Android 12+ 后台启动前台服务会抛 ForegroundServiceStartNotAllowedException
            lastError = "启动前台服务失败：" + e.getMessage();
            Log.w(TAG, lastError, e);
        }
    }

    /** App 回到前台或切到后台时调用：服务已在运行且当前未连接（例如刚登录）就立即重连，而不是等退避计时器。 */
    static void kick() {
        RtService s = instance;
        if (s == null) return;
        s.handler.post(() -> {
            if (s.ws == null && s.server != null) {
                s.attempt = 0;
                s.schedule(0);
            }
        });
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
        return o;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
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
        Notification n = ongoing("正在连接…");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ONGOING_ID, n);
        }
        String url = ServerStore.getServerUrl(this);
        if (url == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.post(() -> {
            if (!url.equals(server)) {
                server = url;
                closeSocket();
                attempt = 0;
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
        setState("stopped", null);
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

    private void connect() {
        final String base = server;
        if (base == null || ws != null || fetchingToken) return;
        setState("connecting", null);
        String cookie = CookieManager.getInstance().getCookie(base);
        if (cookie == null || cookie.isEmpty()) {
            setState("unauthorized", "WebView 中没有该服务器的登录 Cookie");
            schedule(UNAUTHORIZED_RETRY_MS);
            return;
        }
        Request req = new Request.Builder()
            .url(base + "/api/realtime-token")
            .header("Cookie", cookie)
            .header("User-Agent", userAgent())
            .header("Accept", "application/json")
            .build();
        fetchingToken = true;
        Call tokenCall = http.newCall(req);
        tokenCall.timeout().timeout(20, TimeUnit.SECONDS);
        tokenCall.enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                handler.post(() -> {
                    fetchingToken = false;
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
                    onToken(base, code, text);
                });
            }
        });
    }

    private void onToken(String base, int code, String body) {
        if (!base.equals(server) || ws != null) return;
        if (code == 401) {
            setState("unauthorized", "未登录或会话已过期（401）");
            schedule(UNAUTHORIZED_RETRY_MS);
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
            meId = jwtUserId(token);
            Request wsReq = new Request.Builder()
                .url(url + "?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8.name()))
                .header("User-Agent", userAgent())
                .build();
            ws = http.newWebSocket(wsReq, new Listener());
        } catch (Exception e) {
            setState("disconnected", "令牌响应无效：" + e.getMessage());
            schedule(nextBackoff());
        }
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
        if (!"message.new".equals(ev.optString("type"))) return;
        JSONObject msg = ev.optJSONObject("message");
        if (msg == null) return;
        JSONObject sender = msg.optJSONObject("sender");
        if (sender != null && meId != null && meId.equals(sender.optString("id"))) return;
        if (AppState.isForeground()) return;
        String conversationId = ev.optString("conversationId", msg.optString("conversationId"));
        String title = sender != null ? sender.optString("name", "新消息") : "系统通知";
        showMessage(conversationId, title, summary(msg));
    }

    private static String summary(JSONObject msg) {
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

    private void showMessage(String conversationId, String title, String body) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            lastError = "没有通知权限，已丢弃一条消息提醒";
            return;
        }
        Intent open = new Intent(this, MainActivity.class)
            .putExtra(MainActivity.EXTRA_PATH, "/messages/" + conversationId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this,
            conversationId.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        Notification n = new NotificationCompat.Builder(this, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_oa)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(pi)
            .build();
        NotificationManagerCompat.from(this).notify(conversationId, 2, n);
        notified++;
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
                label = "未登录，打开 App 登录后自动连接";
                break;
            case "stopped":
                return;
            default:
                label = "连接中断，稍后自动重连";
        }
        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            nm.notify(ONGOING_ID, ongoing(label));
        }
    }

    private Notification ongoing(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String host = server == null ? "" : server.replaceFirst("^https?://", "");
        return new NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_oa)
            .setContentTitle("协作平台 OA · " + host)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pi)
            .build();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel keep = new NotificationChannel(CH_SERVICE, "后台连接", NotificationManager.IMPORTANCE_MIN);
        keep.setDescription("保持与 OA 服务器的连接，用于接收新消息提醒");
        keep.setShowBadge(false);
        NotificationChannel msg = new NotificationChannel(CH_MESSAGES, "新消息", NotificationManager.IMPORTANCE_HIGH);
        msg.setDescription("单聊、群聊与业务通知");
        nm.createNotificationChannel(keep);
        nm.createNotificationChannel(msg);
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
