package com.oa.suite.mobile;

import android.net.http.SslError;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * 在 Capacitor 默认行为上收窄错误页：BridgeWebViewClient 对主框架的任意 HTTP 错误（含 404/401）
 * 都会跳到 errorPath，远程 OA 的 404 页、登录跳转等会被误判为“连不上服务器”。
 * 这里只在网络错误、证书错误与网关类 5xx 时显示包内错误页，并记录失败地址供“重试”使用。
 * 首帧 / 加载完成时通知 MainActivity 停止加载看门狗（见 LoadWatchdog）。
 */
class OAWebViewClient extends BridgeWebViewClient {

    private final MainActivity activity;

    OAWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override
    public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        activity.onMainFrameUrl(url);
        super.onPageStarted(view, url, favicon);
    }

    @Override
    public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
        super.doUpdateVisitedHistory(view, url, isReload);
        // 登录 Server Action 写 Cookie 后由客户端路由跳转（pushState，不触发 onPageFinished）；
        // CookieManager 异步落盘，登录后数秒内被杀进程会丢失会话，所以在每次历史变化时主动写盘
        CookieManager.getInstance().flush();
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        super.onPageCommitVisible(view, url);
        activity.onMainFrameSettled(url);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        activity.onMainFrameSettled(url);
        CookieManager.getInstance().flush();
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
            String url = request.getUrl().toString();
            String description = String.valueOf(error.getDescription());
            // 看门狗已停止这次加载并切到错误页，不再重复跳转、也不覆盖「超时」原因
            if (activity.isAbortedByWatchdog(url, description)) return;
            activity.onMainFrameError(url, "network", description);
        }
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        int code = response.getStatusCode();
        if (request.isForMainFrame() && (code == 502 || code == 503 || code == 504)) {
            activity.onMainFrameError(request.getUrl().toString(), "http", "HTTP " + code);
            super.onReceivedHttpError(view, request, response);
        }
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        // SslError 不区分主框架与子资源；OA 服务器本身证书不受信任时所有请求都会失败，直接切到错误页
        String server = activity.getServerUrl();
        if (error.getUrl() != null && server != null && error.getUrl().startsWith(server)) {
            activity.onMainFrameError(error.getUrl(), "ssl", "证书不受信任（SSL 错误 " + error.getPrimaryError() + "）");
            activity.showErrorPage();
        }
    }
}
