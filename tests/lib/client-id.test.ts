import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { randomId } from "@/lib/client-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
}

describe("randomId（不依赖安全上下文的客户端 ID）", () => {
  afterEach(() => Object.defineProperty(globalThis, "crypto", original));

  it("有 crypto.randomUUID 时直接使用", () => {
    assert.match(randomId(), UUID_V4);
  });

  it("局域网 HTTP（没有 randomUUID，只有 getRandomValues）时仍生成 UUID v4", () => {
    setCrypto({ getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 2000 }, () => randomId()));
    assert.equal(ids.size, 2000);
    for (const id of ids) assert.match(id, UUID_V4);
  });

  it("连 crypto 都没有时退回 Math.random，格式不变", () => {
    setCrypto(undefined);
    assert.match(randomId(), UUID_V4);
  });

  it("长度满足 sendMessage 对 clientMsgId 的校验（1–64）", () => {
    setCrypto({ getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) });
    assert.equal(randomId().length, 36);
  });
});
