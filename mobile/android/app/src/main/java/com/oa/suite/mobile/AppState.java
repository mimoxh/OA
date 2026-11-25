package com.oa.suite.mobile;

/** 进程内 App 前后台状态（MainActivity onStart/onStop 维护），供前台服务判断是否需要弹通知。 */
final class AppState {

    private static volatile boolean foreground = false;

    private AppState() {}

    static boolean isForeground() {
        return foreground;
    }

    static void setForeground(boolean value) {
        foreground = value;
    }
}
