package com.oa.suite.mobile;

/**
 * 后台推送连接的账号判定（不依赖 Android，便于单元测试）。
 * 后台连接只靠 WebView 的会话 Cookie 换令牌，页面里退出登录、换账号或会话过期时都要及时察觉：
 * 账号变化时调用方必须作废旧账号的连接、提醒、补拉游标与去重表；401 或退出登录后不能拿同一个 Cookie 无限重试。
 */
final class PushSession {

    enum Gate {
        /** 没有登录 Cookie：不连接，等页面登录 */
        SIGNED_OUT,
        /** 当前 Cookie 已被服务端拒绝或用户已用它退出：不重试，等页面报告新的登录 */
        BLOCKED,
        PROCEED,
    }

    private String userId;
    private boolean blocked;
    private String blockedCookie;

    /** 当前后台连接所属账号（令牌里的 userId），未知时为 null */
    String userId() {
        return userId;
    }

    boolean isBlocked() {
        return blocked;
    }

    /** 每次建立连接前调用 */
    Gate gate(String cookie) {
        if (cookie == null || cookie.isEmpty()) return Gate.SIGNED_OUT;
        if (blocked && cookie.equals(blockedCookie)) return Gate.BLOCKED;
        // Cookie 变了（页面里重新登录了）：解除封锁，由令牌里的 userId 判断是不是换了账号
        blocked = false;
        blockedCookie = null;
        return Gate.PROCEED;
    }

    /** /api/realtime-token 返回 401：记住这个 Cookie，之后不再用它重试 */
    void onUnauthorized(String cookie) {
        blocked = true;
        blockedCookie = cookie;
    }

    /**
     * 换到令牌后调用。返回 true 表示与上一次连接的账号不同，调用方要先清掉旧账号的一切状态。
     */
    boolean onTokenUser(String tokenUserId) {
        boolean changed = userId != null && tokenUserId != null && !userId.equals(tokenUserId);
        userId = tokenUserId;
        return changed;
    }

    /**
     * 页面报告的当前登录账号；null 表示用户退出登录（cookie 为退出时 WebView 里的 Cookie，可能尚未被删除）。
     * 返回 true 表示调用方要断开连接并清掉旧账号的一切状态。
     */
    boolean onWebSession(String webUserId, String cookie) {
        if (webUserId == null) {
            userId = null;
            blocked = true;
            blockedCookie = cookie == null || cookie.isEmpty() ? null : cookie;
            return true;
        }
        blocked = false;
        blockedCookie = null;
        if (userId != null && !userId.equals(webUserId)) {
            userId = null;
            return true;
        }
        return false;
    }

    /** 切换服务器：账号信息全部作废 */
    void forget() {
        userId = null;
        blocked = false;
        blockedCookie = null;
    }
}
