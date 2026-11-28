import "server-only";
import { headers } from "next/headers";
import { isMobileUserAgent } from "./mobile-ua";

export { MOBILE_UA_MARK, isMobileUserAgent } from "./mobile-ua";

export async function isMobileRequest(): Promise<boolean> {
  return isMobileUserAgent((await headers()).get("user-agent"));
}
