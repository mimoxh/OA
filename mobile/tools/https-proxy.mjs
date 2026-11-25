#!/usr/bin/env node
/**
 * M0 联调辅助：本机自签 HTTPS 反向代理（模拟 NAS 前的 Nginx/Caddy），支持 WebSocket 升级。
 *
 *   node mobile/tools/https-proxy.mjs --pfx mobile/.devcerts/oa-dev.p12 --pass <口令> --listen 3443 --target http://127.0.0.1:3320
 *
 * 保留原始 Host，补 X-Forwarded-Proto/For/Host，与常见反代配置一致。仅用于开发验证，无第三方依赖。
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const target = new URL(args.target || "http://127.0.0.1:3320");
const listen = Number(args.listen || 3443);
const server = https.createServer({ pfx: fs.readFileSync(args.pfx), passphrase: args.pass });

function forwardedHeaders(req) {
  const headers = { ...req.headers };
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host;
  headers["x-forwarded-for"] = req.socket.remoteAddress;
  return headers;
}

server.on("request", (req, res) => {
  const up = http.request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: forwardedHeaders(req) },
    (r) => {
      res.writeHead(r.statusCode, r.statusMessage, r.headers);
      r.pipe(res);
    },
  );
  up.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("upstream error: " + e.message);
  });
  req.pipe(up);
});

server.on("upgrade", (req, socket, head) => {
  const up = net.connect(Number(target.port), target.hostname, () => {
    const headers = forwardedHeaders(req);
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => {
    up.destroy();
    socket.destroy();
  };
  up.on("error", close);
  socket.on("error", close);
});

server.listen(listen, "0.0.0.0", () => console.log(`https proxy :${listen} -> ${target.origin}`));
