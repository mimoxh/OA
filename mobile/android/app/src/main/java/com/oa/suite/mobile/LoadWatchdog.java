package com.oa.suite.mobile;

/**
 * 主框架加载看门狗：服务器静默丢包或接受连接却不响应时，Chromium 要等 2 分钟以上（或一直不）报错，
 * 期间页面是空白的。壳层发起的主文档加载在限定时间内没有出现首帧（onPageCommitVisible / onPageFinished）
 * 就回调 onTimeout，由 MainActivity 停止加载并切到包内错误页。
 *
 * 不依赖 Android 类，定时与时钟由 Scheduler 提供，便于单元测试。所有方法都在主线程调用。
 */
final class LoadWatchdog {

    static final long DEFAULT_TIMEOUT_MS = 12_000;
    /** 回到前台时剩余时间太少也至少再等这么久，避免刚回到前台就跳错误页 */
    static final long MIN_RESUME_MS = 2_000;

    interface Scheduler {
        long now();
        Object schedule(Runnable task, long delayMs);
        void cancel(Object handle);
    }

    interface Listener {
        void onTimeout(String url);
    }

    private final Scheduler scheduler;
    private final Listener listener;
    private final long timeoutMs;

    private String url;
    private long deadline;
    private long remainingWhenPaused;
    private boolean paused;
    private Object handle;
    private int generation;

    LoadWatchdog(Scheduler scheduler, Listener listener, long timeoutMs) {
        this.scheduler = scheduler;
        this.listener = listener;
        this.timeoutMs = timeoutMs;
    }

    /** 只看远程服务器的主文档；包内页面（https://localhost/...）、about:blank、data: 等不计时 */
    static boolean isRemoteDocument(String url) {
        if (url == null) return false;
        String u = url.toLowerCase(java.util.Locale.ROOT);
        if (!u.startsWith("http://") && !u.startsWith("https://")) return false;
        return !u.matches("^https://localhost([/?#].*)?$");
    }

    /** 新的主文档加载：重新计时（旧的计时作废） */
    void arm(String target) {
        if (!isRemoteDocument(target)) {
            settle();
            return;
        }
        cancelTask();
        url = target;
        paused = false;
        deadline = scheduler.now() + timeoutMs;
        schedule(timeoutMs);
    }

    /** 页面已出现首帧、已显示包内页面、已转为下载或已由 WebView 自己报错：停止计时 */
    void settle() {
        cancelTask();
        url = null;
        paused = false;
    }

    /** Activity 切到后台：暂停计时，回到前台时按剩余时间继续 */
    void pause() {
        if (url == null || paused) return;
        cancelTask();
        remainingWhenPaused = deadline - scheduler.now();
        paused = true;
    }

    void resume() {
        if (url == null || !paused) return;
        paused = false;
        long delay = Math.max(remainingWhenPaused, MIN_RESUME_MS);
        deadline = scheduler.now() + delay;
        schedule(delay);
    }

    boolean isPending() {
        return url != null;
    }

    boolean isPaused() {
        return paused;
    }

    String pendingUrl() {
        return url;
    }

    long timeoutMs() {
        return timeoutMs;
    }

    private void schedule(long delay) {
        final int gen = ++generation;
        handle = scheduler.schedule(() -> fire(gen), delay);
    }

    private void cancelTask() {
        generation++;
        if (handle != null) scheduler.cancel(handle);
        handle = null;
    }

    private void fire(int gen) {
        // 已取消或被新的加载替换的计时即使已排队也不生效
        if (gen != generation || url == null || paused) return;
        String target = url;
        handle = null;
        url = null;
        listener.onTimeout(target);
    }
}
