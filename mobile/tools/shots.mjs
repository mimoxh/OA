#!/usr/bin/env node
/**
 * 联调辅助：无头 Edge/Chrome 登录 OA 后按给定视口逐页截图（桌面回归 / 窄屏布局对比）。
 *
 *   node mobile/tools/shots.mjs <serverUrl> <email> <outDir> <width>x<height> <path> [path...]
 *
 * 路径可写成 `name=/messages/xxx`，截图文件名取 name；否则由路径生成。窄屏（宽 < 768）时开启触摸与移动端模拟。
 * 使用独立的临时浏览器配置目录（.tmp/shots-profile-*）。密码默认 123456，可用 PEER_PASSWORD 覆盖。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openCdp } from "./peer.mjs";

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [server, email, outDir, size, ...paths] = process.argv.slice(2);
  if (!server || !email || !outDir || !/^\d+x\d+$/.test(size || "") || !paths.length) {
    console.error("用法：shots.mjs <serverUrl> <email> <outDir> <w>x<h> <path...>");
    process.exit(2);
  }
  const [width, height] = size.split("x").map(Number);
  const mobile = width < 768;
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("未找到 Edge / Chrome");
  fs.mkdirSync(outDir, { recursive: true });
  const profile = path.resolve(".tmp", "shots-profile-" + email.replace(/[^a-z0-9]/gi, "_"));
  const port = 9800 + Math.floor(Math.random() * 150);
  const proc = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
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
    await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2.625 : 1, mobile });
    if (mobile) await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const go = async (p) => {
      await c.send("Page.navigate", { url: server + p });
      await sleep(300);
      await c.waitFor("document.readyState==='complete'", 60_000);
    };
    await go(paths[0].split("=").pop());
    if (await c.evaluate("location.pathname.startsWith('/login')")) {
      const pw = process.env.PEER_PASSWORD || "123456";
      await c.evaluate(`(() => { const f = document.querySelector('form'); f.email.value = ${JSON.stringify(email)}; f.password.value = ${JSON.stringify(pw)}; f.requestSubmit(); return true; })()`);
      await c.waitFor("!location.pathname.startsWith('/login')", 60_000);
    }
    for (const item of paths) {
      const p = item.includes("=") ? item.slice(item.indexOf("=") + 1) : item;
      const name = item.includes("=") ? item.slice(0, item.indexOf("=")) : p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
      await go(p);
      await sleep(Number(process.env.SHOT_DELAY || 2500));
      const { data } = await c.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(outDir, name + ".png");
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log(file);
    }
    c.close();
  } finally {
    proc.kill();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
