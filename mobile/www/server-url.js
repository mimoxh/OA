// 启动页的服务器地址规范化，规则与原生层 ServerStore.normalize 一致：
// 没写协议时补 http://（局域网 IP:端口 最常见），只接受 http / https，去掉首尾空格和结尾斜杠。
(function (root) {
  "use strict";

  var FORMAT = "地址格式不正确，例如 192.168.1.20:3000 或 https://oa.example.com";

  function normalizeServerUrl(raw) {
    var v = String(raw == null ? "" : raw).trim();
    // 先判断有没有协议再去结尾斜杠，否则只输入「http://」会被当成主机名 http
    var hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
    while (v.charAt(v.length - 1) === "/") v = v.slice(0, -1);
    if (!v) return { error: "请输入服务器地址" };
    if (/\s/.test(v)) return { error: "地址里不能有空格" };
    if (!hasScheme) v = "http://" + v;
    var scheme = v.slice(0, v.indexOf(":")).toLowerCase();
    if (scheme !== "http" && scheme !== "https") return { error: "只支持 http:// 或 https:// 开头的地址" };
    var u;
    try {
      u = new URL(v);
    } catch (e) {
      return { error: FORMAT };
    }
    if (!u.hostname || u.username || u.password) return { error: FORMAT };
    var path = u.pathname.replace(/\/+$/, "");
    return { url: scheme + "://" + u.host.toLowerCase() + path };
  }

  root.OAServerUrl = { normalizeServerUrl: normalizeServerUrl };
})(typeof window !== "undefined" ? window : globalThis);
