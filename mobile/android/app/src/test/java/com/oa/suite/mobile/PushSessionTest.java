package com.oa.suite.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PushSessionTest {

    @Test
    public void firstConnectIsNotAnAccountChange() {
        PushSession s = new PushSession();
        assertEquals(PushSession.Gate.PROCEED, s.gate("oa_session=a"));
        assertFalse(s.onTokenUser("A"));
        assertEquals("A", s.userId());
    }

    @Test
    public void noCookieMeansSignedOut() {
        PushSession s = new PushSession();
        assertEquals(PushSession.Gate.SIGNED_OUT, s.gate(null));
        assertEquals(PushSession.Gate.SIGNED_OUT, s.gate(""));
    }

    @Test
    public void tokenForAnotherUserIsAnAccountChange() {
        PushSession s = new PushSession();
        s.gate("oa_session=a");
        s.onTokenUser("A");
        // 页面没通知原生层就换了账号（例如退出后直接登录 B），令牌里的 userId 变了
        assertEquals(PushSession.Gate.PROCEED, s.gate("oa_session=b"));
        assertTrue(s.onTokenUser("B"));
        assertEquals("B", s.userId());
        assertFalse(s.onTokenUser("B"));
    }

    @Test
    public void unauthorizedStopsRetryingWithSameCookie() {
        PushSession s = new PushSession();
        s.gate("oa_session=old");
        s.onTokenUser("A");
        s.onUnauthorized("oa_session=old");
        assertEquals(PushSession.Gate.BLOCKED, s.gate("oa_session=old"));
        assertEquals(PushSession.Gate.BLOCKED, s.gate("oa_session=old"));
        // 重新登录后 Cookie 变了才再连
        assertEquals(PushSession.Gate.PROCEED, s.gate("oa_session=new"));
        assertFalse(s.isBlocked());
    }

    @Test
    public void webLogoutBlocksTheCookieStillInWebView() {
        PushSession s = new PushSession();
        s.gate("oa_session=a");
        s.onTokenUser("A");
        // 页面先通知退出，Server Action 删除 Cookie 之前后台可能又尝试连接
        assertTrue(s.onWebSession(null, "oa_session=a"));
        assertNull(s.userId());
        assertEquals(PushSession.Gate.BLOCKED, s.gate("oa_session=a"));
        assertEquals(PushSession.Gate.SIGNED_OUT, s.gate(null));
        // 退出后登录 B：不算“同一账号内的切换”，旧状态在退出时已清掉
        assertEquals(PushSession.Gate.PROCEED, s.gate("oa_session=b"));
        assertFalse(s.onTokenUser("B"));
    }

    @Test
    public void webLoginOfAnotherUserResets() {
        PushSession s = new PushSession();
        s.gate("oa_session=a");
        s.onTokenUser("A");
        assertTrue(s.onWebSession("B", "oa_session=b"));
        assertNull(s.userId());
        assertFalse(s.onTokenUser("B"));
    }

    @Test
    public void webLoginOfSameUserKeepsState() {
        PushSession s = new PushSession();
        s.gate("oa_session=a");
        s.onTokenUser("A");
        assertFalse(s.onWebSession("A", "oa_session=a"));
        assertEquals("A", s.userId());
    }

    @Test
    public void webLoginUnblocksAfterUnauthorized() {
        PushSession s = new PushSession();
        s.onUnauthorized("oa_session=x");
        assertFalse(s.onWebSession("A", "oa_session=x"));
        assertEquals(PushSession.Gate.PROCEED, s.gate("oa_session=x"));
    }

    @Test
    public void forgetDropsIdentityOnServerSwitch() {
        PushSession s = new PushSession();
        s.gate("oa_session=a");
        s.onTokenUser("A");
        s.onUnauthorized("oa_session=a");
        s.forget();
        assertNull(s.userId());
        assertEquals(PushSession.Gate.PROCEED, s.gate("oa_session=a"));
        assertFalse(s.onTokenUser("B"));
    }
}
