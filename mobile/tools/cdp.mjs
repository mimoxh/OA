#!/usr/bin/env node
/**
 * M0 联调辅助：通过 adb 转发 WebView DevTools 端口，用 CDP 在 App 内的 WebView 里执行脚本（仅 debug 包可用）。
 *
 *   node mobile/tools/cdp.mjs eval "location.href"
 *   node mobile/tools/cdp.mjs eval-file script.js
 *   node mobile/tools/cdp.mjs pages
 *   node mobile/tools/cdp.mjs upload-files "input[type=file]" C:\path\a.png   (CDP 直接给 input 赋文件，不经系统选择器)
 *
 * 环境变量：ADB（adb 路径）、CDP_PORT（本机转发端口，默认 9333）、CDP_PAGE（页面 URL 子串，默认取第一个页面）。
 * 依赖 Node 22+ 内置 WebSocket / fetch，无第三方依赖。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ADB = process.env.ADB || path.join(process.env.LOCALAPPDATA || os.homedir(), "Android", "Sdk", "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const PORT = Number(process.env.CDP_PORT || 9333);
const PKG = "com.oa.suite.mobile";

function adb(...args) {
  return execFileSync(ADB, args, { encoding: "utf8" });
}

function forward() {
  const pid = adb("shell", "pidof", PKG).trim().split(/\s+/)[0];
  if (!pid) throw new Error(`${PKG} 未运行`);
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  return pid;
}

async function pages() {
  forward();
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = (await res.json()).filter((p) => p.type === "page");
      if (list.length) return list;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("没有可调试的 WebView 页面");
}

export async function connect(match = process.env.CDP_PAGE) {
  const list = await pages();
  const page = (match && list.find((p) => p.url.includes(match))) || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
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
  return { page, send, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "pages") {
    console.log(JSON.stringify((await pages()).map((p) => ({ url: p.url, title: p.title })), null, 2));
    return;
  }
  const c = await connect();
  try {
    if (cmd === "eval" || cmd === "eval-file") {
      const expr = cmd === "eval" ? args.join(" ") : fs.readFileSync(args[0], "utf8");
      const value = await c.evaluate(expr);
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    } else if (cmd === "upload-files") {
      const [selector, ...files] = args;
      await c.send("DOM.enable");
      const { root } = await c.send("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await c.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      await c.send("DOM.setFileInputFiles", { nodeId, files: files.map((f) => path.resolve(f)) });
      console.log("ok");
    } else {
      console.error("用法：cdp.mjs pages | eval <expr> | eval-file <file> | upload-files <selector> <files...>");
      process.exitCode = 2;
    }
  } finally {
    c.close();
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("cdp.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
