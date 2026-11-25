import http from "node:http";
import net from "node:net";
import os from "node:os";

type GatewayOptions = {
  port: number;
  host: string;
  nextPort: number;
  collabPort: number;
  rtPort: number;
  controlToken?: string;
  onShutdown?: () => void;
  /** 是否启用仅回环可用的桌面壳控制接口 /__oa/*（桌面端默认开启，容器模式关闭） */
  enableControl?: boolean;
  /** 可选公开健康检查接口 GET /health（容器 / 反向代理探活用） */
  healthCheck?: () => Promise<{ ok: boolean; [key: string]: unknown }>;
};

/** 本机局域网 IPv4 地址（私有网段优先，排除链路本地地址） */
export function lanAddresses(port: number) {
  const list: { name: string; url: string; priority: number }[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || info.address.startsWith("169.254.")) continue;
      const a = info.address;
      const isPrivate = a.startsWith("192.168.") || a.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
      const isVirtual = /vEthernet|VMware|VirtualBox|WSL|Hyper-V|Docker|Loopback|TAP|Tailscale|ZeroTier/i.test(name);
      list.push({ name, url: `http://${a}:${port}`, priority: (isPrivate ? 0 : 2) + (isVirtual ? 1 : 0) });
    }
  }
  return list.sort((x, y) => x.priority - y.priority).map(({ name, url }) => ({ name, url }));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store" });
  res.end(data);
}

function isLoopback(addr: string | undefined) {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/**
 * 对外网关：整个服务只占一个端口。普通 HTTP 转发给 Next；
 * WebSocket 的 /collab 转发给 Hocuspocus，/rt 转发给实时服务。协同 / 实时服务的内部 HTTP 接口不对外暴露。
 */
export function startGateway(opts: GatewayOptions) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  const lan = opts.host === "0.0.0.0";
  const enableControl = opts.enableControl !== false;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (opts.healthCheck && req.method === "GET" && (url === "/health" || url.startsWith("/health?"))) {
      opts
        .healthCheck()
        .then((body) => sendJson(res, body.ok ? 200 : 503, body))
        .catch(() => sendJson(res, 503, { ok: false }));
      return;
    }

    if (enableControl && url.startsWith("/__oa/")) {
      const local = isLoopback(req.socket.remoteAddress);
      if (url === "/__oa/health" && req.method === "GET" && local) {
        sendJson(res, 200, { ok: true, lan, addresses: lan ? lanAddresses(opts.port) : [] });
        return;
      }
      if (
        url === "/__oa/shutdown" &&
        req.method === "POST" &&
        local &&
        opts.controlToken &&
        opts.onShutdown &&
        req.headers["x-oa-control"] === opts.controlToken
      ) {
        sendJson(res, 200, { ok: true });
        opts.onShutdown();
        return;
      }
      sendJson(res, 404, { ok: false });
      return;
    }

    const headers = { ...req.headers };
    const remote = req.socket.remoteAddress ?? "";
    const prevFor = req.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = prevFor ? `${Array.isArray(prevFor) ? prevFor.join(", ") : prevFor}, ${remote}` : remote;
    // 透传外部反向代理（Nginx / Lucky / NPM / fnOS 反代）的协议与主机头，直连时回退 http 与 Host
    if (!req.headers["x-forwarded-proto"]) headers["x-forwarded-proto"] = "http";
    if (!req.headers["x-forwarded-host"] && req.headers.host) headers["x-forwarded-host"] = req.headers.host;

    const upstream = http.request(
      { host: "127.0.0.1", port: opts.nextPort, method: req.method, path: url, headers, agent },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) sendJson(res, 502, { ok: false, error: "服务暂不可用" });
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "/";
    const m = /^\/(collab|rt)(?=[/?]|$)/.exec(url);
    if (!m) {
      socket.destroy();
      return;
    }
    const port = m[1] === "collab" ? opts.collabPort : opts.rtPort;
    let rest = url.slice(m[0].length);
    if (!rest.startsWith("/")) rest = "/" + rest;

    const upstream = net.connect(port, "127.0.0.1", () => {
      const lines = [`${req.method} ${rest} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      lines.push(`X-Forwarded-For: ${req.socket.remoteAddress ?? ""}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.setNoDelay(true);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
  });

  return new Promise<http.Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
