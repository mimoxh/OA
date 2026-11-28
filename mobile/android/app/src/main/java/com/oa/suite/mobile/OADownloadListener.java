package com.oa.suite.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * WebView 默认不处理下载（Content-Disposition: attachment 或 &lt;a download&gt;）。
 * 交给系统 DownloadManager，并带上 WebView 的 Cookie 与 UA，使需要登录的 /api/im/files/* 也能下载。
 */
class OADownloadListener implements DownloadListener {

    private static final Pattern FILENAME_STAR = Pattern.compile("filename\\*\\s*=\\s*(?:UTF-8|utf-8)''([^;]+)");
    private static final int REQ_STORAGE = 4102;

    private final Activity activity;

    OADownloadListener(Activity activity) {
        this.activity = activity;
    }

    @Override
    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            // blob:/data: 只存在于页面内存中，系统下载器拿不到，需要页面经 JS 桥接把数据交给原生层
            toast("暂不支持下载此类文件（" + (url == null ? "" : url.split(":")[0]) + ":）");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            && ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, REQ_STORAGE);
            toast("请允许存储权限后重新点击下载");
            return;
        }
        String name = fileName(url, contentDisposition, mimeType);
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            if (userAgent != null) req.addRequestHeader("User-Agent", userAgent);
            if (mimeType != null && !mimeType.isEmpty()) req.setMimeType(mimeType);
            req.setTitle(name);
            req.setDescription("协作平台 OA");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "OA/" + name);
            DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(req);
            toast("开始下载：" + name);
        } catch (Exception e) {
            toast("下载失败：" + e.getMessage());
        }
    }

    static String fileName(String url, String contentDisposition, String mimeType) {
        String name = null;
        if (contentDisposition != null) {
            Matcher m = FILENAME_STAR.matcher(contentDisposition);
            if (m.find()) {
                try {
                    name = URLDecoder.decode(m.group(1).trim().replace("+", "%2B"), StandardCharsets.UTF_8.name());
                } catch (Exception ignored) {}
            }
        }
        if (name == null || name.isEmpty()) name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return name.isEmpty() ? "download" : name;
    }

    private void toast(String text) {
        activity.runOnUiThread(() -> Toast.makeText(activity, text, Toast.LENGTH_SHORT).show());
    }
}
