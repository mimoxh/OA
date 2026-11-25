# 手机端部署：HTTPS 与证书

> 适用于 Android App（`mobile/`，Capacitor 套壳）。服务端部署本身见 `docs/NAS_DEPLOY.md`，本文只讲手机端需要服务端额外做好的事。

## 1. 为什么要 HTTPS

手机 App 在 WebView 里直接加载服务器上的 OA 页面，页面能用哪些能力由浏览器的「安全上下文」规则决定：

| 访问方式 | IM 收发、文件、图片、通知 | 复制 | 音视频通话（摄像头 / 麦克风） | 说明 |
| --- | --- | --- | --- | --- |
| `https://` + 受信任证书 | 可用 | 可用 | 可用 | **推荐，正式环境只用这种** |
| 局域网 `http://192.168.x.x` | 可用 | 可用（App 走原生剪贴板，浏览器回退到旧接口） | **不可用** | 只适合临时内网试用；流量明文 |
| `https://` + 自签证书 | **连不上** | — | — | release 包只信任系统内置 CA |

release 包的 `network_security_config.xml` 只信任**系统 CA**（`<certificates src="system" />`），不信任用户自行安装的证书，也不内置任何自签证书。这是有意的：信任用户证书会让手机上任何被装了证书的代理都能解密 OA 流量。因此正式环境必须使用公共 CA 签发的证书，最省事的是 **Let's Encrypt 自动签发、自动续期**。

> debug 包额外信任用户安装的 CA，以及构建机上的 `mobile/.devcerts/`（不入库），只用于联调，见 `mobile/README.md`。

## 2. 推荐拓扑

```
手机 App / 浏览器 ──HTTPS──▶ 反向代理（443，Let's Encrypt 证书，自动续期）──HTTP──▶ OA 容器 :3000
                                 └─ /collab、/rt 为同源 WebSocket，必须透传 Upgrade
```

OA 容器端 `.env.nas`：

```dotenv
SESSION_COOKIE_SECURE=true
OA_PUBLIC_BASE_URL=https://oa.example.com
COLLAB_PUBLIC_URL=/collab
REALTIME_PUBLIC_URL=/rt
```

反向代理必配项与 `docs/NAS_DEPLOY.md` §4 模式 B 相同：开启 WebSocket、透传 `X-Forwarded-Proto` / `X-Forwarded-Host`、请求体上限 ≥ 60 MB、读写超时 ≥ 300 秒（手机后台连接是长连接，建议 3600 秒）。

## 3. 证书怎么拿（任选其一）

### 方案 A：有公网 80/443 端口（HTTP-01 验证，最简单）

域名 `oa.example.com` 的 A/AAAA 记录指向公网 IP，路由器把 80、443 转发到 NAS。用 Caddy 时一份配置即可，证书自动申请并在到期前 30 天自动续期：

```caddyfile
oa.example.com {
  request_body {
    max_size 60MB
  }
  reverse_proxy 127.0.0.1:3000 {
    # Caddy 默认透传 X-Forwarded-Proto/Host，并自动处理 WebSocket Upgrade
    transport http {
      read_timeout 3600s
      write_timeout 3600s
    }
  }
}
```

Nginx Proxy Manager / 飞牛自带反代 / Lucky：新建代理主机 → 打开「WebSocket 支持」→ SSL 选 Let's Encrypt 并勾选「强制 HTTPS」，这些工具都会自动续期。

### 方案 B：没有公网端口，只在内网用（DNS-01 验证）

Let's Encrypt 不会给裸 IP 或 `.local` 域名签证书，但可以给**自己拥有的公网域名**签证书，即使这个域名只在内网解析：

1. 用 DNS-01 验证申请证书（不需要开放任何端口）：Lucky、Nginx Proxy Manager、acme.sh、带 DNS 插件的 Caddy 都支持，填入域名服务商（阿里云、腾讯云 DNSPod、Cloudflare 等）的 API 密钥即可自动续期。
2. 在路由器或内网 DNS（AdGuard Home、路由器「静态 DNS」等）里把 `oa.example.com` 解析到 NAS 的局域网 IP，例如 `192.168.1.20`。
3. 手机连上公司 Wi-Fi 后在 App 里填 `https://oa.example.com`。

这样内网访问也是受信任的 HTTPS，App、浏览器、桌面端都能用摄像头和麦克风。

### 不推荐

- 自签证书：release 包连不上；浏览器每台设备都要手动信任。
- 给 App 内置自签 CA：所有用户共用一把私钥，泄露后无法吊销。

## 4. 验收

1. 电脑浏览器打开 `https://oa.example.com/health`，返回 `200` 且证书链显示为 Let's Encrypt（或其他公共 CA）。
2. App 启动页填入 `https://oa.example.com` →「检测」显示连接成功 →「连接」→ 登录。
3. 发一条消息、一张图片，对方实时收到；杀掉 App 再打开仍保持登录。
4. 证书续期：Caddy / NPM / Lucky 默认到期前 30 天续期，续期后无需重启 OA 容器，也无需重新安装 App。

## 5. 登录有效期

- 手机 App 登录：30 天滑动续期。期间只要打开过 App（发起过页面请求）就自动顺延；连续 30 天没打开需要重新登录；无论是否活跃，距上次输入密码满 180 天必须重新登录。
- 浏览器 / 桌面端登录：仍为 7 天固定有效期，不续期。
- 客户端类型在登录时写入签名令牌，之后修改 User-Agent 不能把浏览器会话变成 30 天会话。
