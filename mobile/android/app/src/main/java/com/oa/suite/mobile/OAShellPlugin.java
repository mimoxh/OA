package com.oa.suite.mobile;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** 壳层能力：服务器选择与切换、连通性检测、后台保活开关、诊断信息。启动页与远程 OA 页面都可调用。 */
@CapacitorPlugin(name = "OAShell")
public class OAShellPlugin extends Plugin {

    private MainActivity main() {
        return (MainActivity) getActivity();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("serverUrl", ServerStore.getServerUrl(c));
        o.put("activeServerUrl", main().getServerUrl());
        o.put("launcherRequested", ServerStore.isLauncherRequested(c));
        JSArray recent = new JSArray();
        for (String s : ServerStore.getRecent(c)) recent.put(s);
        o.put("recent", recent);
        o.put("keepAlive", ServerStore.isKeepAlive(c));
        o.put("appVersion", BuildConfig.VERSION_NAME);
        o.put("debug", BuildConfig.DEBUG);
        o.put("sdkInt", Build.VERSION.SDK_INT);
        o.put("release", Build.VERSION.RELEASE);
        o.put("manufacturer", Build.MANUFACTURER);
        o.put("model", Build.MODEL);
        PackageInfo wv = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WebView.getCurrentWebViewPackage() : null;
        if (wv != null) {
            o.put("webViewPackage", wv.packageName);
            o.put("webViewVersion", wv.versionName);
        }
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("ignoringBatteryOptimizations", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        o.put("notificationsEnabled", NotificationManagerCompat.from(c).areNotificationsEnabled());
        o.put("service", RtService.snapshot());
        call.resolve(o);
    }

    /** 在原生层探测服务器（不受启动页 https 源的混合内容与 CORS 限制）。 */
    @PluginMethod
    public void probe(PluginCall call) {
        String url = ServerStore.normalize(call.getString("url"));
        if (url == null) {
            call.reject("请输入有效的服务器地址（http:// 或 https://）");
            return;
        }
        new Thread(() -> {
            JSObject o = new JSObject();
            o.put("url", url);
            long t0 = System.currentTimeMillis();
            try {
                int[] status = new int[1];
                String body = get(url + "/health", status);
                o.put("healthStatus", status[0]);
                if (status[0] == 200) {
                    o.put("ok", true);
                    o.put("kind", "standalone");
                    o.put("health", body);
                } else {
                    get(url + "/login", status);
                    o.put("loginStatus", status[0]);
                    o.put("ok", status[0] >= 200 && status[0] < 400);
                    o.put("kind", "web");
                }
            } catch (Exception e) {
                o.put("ok", false);
                o.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            }
            o.put("elapsedMs", System.currentTimeMillis() - t0);
            call.resolve(o);
        }).start();
    }

    private static String get(String url, int[] status) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(6000);
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", MainActivity.userAgentMark());
        try {
            status[0] = conn.getResponseCode();
            InputStream in = status[0] >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in == null) return "";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < 16384) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            conn.disconnect();
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String url = ServerStore.normalize(call.getString("url"));
        if (url == null) {
            call.reject("请输入有效的服务器地址（http:// 或 https://）");
            return;
        }
        call.resolve();
        main().switchTo(url);
    }

    @PluginMethod
    public void forget(PluginCall call) {
        String url = call.getString("url");
        if (url != null) ServerStore.forget(getContext(), url);
        call.resolve();
    }

    @PluginMethod
    public void openLauncher(PluginCall call) {
        call.resolve();
        main().switchTo(null);
    }

    @PluginMethod
    public void setKeepAlive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        ServerStore.setKeepAlive(getContext(), on);
        if (on && ServerStore.getServerUrl(getContext()) != null) RtService.start(getContext());
        else RtService.stop(getContext());
        call.resolve();
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
        startSafely(i, call);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        startSafely(i, call);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        startSafely(i, call);
    }

    private void startSafely(Intent i, PluginCall call) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }
}
