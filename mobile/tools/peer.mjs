#!/usr/bin/env node
/**
 * M0 联调辅助：在本机无头 Edge/Chrome 里以另一个账号登录 OA 并发送 IM 消息，模拟“对方发来消息”。
 *
 *   node mobile/tools/peer.mjs <serverUrl> <email> <conversationId> <text>
 *
 * 使用独立的临时浏览器配置目录（.tmp/peer-profile-*），不会碰用户自己的浏览器数据。密码默认 123456（演示账号），可用 PEER_PASSWORD 覆盖。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {}
      await sleep(300);
    }
    throw new Error("等待超时：" + expression);
  };
  return { send, evaluate, waitFor, close: () => ws.close() };
}

/** 在已打开会话页的 CDP 页面里通过编辑器发送一条文本消息（走真实的 Tiptap 输入 + Enter → Server Action）。 */
export async function sendViaComposer(c, text) {
  await c.waitFor("!!document.querySelector('.ProseMirror[contenteditable=true]')");
  await c.evaluate("document.querySelector('.ProseMirror[contenteditable=true]').focus(), true");
  await c.send("Input.insertText", { text });
  await sleep(200);
  for (const type of ["keyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
  }
  // 编辑器清空即认为已提交；消息出现在列表里由调用方另行确认
  await c.waitFor(`(document.querySelector('.ProseMirror[contenteditable=true]')?.innerText||'').trim()===''`, 10_000);
}

async function main() {
  const [server, email, conversationId, ...rest] = process.argv.slice(2);
  const text = rest.join(" ");
  if (!server || !email || !conversationId || !text) {
    console.error("用法：peer.mjs <serverUrl> <email> <conversationId> <text>");
    process.exit(2);
  }
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("未找到 Edge / Chrome");
  const profile = path.resolve(".tmp", "peer-profile-" + email.replace(/[^a-z0-9]/gi, "_"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(300);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
      } catch {}
    }
    if (!target) throw new Error("浏览器 DevTools 未就绪");
    const c = await openCdp(target.webSocketDebuggerUrl);
    await c.send("Page.enable");
    await c.send("Page.navigate", { url: `${server}/messages/${conversationId}` });
    await c.waitFor("document.readyState==='complete'");
    if (await c.evaluate("location.pathname.startsWith('/login')")) {
      const pw = process.env.PEER_PASSWORD || "123456";
      await c.evaluate(`(() => { const f = document.querySelector('form'); f.email.value = ${JSON.stringify(email)}; f.password.value = ${JSON.stringify(pw)}; f.requestSubmit(); return true; })()`);
      await c.waitFor("location.pathname.startsWith('/messages')", 30_000);
      if (!(await c.evaluate(`location.pathname === ${JSON.stringify("/messages/" + conversationId)}`))) {
        await c.send("Page.navigate", { url: `${server}/messages/${conversationId}` });
        await c.waitFor("document.readyState==='complete'");
      }
    }
    await sendViaComposer(c, text);
    await c.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, 10_000);
    console.log(JSON.stringify({ ok: true, sentAt: Date.now(), text }));
    c.close();
  } finally {
    proc.kill();
  }
}

if (process.argv[1]?.endsWith("peer.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
