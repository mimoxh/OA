package com.oa.suite.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

public class LoadWatchdogTest {

    /** 手动推进的时钟 + 定时队列 */
    private static final class FakeScheduler implements LoadWatchdog.Scheduler {
        long now;
        final List<Object[]> tasks = new ArrayList<>();

        @Override
        public long now() {
            return now;
        }

        @Override
        public Object schedule(Runnable task, long delayMs) {
            Object[] t = { task, now + delayMs };
            tasks.add(t);
            return t;
        }

        @Override
        public void cancel(Object handle) {
            tasks.remove(handle);
        }

        void advance(long ms) {
            long target = now + ms;
            while (true) {
                Object[] next = null;
                for (Object[] t : tasks) if ((long) t[1] <= target && (next == null || (long) t[1] < (long) next[1])) next = t;
                if (next == null) break;
                tasks.remove(next);
                now = (long) next[1];
                ((Runnable) next[0]).run();
            }
            now = target;
        }
    }

    private FakeScheduler clock;
    private List<String> fired;
    private LoadWatchdog wd;

    @Before
    public void setUp() {
        clock = new FakeScheduler();
        fired = new ArrayList<>();
        wd = new LoadWatchdog(clock, fired::add, 12_000);
    }

    @Test
    public void firesWhenNoFirstFrameWithinTimeout() {
        wd.arm("http://192.168.124.39:3400");
        clock.advance(11_999);
        assertTrue(fired.isEmpty());
        clock.advance(1);
        assertEquals(List.of("http://192.168.124.39:3400"), fired);
        assertFalse(wd.isPending());
        clock.advance(60_000);
        assertEquals(1, fired.size());
    }

    @Test
    public void settleBeforeTimeoutCancels() {
        wd.arm("https://oa.example.com/messages/1");
        clock.advance(8_000);
        wd.settle();
        clock.advance(30_000);
        assertTrue(fired.isEmpty());
        assertTrue(clock.tasks.isEmpty());
    }

    @Test
    public void newNavigationRestartsTheTimer() {
        wd.arm("http://a:3000");
        clock.advance(10_000);
        wd.arm("http://a:3000/messages/2");
        clock.advance(10_000);
        assertTrue(fired.isEmpty());
        clock.advance(2_000);
        assertEquals(List.of("http://a:3000/messages/2"), fired);
        assertEquals(0, clock.tasks.size());
    }

    @Test
    public void localPagesAreNotWatchedAndClearPendingLoad() {
        assertFalse(LoadWatchdog.isRemoteDocument("https://localhost/error.html"));
        assertFalse(LoadWatchdog.isRemoteDocument("https://localhost"));
        assertFalse(LoadWatchdog.isRemoteDocument("about:blank"));
        assertFalse(LoadWatchdog.isRemoteDocument("data:text/html,x"));
        assertFalse(LoadWatchdog.isRemoteDocument(null));
        assertTrue(LoadWatchdog.isRemoteDocument("http://localhost:3000"));
        assertTrue(LoadWatchdog.isRemoteDocument("https://localhost.example.com"));
        assertTrue(LoadWatchdog.isRemoteDocument("http://192.168.124.220:3001/login"));

        wd.arm("http://a:3000");
        wd.arm("https://localhost/index.html");
        assertFalse(wd.isPending());
        clock.advance(20_000);
        assertTrue(fired.isEmpty());
    }

    @Test
    public void backgroundPausesAndForegroundResumesWithRemainingTime() {
        wd.arm("http://a:3000");
        clock.advance(5_000);
        wd.pause();
        assertTrue(wd.isPaused());
        assertTrue(clock.tasks.isEmpty());
        clock.advance(60_000);
        assertTrue(fired.isEmpty());
        wd.resume();
        clock.advance(6_999);
        assertTrue(fired.isEmpty());
        clock.advance(1);
        assertEquals(1, fired.size());
    }

    @Test
    public void resumeAfterDeadlineStillWaitsAShortGrace() {
        wd.arm("http://a:3000");
        clock.advance(11_000);
        wd.pause();
        clock.advance(120_000);
        wd.resume();
        clock.advance(LoadWatchdog.MIN_RESUME_MS - 1);
        assertTrue(fired.isEmpty());
        clock.advance(1);
        assertEquals(1, fired.size());
    }

    @Test
    public void pauseResumeWithoutPendingLoadIsNoop() {
        wd.pause();
        wd.resume();
        assertTrue(clock.tasks.isEmpty());
        assertNull(wd.pendingUrl());
    }

    @Test
    public void staleQueuedTaskDoesNotFireAfterSettle() {
        // Handler.removeCallbacks 失败或回调已出队时，旧计时也不能误杀新页面
        LoadWatchdog.Scheduler leaky = new LoadWatchdog.Scheduler() {
            @Override public long now() { return clock.now(); }
            @Override public Object schedule(Runnable task, long delayMs) { return clock.schedule(task, delayMs); }
            @Override public void cancel(Object handle) {}
        };
        LoadWatchdog w = new LoadWatchdog(leaky, fired::add, 12_000);
        w.arm("http://a:3000");
        clock.advance(3_000);
        w.settle();
        w.arm("http://a:3000/x");
        clock.advance(9_500);
        assertTrue(fired.isEmpty());
        clock.advance(2_500);
        assertEquals(List.of("http://a:3000/x"), fired);
    }
}
