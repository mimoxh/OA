package com.oa.suite.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 开机 / App 升级后自动恢复后台连接，无需打开 App。
 * specialUse 前台服务不在 Android 15 限制 BOOT_COMPLETED 启动的类型之列；国产 ROM 还需用户允许“自启动”才会收到广播。
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) return;
        switch (action) {
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
            case "android.intent.action.QUICKBOOT_POWERON":
            case "com.htc.intent.action.QUICKBOOT_POWERON":
                break;
            default:
                return;
        }
        if (!RtService.shouldRun(context)) return;
        Log.i("OARt", "restore background connection after " + action);
        RtService.start(context);
    }
}
