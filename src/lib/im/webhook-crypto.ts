import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ── 入站 Token ──

export const INBOUND_TOKEN_PREFIX = "whsec_";

export function generateInboundToken(): { token: string; hash: string; prefix: string } {
  const token = INBOUND_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashInboundToken(token), prefix: token.slice(0, INBOUND_TOKEN_PREFIX.length + 6) };
}

export function hashInboundToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 常量时间比较：先各自哈希为等长摘要，避免泄露长度与前缀匹配信息 */
export function verifyInboundToken(token: string | null | undefined, expectedHash: string): boolean {
  if (!token || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashInboundToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function maskTokenPrefix(prefix: string): string {
  return `${prefix}…`;
}

export function parseBearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

// ── 凭据加密（AES-256-GCM，密钥由 AUTH_SECRET 经 HKDF 派生） ──

const ENC_VERSION = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return Buffer.from(hkdfSync("sha256", secret, "oa-webhook-connector", "webhook-credentials-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ver, iv, tag, ct] = payload.split(":");
  if (ver !== ENC_VERSION || !iv || !tag || ct === undefined) throw new Error("凭据格式不正确");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function decryptOptional(payload: string | null | undefined): string | null {
  return payload ? decryptSecret(payload) : null;
}

// ── 出站签名 ──

/** X-OA-Signature: sha256=<hex HMAC-SHA256(secret, rawBody)> */
export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// ── 出站 URL 校验（SSRF 防护） ──

export function allowPrivateNetwork(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK === "true" || process.env.NODE_ENV !== "production";
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // 末尾内嵌 IPv4（::ffff:1.2.3.4）
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g || "0", 16));
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4 映射 / 兼容地址按 IPv4 规则判断
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isBlockedV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地（含 fd00:ec2::254 元数据）
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((g[0] & 0xff00) === 0xff00) return true; // 组播
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 文档地址
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal", "metadata.goog"]);

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return BLOCKED_HOSTNAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal");
}

/** 同步校验：协议、格式与字面量地址。返回规范化后的 URL 字符串。 */
export function validateOutboundUrl(raw: string, opts: { allowPrivate?: boolean } = {}): string {
  const allowPrivate = opts.allowPrivate ?? allowPrivateNetwork();
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Outbound URL 格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Outbound URL 仅支持 http 或 https");
  if (url.username || url.password) throw new Error("Outbound URL 不能包含账号密码，请改用自定义 Header");
  if (!url.hostname) throw new Error("Outbound URL 缺少主机名");
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) ? isPrivateAddress(host) : isPrivateHostname(host)) {
      throw new Error("Outbound URL 不能指向内网、环回或云元数据地址（可设置 WEBHOOK_ALLOW_PRIVATE_NETWORK=true 放行）");
    }
  }
  return url.toString();
}

/** 发送前再次解析 DNS，拦截解析到内网的域名 */
export async function assertResolvedPublic(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<void> {
  const allowPrivate = opts.allowPrivate ?? allowPrivateNetwork();
  validateOutboundUrl(raw, { allowPrivate });
  if (allowPrivate) return;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Outbound URL 解析到内网地址，已拦截");
  }
}

export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.length > 1 ? "/…" : "";
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "（无效地址）";
  }
}

// ── 自定义 Header ──

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "content-type", "connection", "transfer-encoding"]);

export function parseHeadersJson(raw: string | null | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("自定义 Header 需为 JSON 对象，例如 {\"Authorization\":\"Bearer xxx\"}");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("自定义 Header 需为 JSON 对象");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(k)) throw new Error(`Header 名称「${k}」不合法`);
    if (FORBIDDEN_HEADERS.has(k.toLowerCase()) || k.toLowerCase().startsWith("x-oa-")) throw new Error(`Header「${k}」由系统设置，不能自定义`);
    if (typeof v !== "string" || v.length > 2000 || /[\r\n]/.test(v)) throw new Error(`Header「${k}」的值需为单行字符串`);
    out[k] = v;
  }
  if (Object.keys(out).length > 20) throw new Error("自定义 Header 最多 20 个");
  return out;
}
