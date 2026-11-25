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

function envFlag(value: string | undefined): boolean | null {
  const v = value?.trim().toLowerCase();
  return v === "true" ? true : v === "false" ? false : null;
}

/** 显式的 WEBHOOK_ALLOW_PRIVATE_NETWORK=true / false 优先；未配置时仅非生产环境放行内网 */
export function allowPrivateNetwork(): boolean {
  return envFlag(process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK) ?? process.env.NODE_ENV !== "production";
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** WEBHOOK_ALLOWED_HOSTS：逗号分隔的主机名，`*.example.com` 匹配其所有子域名（不含 example.com 本身） */
export function allowedHostPatterns(raw: string | undefined = process.env.WEBHOOK_ALLOWED_HOSTS): string[] {
  return (raw ?? "").split(",").map(normalizeHost).filter(Boolean);
}

export function isAllowedHost(host: string, patterns: string[] = allowedHostPatterns()): boolean {
  const h = normalizeHost(host);
  return patterns.some((p) => (p.startsWith("*.") ? h.endsWith(p.slice(1)) : h === p));
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

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedV4(ip: string): boolean {
  return V4_BLOCKED.some(([base, bits]) => inV4Range(ip, base, bits));
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

/** IPv4 映射 / 兼容地址（::ffff:a.b.c.d、::a.b.c.d）中内嵌的 IPv4 */
function embeddedV4(g: number[]): string | null {
  if (!g.slice(0, 5).every((x) => x === 0) || (g[5] !== 0xffff && g[5] !== 0)) return null;
  return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  const v4 = embeddedV4(g);
  if (v4) return isBlockedV4(v4);
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

/** 统一成 IPv4 点分形式（IPv4 映射 / 兼容的 IPv6 也会还原），其他返回 null */
function asV4(ip: string): string | null {
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind !== 6) return null;
  const g = expandV6(ip);
  return g ? embeddedV4(g) : null;
}

/** Clash / Mihomo 等代理 TUN 模式的 FakeIP 网段 */
function isFakeIp(ip: string): boolean {
  const v4 = asV4(ip);
  return !!v4 && inV4Range(v4, "198.18.0.0", 15);
}

// 云元数据端点：即使放行内网（WEBHOOK_ALLOW_PRIVATE_NETWORK / WEBHOOK_ALLOWED_HOSTS）也一律拦截
const METADATA_HOSTNAMES = new Set(["metadata", "metadata.google.internal", "metadata.goog"]);
const METADATA_V4 = new Set(["169.254.169.254"]);
const METADATA_V6 = "fd00:ec2:0:0:0:0:0:254";

export function isMetadataAddress(ip: string): boolean {
  const v4 = asV4(ip);
  if (v4) return METADATA_V4.has(v4);
  if (isIP(ip) !== 6) return false;
  return expandV6(ip)?.map((x) => x.toString(16)).join(":") === METADATA_V6;
}

function isMetadataHost(host: string): boolean {
  const h = normalizeHost(host);
  return isIP(h) ? isMetadataAddress(h) : METADATA_HOSTNAMES.has(h);
}

const BLOCKED_HOSTNAMES = new Set(["localhost", ...METADATA_HOSTNAMES]);

function isPrivateHostname(host: string): boolean {
  const h = normalizeHost(host);
  return BLOCKED_HOSTNAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal");
}

const ALLOW_HINT = "如目标是可信的本机 / 局域网服务，可设置 WEBHOOK_ALLOW_PRIVATE_NETWORK=true，或把该主机加入 WEBHOOK_ALLOWED_HOSTS";

export type OutboundUrlOptions = {
  /** 是否放行内网 / 环回 / 保留地址，默认取 allowPrivateNetwork() */
  allowPrivate?: boolean;
  /** 按主机名放行的白名单，默认取 WEBHOOK_ALLOWED_HOSTS */
  allowedHosts?: string[];
};

/** 同步校验：协议、格式与字面量地址。返回规范化后的 URL 字符串。 */
export function validateOutboundUrl(raw: string, opts: OutboundUrlOptions = {}): string {
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
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isMetadataHost(host)) throw new Error(`Outbound URL 不能指向云元数据地址（${host}），该限制不可放行`);
  if (!allowPrivate && !isAllowedHost(host, opts.allowedHosts ?? allowedHostPatterns())) {
    if (isIP(host) ? isPrivateAddress(host) : isPrivateHostname(host)) {
      throw new Error(`Outbound URL 不能指向内网、环回或保留地址（${host}）。${ALLOW_HINT}`);
    }
  }
  return url.toString();
}

export type ResolveHost = (host: string) => Promise<{ address: string; family: number }[]>;

const resolveHost: ResolveHost = (host) => lookup(host, { all: true, verbatim: true });

function uniq(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * 发送前再次解析 DNS：解析到云元数据地址时一律拦截；
 * 未放行内网（且主机不在 WEBHOOK_ALLOWED_HOSTS 中）时，解析到内网 / 保留地址也拦截。
 */
export async function assertResolvedPublic(raw: string, opts: OutboundUrlOptions & { resolve?: ResolveHost } = {}): Promise<void> {
  const allowPrivate = opts.allowPrivate ?? allowPrivateNetwork();
  const allowedHosts = opts.allowedHosts ?? allowedHostPatterns();
  validateOutboundUrl(raw, { allowPrivate, allowedHosts });
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  const trusted = allowPrivate || isAllowedHost(host, allowedHosts);
  let addrs: { address: string }[];
  try {
    addrs = await (opts.resolve ?? resolveHost)(host);
  } catch (e) {
    // 已放行时交给 fetch 报告真实的连接错误
    if (trusted) return;
    const code = (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : "未知错误");
    throw new Error(`Outbound URL 域名 ${host} DNS 解析失败（${code}），已拦截`);
  }
  const metadata = uniq(addrs.map((a) => a.address).filter(isMetadataAddress));
  if (metadata.length) throw new Error(`Outbound URL 域名 ${host} 解析到云元数据地址 ${metadata.join(", ")}，已拦截（该限制不可放行）`);
  if (trusted) return;
  if (!addrs.length) throw new Error(`Outbound URL 域名 ${host} 未解析到任何地址，已拦截`);
  const blocked = uniq(addrs.map((a) => a.address).filter(isPrivateAddress));
  if (!blocked.length) return;
  const shown = blocked.slice(0, 5).join(", ") + (blocked.length > 5 ? ` 等 ${blocked.length} 个` : "");
  const fakeIp = blocked.some(isFakeIp)
    ? "；198.18.0.0/15 是 Clash / Mihomo 等代理 TUN 模式的 FakeIP 网段，说明域名被代理接管而非真实公网地址"
    : "";
  throw new Error(`Outbound URL 解析到内网地址，已拦截：${host} → ${shown}${fakeIp}。${ALLOW_HINT}`);
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
