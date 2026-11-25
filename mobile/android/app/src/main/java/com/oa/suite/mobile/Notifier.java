package com.oa.suite.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

/**
 * 消息通知：渠道（单聊 / 群聊 / @我 / 审批与系统 + 后台连接）、按会话合并显示、撤销。
 * 后台服务（RtService）和 App 前台时的页面提醒（OAShell.showNotification）共用，渠道 key 与服务端
 * src/lib/push/types.ts 的 PushChannel 一致。
 */
final class Notifier {

    static final String CH_SERVICE = "oa_keepalive";
    static final String CH_DM = "oa_dm";
    static final String CH_GROUP = "oa_group";
    static final String CH_MENTION = "oa_mention";
    static final String CH_SYSTEM = "oa_system";
    /** M0/M1 的单一“新消息”渠道，升级后删除 */
    private static final String CH_LEGACY = "oa_messages";

    private static final int MESSAGE_ID = 2;
    private static final int MAX_LINES = 5;
    private static final String GROUP_KEY = "oa_messages";

    private static final class Pending {
        final Deque<String> lines = new ArrayDeque<>();
        int count = 0;
    }

    /** 会话 → 尚未读的提醒行（进程内；撤销或进程重启后清空） */
    private static final Map<String, Pending> pending = new HashMap<>();

    private Notifier() {}

    static final String[][] CHANNELS = {
        // key, id, 名称, 说明
        { "dm", CH_DM, "单聊消息", "同事发给你的消息" },
        { "group", CH_GROUP, "群聊消息", "群里的新消息（免打扰的群不提醒）" },
        { "mention", CH_MENTION, "@我", "群里有人 @你 或 @所有人" },
        { "system", CH_SYSTEM, "审批与系统通知", "审批助手、项目助手等发来的待办与结果" },
        { "service", CH_SERVICE, "后台连接", "保持与 OA 服务器的连接，用于接收新消息提醒" },
    };

    static String channelId(String key) {
        if (key == null) return CH_DM;
        switch (key) {
            case "group":
                return CH_GROUP;
            case "mention":
                return CH_MENTION;
            case "system":
                return CH_SYSTEM;
            case "service":
                return CH_SERVICE;
            default:
                return CH_DM;
        }
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CH_LEGACY) != null) nm.deleteNotificationChannel(CH_LEGACY);
        for (String[] ch : CHANNELS) {
            if (nm.getNotificationChannel(ch[1]) != null) continue;
            int importance;
            switch (ch[0]) {
                case "service":
                    importance = NotificationManager.IMPORTANCE_MIN;
                    break;
                case "group":
                    importance = NotificationManager.IMPORTANCE_DEFAULT;
                    break;
                default:
                    importance = NotificationManager.IMPORTANCE_HIGH;
            }
            NotificationChannel channel = new NotificationChannel(ch[1], ch[2], importance);
            channel.setDescription(ch[3]);
            if ("service".equals(ch[0])) channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
    }

    static boolean hasPermission(Context c) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static JSArray channelsState(Context c) {
        ensureChannels(c);
        boolean appEnabled = NotificationManagerCompat.from(c).areNotificationsEnabled();
        JSArray arr = new JSArray();
        NotificationManager nm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? c.getSystemService(NotificationManager.class) : null;
        for (String[] ch : CHANNELS) {
            JSObject o = new JSObject();
            o.put("key", ch[0]);
            o.put("id", ch[1]);
            o.put("name", ch[2]);
            o.put("description", ch[3]);
            int importance = 3;
            if (nm != null) {
                NotificationChannel channel = nm.getNotificationChannel(ch[1]);
                if (channel != null) importance = channel.getImportance();
            }
            o.put("importance", importance);
            o.put("enabled", appEnabled && importance != NotificationManager.IMPORTANCE_NONE);
            arr.put(o);
        }
        return arr;
    }

    /**
     * 显示（或更新）某会话的提醒。同一会话只占一条通知，最近几条按行展示。
     * @param count 本次新增的条数（补拉汇总时大于 1）
     */
    static synchronized boolean show(Context c, String conversationId, String channelKey, String title, String body, String path, int count) {
        if (!ServerStore.isNotifyEnabled(c) || !hasPermission(c)) return false;
        ensureChannels(c);
        String tag = conversationId == null || conversationId.isEmpty() ? "misc" : conversationId;
        Pending p = pending.get(tag);
        if (p == null) {
            p = new Pending();
            pending.put(tag, p);
        }
        p.count += Math.max(1, count);
        p.lines.addLast(body);
        while (p.lines.size() > MAX_LINES) p.lines.removeFirst();

        Intent open = new Intent(c, MainActivity.class)
            .putExtra(MainActivity.EXTRA_PATH, path == null || path.isEmpty() ? "/messages" : path)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            c,
            tag.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channelId(channelKey))
            .setSmallIcon(R.drawable.ic_stat_oa)
            .setColor(0xFF2383E2)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority("group".equals(channelKey) ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setGroup(GROUP_KEY)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(pi);
        if (p.count > 1) {
            NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle().setSummaryText(p.count + " 条新消息");
            for (String line : p.lines) style.addLine(line);
            b.setStyle(style).setNumber(p.count);
        } else {
            b.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }
        NotificationManagerCompat.from(c).notify(tag, MESSAGE_ID, b.build());
        return true;
    }

    /** 撤销某会话的提醒；conversationId 为空时撤销全部消息提醒（保留后台连接常驻通知） */
    static synchronized void clear(Context c, String conversationId) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        if (conversationId != null && !conversationId.isEmpty()) {
            pending.remove(conversationId);
            nm.cancel(conversationId, MESSAGE_ID);
            return;
        }
        pending.clear();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            NotificationManager raw = c.getSystemService(NotificationManager.class);
            if (raw != null) {
                for (StatusBarNotification sbn : raw.getActiveNotifications()) {
                    if (sbn.getId() == MESSAGE_ID) nm.cancel(sbn.getTag(), MESSAGE_ID);
                }
            }
        }
    }

    static Notification ongoing(Context c, String host, String text) {
        ensureChannels(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(c, CH_SERVICE)
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
}
