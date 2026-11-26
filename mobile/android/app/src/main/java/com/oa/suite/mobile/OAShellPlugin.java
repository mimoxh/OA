package com.oa.suite.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
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
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** 壳层能力：服务器选择与切换、连通性检测、后台保活与通知设置、诊断信息。启动页与远程 OA 页面都可调用。 */
@CapacitorPlugin(
    name = "OAShell",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class OAShellPlugin extends Plugin {

    /** 各厂商“自启动 / 后台运行”管理页（不同系统版本路径不同，依次尝试） */
    private static final String[][] AUTOSTART = {
        { "xiaomi", "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },
        { "honor", "com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
        { "honor", "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
        { "huawei", "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
        { "huawei", "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity" },
        { "oppo", "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
        { "oppo", "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity" },
        { "oppo", "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },
        { "vivo", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
        { "vivo", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager" },
        { "samsung", "com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity" },
        { "meizu", "com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity" },
    };

    /** 与网页端 guide-client.tsx 的 vendorOf 保持一致 */
    static String vendor() {
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(Locale.ROOT);
        if (m.matches(".*(xiaomi|redmi|poco).*")) return "xiaomi";
        if (m.contains("honor")) return "honor";
        if (m.contains("huawei")) return "huawei";
        if (m.matches(".*(oppo|realme|oneplus).*")) return "oppo";
        if (m.matches(".*(vivo|iqoo).*")) return "vivo";
        if (m.contains("samsung")) return "samsung";
        if (m.contains("meizu")) return "meizu";
        return "other";
    }

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

    @PluginMethod
    public void getPushState(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("notifyEnabled", ServerStore.isNotifyEnabled(c));
        o.put("keepAlive", ServerStore.isKeepAlive(c));
        o.put("hasServer", ServerStore.getServerUrl(c) != null);
        o.put("notificationsEnabled", NotificationManagerCompat.from(c).areNotificationsEnabled());
        o.put("permissionGranted", Notifier.hasPermission(c));
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("ignoringBatteryOptimizations", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        o.put("manufacturer", Build.MANUFACTURER);
        o.put("brand", Build.BRAND);
        o.put("model", Build.MODEL);
        o.put("release", Build.VERSION.RELEASE);
        o.put("sdkInt", Build.VERSION.SDK_INT);
        String v = vendor();
        boolean autostart = false;
        for (String[] a : AUTOSTART) if (a[0].equals(v)) autostart = true;
        o.put("vendor", v);
        o.put("vendorAutostart", autostart);
        o.put("channels", Notifier.channelsState(c));
        o.put("service", RtService.snapshot());
        call.resolve(o);
    }

    @PluginMethod
    public void setNotifyEnabled(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        Context c = getContext();
        ServerStore.setNotifyEnabled(c, on);
        if (!on) Notifier.clear(c, null);
        RtService.sync(c);
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Notifier.hasPermission(getContext()) || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "onNotificationPermission");
    }

    @PermissionCallback
    private void onNotificationPermission(PluginCall call) {
        resolveGranted(call);
        // 刚授权：常驻通知此前发不出来，重启服务让它显示
        if (Notifier.hasPermission(getContext())) RtService.sync(getContext());
    }

    private void resolveGranted(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", Notifier.hasPermission(getContext()));
        call.resolve(o);
    }

    @PluginMethod
    public void openChannelSettings(PluginCall call) {
        String key = call.getString("channel");
        Intent i;
        if (key == null || key.isEmpty()) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        } else {
            Notifier.ensureChannels(getContext());
            i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, Notifier.channelId(key));
        }
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        startSafely(i, call);
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void openVendorSettings(PluginCall call) {
        String kind = call.getString("kind", "autostart");
        String pkg = getContext().getPackageName();
        String v = vendor();
        if ("battery".equals(kind)) {
            if ("xiaomi".equals(v)) {
                Intent mi = new Intent()
                    .setComponent(new ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
                    .putExtra("package_name", pkg)
                    .putExtra("package_label", "OA");
                if (tryStart(mi)) {
                    resolveOpened(call, "vendor");
                    return;
                }
            }
            if (tryStart(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
                resolveOpened(call, "system");
                return;
            }
        } else {
            for (String[] a : AUTOSTART) {
                if (!a[0].equals(v)) continue;
                if (tryStart(new Intent().setComponent(new ComponentName(a[1], a[2])))) {
                    resolveOpened(call, "vendor");
                    return;
                }
            }
        }
        if (tryStart(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)))) {
            resolveOpened(call, "app-details");
            return;
        }
        call.reject("无法打开系统设置");
    }

    private boolean tryStart(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private static void resolveOpened(PluginCall call, String opened) {
        JSObject o = new JSObject();
        o.put("opened", opened);
        call.resolve(o);
    }

    /** App 在前台时页面收到 push.notify（且不在该会话）→ 走同一套原生渠道弹出 */
    @PluginMethod
    public void showNotification(PluginCall call) {
        String title = call.getString("title");
        if (title == null) {
            call.reject("缺少 title");
            return;
        }
        String conv = call.getString("conversationId");
        String path = call.getString("path", conv == null ? "/messages" : "/messages/" + conv);
        boolean shown = Notifier.show(getContext(), conv, call.getString("channel", "dm"), title, call.getString("body", ""), path, 1);
        JSObject o = new JSObject();
        o.put("shown", shown);
        call.resolve(o);
    }

    /** 页面报告当前登录账号（userId 为 null 表示退出登录），后台推送据此作废旧账号的连接与提醒 */
    @PluginMethod
    public void setSessionUser(PluginCall call) {
        String userId = call.getString("userId");
        RtService.onWebSession(getContext(), userId == null || userId.isEmpty() ? null : userId);
        call.resolve();
    }

    @PluginMethod
    public void clearNotifications(PluginCall call) {
        Notifier.clear(getContext(), call.getString("conversationId"));
        call.resolve();
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

    /** 局域网 HTTP 不是安全上下文，网页拿不到 navigator.clipboard，由原生写入系统剪贴板 */
    @PluginMethod
    public void copyText(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("缺少 text");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("OA", text));
                call.resolve();
            } catch (Exception e) {
                call.reject("写入剪贴板失败：" + e.getMessage());
            }
        });
    }

    /** 用系统浏览器打开（工作台“打开 Web 完整版”），只接受 http/https */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("只支持 http/https 链接");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("没有可用的浏览器");
        }
    }

    @PluginMethod
    public void setKeepAlive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        ServerStore.setKeepAlive(getContext(), on);
        RtService.sync(getContext());
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
