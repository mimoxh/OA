import { createHash, createHmac } from "node:crypto";
import type { StorageDriver, StorageObject } from "./types";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 轻量 S3 兼容存储驱动（AWS SigV4 + 原生 fetch，无额外 SDK 依赖）。
 * 兼容 AWS S3、MinIO、Cloudflare R2、阿里云 OSS 等对象存储，适合多实例部署。
 */
export class S3StorageDriver implements StorageDriver {
  readonly kind = "s3" as const;

  constructor(private readonly cfg: S3Config) {}

  private buildUrl(key: string): URL {
    const cleanKey = key
      .replace(/^\/+/, "")
      .split("/")
      .map(encodeRfc3986)
      .join("/");
    const base = new URL(this.cfg.endpoint);
    if (this.cfg.forcePathStyle) {
      const prefix = base.pathname.replace(/\/+$/, "");
      base.pathname = `${prefix}/${encodeRfc3986(this.cfg.bucket)}/${cleanKey}`;
      return base;
    }
    base.hostname = `${this.cfg.bucket}.${base.hostname}`;
    base.pathname = `/${cleanKey}`;
    return base;
  }

  private sign(method: string, url: URL, body: Uint8Array, extraHeaders: Record<string, string> = {}): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);

    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers[k.toLowerCase()] = v.trim();
    }

    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
    const signedHeaders = sortedKeys.join(";");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const url = this.buildUrl(key);
    const headers = this.sign("PUT", url, data, { "content-type": contentType });
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`S3 上传失败 (${res.status})`);
  }

  async get(key: string): Promise<StorageObject | null> {
    const url = this.buildUrl(key);
    const headers = this.sign("GET", url, new Uint8Array(0));
    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 读取失败 (${res.status})`);
    const ab = await res.arrayBuffer();
    return {
      data: new Uint8Array(ab),
      contentType: res.headers.get("content-type") ?? undefined,
    };
  }

  async delete(key: string): Promise<void> {
    const url = this.buildUrl(key);
    const headers = this.sign("DELETE", url, new Uint8Array(0));
    const res = await fetch(url, { method: "DELETE", headers });
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`S3 删除失败 (${res.status})`);
  }
}
