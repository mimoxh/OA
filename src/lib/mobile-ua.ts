/** 手机 App 会在 WebView 的 User-Agent 末尾追加该标记（mobile/android MainActivity.userAgentMark） */
export const MOBILE_UA_MARK = "OAMobile/";

export function isMobileUserAgent(ua: string | null | undefined): boolean {
  return (ua ?? "").includes(MOBILE_UA_MARK);
}
