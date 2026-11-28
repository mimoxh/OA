package com.oa.suite.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;

/** 壳层持久化设置：当前服务器、最近使用的服务器、后台保活开关。 */
final class ServerStore {

    private static final String PREFS = "oa_shell";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_RECENT = "recent_servers";
    private static final String KEY_KEEP_ALIVE = "keep_alive";
    private static final String KEY_LAUNCHER = "launcher_requested";
    private static final String KEY_NOTIFY = "notify_enabled";
    private static final String KEY_LAST_SYNC = "push_last_sync:";
    private static final int MAX_RECENT = 8;

    private ServerStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * 规范化为 scheme://host[:port][/path]（无结尾斜杠），只接受 http / https；无效时返回 null。
     * 没写协议时补 http://（与启动页 www/server-url.js 一致）。
     */
    static String normalize(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        boolean hasScheme = v.matches("(?is)^[a-z][a-z0-9+.-]*://.*");
        while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
        if (v.isEmpty()) return null;
        if (!hasScheme) v = "http://" + v;
        try {
            URI u = new URI(v);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return null;
            String host = u.getHost();
            if (host == null || host.isEmpty() || u.getRawUserInfo() != null) return null;
            if (u.getPort() > 65535) return null;
            StringBuilder sb = new StringBuilder(scheme).append("://").append(host.toLowerCase(Locale.ROOT));
            if (u.getPort() > 0) sb.append(':').append(u.getPort());
            String path = u.getRawPath();
            if (path != null) {
                while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
                sb.append(path);
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    static String getServerUrl(Context c) {
        return prefs(c).getString(KEY_SERVER, null);
    }

    static void setServerUrl(Context c, String url) {
        prefs(c).edit().putString(KEY_SERVER, url).apply();
        if (url != null) addRecent(c, url);
    }

    static List<String> getRecent(Context c) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(c).getString(KEY_RECENT, "[]"));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
        } catch (Exception ignored) {}
        return out;
    }

    private static void saveRecent(Context c, List<String> list) {
        JSONArray arr = new JSONArray();
        for (String s : list) arr.put(s);
        prefs(c).edit().putString(KEY_RECENT, arr.toString()).apply();
    }

    static void addRecent(Context c, String url) {
        List<String> list = getRecent(c);
        list.remove(url);
        list.add(0, url);
        while (list.size() > MAX_RECENT) list.remove(list.size() - 1);
        saveRecent(c, list);
    }

    static void forget(Context c, String url) {
        List<String> list = getRecent(c);
        list.remove(url);
        saveRecent(c, list);
        if (url.equals(getServerUrl(c))) prefs(c).edit().remove(KEY_SERVER).apply();
    }

    static boolean isKeepAlive(Context c) {
        return prefs(c).getBoolean(KEY_KEEP_ALIVE, true);
    }

    static void setKeepAlive(Context c, boolean on) {
        prefs(c).edit().putBoolean(KEY_KEEP_ALIVE, on).apply();
    }

    /** 我的 → 通知 的总开关：关闭后不弹任何消息提醒，也不保持后台连接 */
    static boolean isNotifyEnabled(Context c) {
        return prefs(c).getBoolean(KEY_NOTIFY, true);
    }

    static void setNotifyEnabled(Context c, boolean on) {
        prefs(c).edit().putBoolean(KEY_NOTIFY, on).apply();
    }

    /** 补拉游标：上次收到推送或补拉时的服务端时间（毫秒），按服务器 + 账号分别保存 */
    static long getLastSync(Context c, String server, String userId) {
        return server == null || userId == null ? 0 : prefs(c).getLong(lastSyncKey(server, userId), 0);
    }

    static void setLastSync(Context c, String server, String userId, long value) {
        if (server != null && userId != null) prefs(c).edit().putLong(lastSyncKey(server, userId), value).apply();
    }

    /** 退出登录 / 换账号 / 换服务器：作废该服务器下所有账号的补拉游标（含 M2 按服务器保存的旧格式） */
    static void clearLastSync(Context c, String server) {
        if (server == null) return;
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit();
        String legacy = KEY_LAST_SYNC + server;
        for (String k : p.getAll().keySet()) {
            if (k.equals(legacy) || k.startsWith(legacy + "#")) e.remove(k);
        }
        e.commit();
    }

    private static String lastSyncKey(String server, String userId) {
        return KEY_LAST_SYNC + server + "#" + userId;
    }

    /** 用户主动回到启动页时为 true：下次创建 Activity 时加载包内启动页而不是服务器。 */
    static boolean isLauncherRequested(Context c) {
        return prefs(c).getBoolean(KEY_LAUNCHER, false);
    }

    static void setLauncherRequested(Context c, boolean on) {
        // commit：紧接着会 recreate()，必须先落盘
        prefs(c).edit().putBoolean(KEY_LAUNCHER, on).commit();
    }
}
