package com.oa.suite.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * 运行时决定加载哪个服务器：Capacitor 的 server.url 默认写死在 capacitor.config.json，
 * 这里在 super.onCreate() 之前按用户保存的地址构造 CapConfig（BridgeActivity.load() 会用 this.config 建 Bridge），
 * 切换服务器时 recreate() 重建 Activity 与 WebView。未配置服务器时加载包内启动页（www/index.html）。
 */
public class MainActivity extends BridgeActivity {

    public static final String ACTION_OPEN_LAUNCHER = "com.oa.suite.mobile.OPEN_LAUNCHER";
    public static final String EXTRA_PATH = "oa_path";
    /** 仅 debug 包：adb 自动化测试直接指定服务器（am start --es oa_server_url ...） */
    public static final String EXTRA_SERVER_URL = "oa_server_url";

    private static final String LOCAL_ORIGIN = "https://localhost";
    private static final int REQ_NOTIFICATIONS = 4101;
    /** 加载超过这个时间还没出首帧才显示「正在连接」，正常打开时不闪一下 */
    private static final long OVERLAY_DELAY_MS = 600;

    private String serverUrl;
    private volatile String mainFrameUrl;
    private volatile String failedUrl;
    private volatile String failedKind;
    private volatile String failedReason;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LoadWatchdog watchdog;
    /** 当前显示的是已出首帧的远程页面（不是空白、也不是包内页面） */
    private boolean remoteVisible;
    /** 看门狗停止的那次加载：stopLoading 之后 WebView 可能再报 ERR_ABORTED，不能覆盖超时原因 */
    private String timedOutUrl;
    private View loadingOverlay;
    private TextView loadingServer;
    private final Runnable showOverlay = () -> {
        if (loadingOverlay != null && watchdog != null && watchdog.isPending()) loadingOverlay.setVisibility(View.VISIBLE);
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Intent intent = getIntent();
        String startPath = null;
        if (intent != null) {
            if (ACTION_OPEN_LAUNCHER.equals(intent.getAction())) {
                ServerStore.setLauncherRequested(this, true);
                intent.setAction(Intent.ACTION_MAIN);
            }
            String injected = BuildConfig.DEBUG ? ServerStore.normalize(intent.getStringExtra(EXTRA_SERVER_URL)) : null;
            if (injected != null) {
                ServerStore.setServerUrl(this, injected);
                ServerStore.setLauncherRequested(this, false);
            }
            intent.removeExtra(EXTRA_SERVER_URL);
            startPath = safePath(intent.getStringExtra(EXTRA_PATH));
            clearConversationNotification(startPath);
            // 初始 intent 会在 load() 里再经过 onNewIntent，去掉深链参数避免重复导航
            intent.removeExtra(EXTRA_PATH);
        }

        serverUrl = ServerStore.isLauncherRequested(this) ? null : ServerStore.getServerUrl(this);
        config = buildConfig(serverUrl, serverUrl == null ? null : startPath);
        registerPlugin(OAShellPlugin.class);
        super.onCreate(savedInstanceState);

        if (bridge != null) {
            WebView webView = bridge.getWebView();
            bridge.setWebViewClient(new OAWebViewClient(bridge, this));
            OADownloadListener downloads = new OADownloadListener(this);
            webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                // 主框架导航变成了下载：不会再出首帧，停止计时
                if (watchdog != null && watchdog.isPending()) onMainFrameSettled(null);
                downloads.onDownloadStart(url, userAgent, contentDisposition, mimeType, contentLength);
            });
            webView.addJavascriptInterface(new ErrorPageBridge(), "OAShellNative");
            watchdog = new LoadWatchdog(new MainThreadScheduler(handler), this::onLoadTimeout, LoadWatchdog.DEFAULT_TIMEOUT_MS);
            addLoadingOverlay();
            // Bridge 在 super.onCreate() 里已经对 appUrl 调用了 loadUrl，这里只补上计时
            if (serverUrl != null) watchLoad(bridge.getAppUrl());
        }

        if (serverUrl != null && RtService.shouldRun(this)) {
            requestNotificationPermissionIfNeeded();
            RtService.start(this);
        }
    }

    private CapConfig buildConfig(String server, String startPath) {
        JSONObject plugins = null;
        try (InputStream in = getAssets().open("capacitor.config.json")) {
            byte[] buf = in.readAllBytes();
            plugins = new JSONObject(new String(buf, StandardCharsets.UTF_8)).optJSONObject("plugins");
        } catch (Exception ignored) {}

        CapConfig.Builder b = new CapConfig.Builder(this)
            .setAndroidScheme("https")
            .setHostname("localhost")
            .setErrorPath("error.html")
            .setAppendedUserAgentString(userAgentMark())
            .setLoggingEnabled(BuildConfig.DEBUG)
            .setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        if (plugins != null) b.setPluginsConfiguration(plugins);
        if (server != null) b.setServerUrl(server);
        if (startPath != null) b.setStartPath(startPath);
        return b.create();
    }

    static String userAgentMark() {
        return "OAMobile/" + BuildConfig.VERSION_NAME;
    }

    private static String safePath(String path) {
        if (path == null || !path.startsWith("/") || path.startsWith("//")) return null;
        return path;
    }

    String getServerUrl() {
        return serverUrl;
    }

    /** 切换到指定服务器（或 null 表示回到启动页）并重建 Activity。 */
    void switchTo(String url) {
        String previous = ServerStore.getServerUrl(this);
        if (url != null && previous != null && !url.equals(previous)) {
            // 换服务器：旧服务器账号的提醒与补拉游标作废（后台连接在 RtService.onStartCommand 里随服务器变化重置）
            Notifier.clear(this, null);
            ServerStore.clearLastSync(this, previous);
        }
        if (url != null) {
            ServerStore.setServerUrl(this, url);
            ServerStore.setLauncherRequested(this, false);
        } else {
            ServerStore.setLauncherRequested(this, true);
        }
        CookieManager.getInstance().flush();
        runOnUiThread(this::recreate);
    }

    void onMainFrameUrl(String url) {
        mainFrameUrl = url;
    }

    String getMainFrameUrl() {
        return mainFrameUrl;
    }

    void onMainFrameError(String url, String kind, String reason) {
        if (url != null && url.startsWith(LOCAL_ORIGIN + "/")) return;
        onMainFrameSettled(null);
        failedUrl = url;
        failedKind = kind;
        failedReason = reason;
    }

    /** 看门狗主动停止的加载随后报的错（通常是 ERR_ABORTED）：忽略，错误页已经显示超时原因 */
    boolean isAbortedByWatchdog(String url, String description) {
        if (timedOutUrl == null) return false;
        return timedOutUrl.equals(url) || (description != null && description.contains("ERR_ABORTED"));
    }

    void showErrorPage() {
        String errorUrl = bridge == null ? null : bridge.getErrorUrl();
        if (errorUrl != null) runOnUiThread(() -> bridge.getWebView().loadUrl(errorUrl));
    }

    /** 壳层自己发起的远程主文档加载（重试、通知深链）都走这里，统一计时 */
    void loadRemote(String url) {
        if (bridge == null) return;
        watchLoad(url);
        bridge.getWebView().loadUrl(url);
    }

    private void watchLoad(String url) {
        if (watchdog == null) return;
        timedOutUrl = null;
        watchdog.arm(url);
        handler.removeCallbacks(showOverlay);
        if (!watchdog.isPending()) return;
        // 已经显示着远程页面时（例如点通知深链），WebView 会保留旧页面直到新页面出首帧，不需要遮罩
        if (!remoteVisible) {
            if (loadingServer != null) loadingServer.setText(serverUrl == null ? "" : serverUrl);
            handler.postDelayed(showOverlay, OVERLAY_DELAY_MS);
        }
    }

    /** 主框架出了首帧 / 加载完成（url 为 null 表示已转为下载或由 WebView 报错） */
    void onMainFrameSettled(String url) {
        if (url != null && !url.startsWith("http://") && !url.startsWith("https://")) return;
        if (url != null) remoteVisible = LoadWatchdog.isRemoteDocument(url);
        if (watchdog != null) watchdog.settle();
        hideLoadingOverlay();
    }

    private void onLoadTimeout(String url) {
        if (bridge == null || isFinishing() || isDestroyed()) return;
        timedOutUrl = url;
        failedUrl = url;
        failedKind = "timeout";
        failedReason = "服务器 " + (watchdog.timeoutMs() / 1000) + " 秒内没有响应";
        remoteVisible = false;
        hideLoadingOverlay();
        WebView webView = bridge.getWebView();
        webView.stopLoading();
        String errorUrl = bridge.getErrorUrl();
        if (errorUrl != null) webView.loadUrl(errorUrl);
    }

    private void hideLoadingOverlay() {
        handler.removeCallbacks(showOverlay);
        if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
    }

    /** 空白等待期间的轻量加载态：显示正在连接的地址，并直接提供「切换服务器」 */
    private void addLoadingOverlay() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFF7F7F5);
        root.setClickable(true);
        root.setVisibility(View.GONE);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(24);
        col.setPadding(pad, pad, pad, pad);

        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        col.addView(spinner, new LinearLayout.LayoutParams(dp(40), dp(40)));

        TextView title = new TextView(this);
        title.setText("正在连接 OA 服务器…");
        title.setTextColor(0xFF37352F);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        col.addView(title, lp);

        loadingServer = new TextView(this);
        loadingServer.setTextColor(0xFF6B6A65);
        loadingServer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        loadingServer.setGravity(Gravity.CENTER);
        lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        col.addView(loadingServer, lp);

        Button change = new Button(this);
        change.setText("切换服务器");
        change.setAllCaps(false);
        change.setOnClickListener(v -> switchTo(null));
        lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(24);
        col.addView(change, lp);

        root.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        addContentView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        loadingOverlay = root;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private static final class MainThreadScheduler implements LoadWatchdog.Scheduler {
        private final Handler handler;

        MainThreadScheduler(Handler handler) {
            this.handler = handler;
        }

        @Override
        public long now() {
            return SystemClock.uptimeMillis();
        }

        @Override
        public Object schedule(Runnable task, long delayMs) {
            handler.postDelayed(task, delayMs);
            return task;
        }

        @Override
        public void cancel(Object handle) {
            handler.removeCallbacks((Runnable) handle);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null && ACTION_OPEN_LAUNCHER.equals(intent.getAction())) {
            setIntent(new Intent(this, MainActivity.class));
            switchTo(null);
            return;
        }
        super.onNewIntent(intent);
        if (intent == null || bridge == null) return;
        String path = safePath(intent.getStringExtra(EXTRA_PATH));
        if (path == null) return;
        if (serverUrl == null) {
            // 停在启动页时点了消息通知：回到已保存的服务器并打开对应页面（recreate 后 onCreate 从 getIntent() 读取路径）
            String saved = ServerStore.getServerUrl(this);
            if (saved == null) return;
            setIntent(new Intent(this, MainActivity.class).putExtra(EXTRA_PATH, path));
            switchTo(saved);
            return;
        }
        intent.removeExtra(EXTRA_PATH);
        clearConversationNotification(path);
        loadRemote(serverUrl + path);
    }

    @Override
    public void onStart() {
        super.onStart();
        AppState.setForeground(true);
        RtService.kick();
        if (watchdog != null) watchdog.resume();
    }

    @Override
    public void onPause() {
        super.onPause();
        // WebView 的 Cookie 存储是异步落盘的；切后台时立即写盘，避免进程被杀后丢失登录态
        CookieManager.getInstance().flush();
    }

    @Override
    public void onStop() {
        super.onStop();
        AppState.setForeground(false);
        RtService.kick();
        if (watchdog != null) watchdog.pause();
    }

    @Override
    public void onDestroy() {
        if (watchdog != null) watchdog.settle();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    /** 点通知打开会话时立即撤销该会话的提醒（页面标记已读后服务端还会发 push.clear） */
    private void clearConversationNotification(String path) {
        if (path != null && path.startsWith("/messages/")) {
            String id = path.substring("/messages/".length());
            int q = id.indexOf('?');
            if (q >= 0) id = id.substring(0, q);
            if (!id.isEmpty() && !id.contains("/")) Notifier.clear(this, id);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFICATIONS);
    }

    /**
     * 包内错误页（https://localhost/error.html）不在 Capacitor 注入桥接脚本的来源里，用 JavascriptInterface 提供最小能力。
     * 该对象对所有页面可见，因此每个方法都先确认当前主框架是包内页面。
     */
    private final class ErrorPageBridge {

        private boolean fromLocalPage() {
            String url = mainFrameUrl;
            return url != null && url.startsWith(LOCAL_ORIGIN + "/");
        }

        @JavascriptInterface
        public String info() {
            if (!fromLocalPage()) return "{}";
            JSONObject o = new JSONObject();
            try {
                o.put("serverUrl", serverUrl);
                o.put("failedUrl", failedUrl);
                o.put("kind", failedKind);
                o.put("reason", failedReason);
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public void retry() {
            if (!fromLocalPage() || serverUrl == null) return;
            String target = failedUrl != null && failedUrl.startsWith(serverUrl) ? failedUrl : serverUrl;
            runOnUiThread(() -> loadRemote(target));
        }

        @JavascriptInterface
        public void openLauncher() {
            if (!fromLocalPage()) return;
            switchTo(null);
        }
    }
}
