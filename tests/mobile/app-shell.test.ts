import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

// App 壳层（mobile/www）：启动页地址输入与错误页。原生层的同款规则见 ServerStoreNormalizeTest / LoadWatchdogTest
const read = (f: string) => fs.readFileSync(path.resolve(f), "utf8");

type Result = { url?: string; error?: string };
function loadNormalizer(): (raw: unknown) => Result {
  const sandbox: Record<string, unknown> = { URL };
  vm.runInNewContext(read("mobile/www/server-url.js"), sandbox);
  const fn = (sandbox.OAServerUrl as { normalizeServerUrl: (raw: unknown) => Result }).normalizeServerUrl;
  // vm 沙箱里的对象原型不同，转成本 realm 的普通对象再比较
  return (raw) => JSON.parse(JSON.stringify(fn(raw)));
}

describe("启动页服务器地址规范化（mobile/www/server-url.js）", () => {
  const normalize = loadNormalizer();

  it("省略 http:// 时补全（局域网 IP:端口、域名、localhost）", () => {
    assert.deepEqual(normalize("192.168.124.220:3001"), { url: "http://192.168.124.220:3001" });
    assert.deepEqual(normalize("  192.168.124.220:3001/ "), { url: "http://192.168.124.220:3001" });
    assert.deepEqual(normalize("oa.company.com"), { url: "http://oa.company.com" });
    assert.deepEqual(normalize("localhost:3000"), { url: "http://localhost:3000" });
  });

  it("保留显式协议，统一小写、去掉结尾斜杠", () => {
    assert.deepEqual(normalize("http://192.168.1.20:3000/"), { url: "http://192.168.1.20:3000" });
    assert.deepEqual(normalize(" HTTPS://OA.Example.com// "), { url: "https://oa.example.com" });
    assert.deepEqual(normalize("https://oa.example.com/oa/"), { url: "https://oa.example.com/oa" });
    assert.deepEqual(normalize("https://oa.example.com:8443"), { url: "https://oa.example.com:8443" });
  });

  it("无效输入给出中文提示", () => {
    assert.equal(normalize("").error, "请输入服务器地址");
    assert.equal(normalize("   ").error, "请输入服务器地址");
    assert.equal(normalize(null).error, "请输入服务器地址");
    assert.equal(normalize("oa example.com").error, "地址里不能有空格");
    assert.equal(normalize("ftp://oa.example.com").error, "只支持 http:// 或 https:// 开头的地址");
    assert.match(normalize("192.168.1.20:99999").error ?? "", /地址格式不正确/);
    assert.match(normalize("http://user:pw@oa.example.com").error ?? "", /地址格式不正确/);
    assert.match(normalize("http://").error ?? "", /地址格式不正确/);
  });
});

describe("启动页表单不触发浏览器原生 URL 校验", () => {
  const html = read("mobile/www/index.html");

  it("地址输入框是 type=text，保留 URL 键盘与输入法设置", () => {
    const input = /<input id="url-input"[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(input, /type="text"/);
    assert.match(input, /inputmode="url"/);
    assert.match(input, /autocomplete="url"/);
    assert.match(input, /autocapitalize="off"/);
    assert.match(input, /spellcheck="false"/);
    assert.doesNotMatch(html, /type="url"/);
  });

  it("表单 novalidate，提交走 normalizeServerUrl", () => {
    assert.match(html, /<form [^>]*id="connect-form"[^>]*novalidate/);
    assert.match(html, /<script src="server-url\.js"><\/script>/);
    assert.match(html, /OAServerUrl\.normalizeServerUrl\(raw\)/);
  });
});

describe("错误页显示加载超时，可直接切换服务器", () => {
  const html = read("mobile/www/error.html");
  const activity = read("mobile/android/app/src/main/java/com/oa/suite/mobile/MainActivity.java");
  const client = read("mobile/android/app/src/main/java/com/oa/suite/mobile/OAWebViewClient.java");

  it("错误页有超时文案与「重试 / 切换服务器」", () => {
    assert.match(html, /timeout: "服务器长时间没有响应/);
    assert.match(html, /连接 OA 服务器超时/);
    assert.match(html, /id="retry"/);
    assert.match(html, /id="launcher"[^>]*>切换服务器</);
  });

  it("超时后停止加载再切到错误页，重试与深链都经看门狗计时", () => {
    assert.match(activity, /webView\.stopLoading\(\);\s*String errorUrl = bridge\.getErrorUrl\(\);/);
    assert.match(activity, /if \(serverUrl != null\) watchLoad\(bridge\.getAppUrl\(\)\);/);
    assert.match(activity, /runOnUiThread\(\(\) -> loadRemote\(target\)\)/);
    assert.match(activity, /loadRemote\(serverUrl \+ path\)/);
    assert.doesNotMatch(activity, /getWebView\(\)\.loadUrl\(serverUrl \+ path\)/);
  });

  it("首帧、加载完成、下载与切后台都会停止或暂停计时", () => {
    assert.match(client, /onPageCommitVisible[\s\S]*?activity\.onMainFrameSettled\(url\)/);
    assert.match(client, /onPageFinished[\s\S]*?activity\.onMainFrameSettled\(url\)/);
    assert.match(client, /isAbortedByWatchdog\(url, description\)\) return;/);
    assert.match(activity, /watchdog\.isPending\(\)\) onMainFrameSettled\(null\);\s*downloads\.onDownloadStart/);
    assert.match(activity, /onStop\(\)[\s\S]*?watchdog\.pause\(\)/);
    assert.match(activity, /onStart\(\)[\s\S]*?watchdog\.resume\(\)/);
    assert.match(activity, /onDestroy\(\)[\s\S]*?watchdog\.settle\(\)/);
  });
});
