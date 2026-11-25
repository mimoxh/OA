package com.oa.suite.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
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

    private String serverUrl;
    private volatile String mainFrameUrl;
    private volatile String failedUrl;
    private volatile String failedKind;
    private volatile String failedReason;

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
            webView.setDownloadListener(new OADownloadListener(this));
            webView.addJavascriptInterface(new ErrorPageBridge(), "OAShellNative");
        }

        if (serverUrl != null && ServerStore.isKeepAlive(this)) {
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
        failedUrl = url;
        failedKind = kind;
        failedReason = reason;
    }

    void showErrorPage() {
        String errorUrl = bridge == null ? null : bridge.getErrorUrl();
        if (errorUrl != null) runOnUiThread(() -> bridge.getWebView().loadUrl(errorUrl));
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
        bridge.getWebView().loadUrl(serverUrl + path);
    }

    @Override
    public void onStart() {
        super.onStart();
        AppState.setForeground(true);
        RtService.kick();
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
            runOnUiThread(() -> bridge.getWebView().loadUrl(target));
        }

        @JavascriptInterface
        public void openLauncher() {
            if (!fromLocalPage()) return;
            switchTo(null);
        }
    }
}
