import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  buildOrcaCatalog,
  parseCatalogRows,
  parseInstalledAgents,
  readOrcaModelCatalog,
  resolveOrcaCatalogPath,
  runOrcaInstalled,
  type CatalogRow,
} from "@/lib/im/orca-catalog";
import {
  AGENT_PRESETS,
  DEFAULT_EFFORT_OPTIONS,
  MODEL_SUGGESTIONS,
  effortChoices,
  filterModels,
  modelChoices,
  type OrcaCatalog,
} from "@/lib/im/orca-catalog-shared";
import { resolveAgentIcon } from "@/components/im/agent-icon";
import { ORCA_ICON_ALIASES, ORCA_PNG_ICONS, ORCA_SVG_ICONS } from "@/components/im/orca-agent-icons.generated";

const root = path.resolve(__dirname, "../..");

const effort = (value: string, label = value) => ({ value, label });
const claudeModels = [
  { id: "claude-opus-5-5", label: "Opus 5.5", description: "For complex work", isDefault: true, efforts: [effort("low", "Low"), effort("max", "Max")] },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", isDefault: false, efforts: [], effortsKnown: true },
];
const record = (agent: string, extra: Record<string, unknown>) => JSON.stringify({ agent, fingerprint: "f", ...extra });
const row = (key: string, seq: number, value: string): CatalogRow => ({ key, seq, value });

describe("Orca 模型目录路径", () => {
  it("按平台解析 Electron userData 默认位置", () => {
    assert.equal(
      resolveOrcaCatalogPath({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32", "C:\\Users\\u"),
      "C:\\Users\\u\\AppData\\Roaming\\orca\\agent-model-catalog.db",
    );
    assert.equal(resolveOrcaCatalogPath({}, "win32", "C:\\Users\\u"), "C:\\Users\\u\\AppData\\Roaming\\orca\\agent-model-catalog.db");
    assert.equal(resolveOrcaCatalogPath({}, "darwin", "/Users/u"), "/Users/u/Library/Application Support/orca/agent-model-catalog.db");
    assert.equal(resolveOrcaCatalogPath({}, "linux", "/home/u"), "/home/u/.config/orca/agent-model-catalog.db");
    assert.equal(resolveOrcaCatalogPath({ XDG_CONFIG_HOME: "/cfg" }, "linux", "/home/u"), "/cfg/orca/agent-model-catalog.db");
  });
  it("环境变量覆盖优先", () => {
    assert.equal(resolveOrcaCatalogPath({ ORCA_MODEL_CATALOG_PATH: " /x/catalog.db ", ORCA_USER_DATA_DIR: "/y" }, "linux", "/h"), "/x/catalog.db");
    assert.equal(resolveOrcaCatalogPath({ ORCA_USER_DATA_DIR: "/y" }, "darwin", "/h"), path.join("/y", "agent-model-catalog.db"));
  });
});

describe("parseCatalogRows", () => {
  it("每个基座取 seq 最大的一条；live 优先，为空时回退 discovered", () => {
    const rows = [
      row("claude\0old", 1, record("claude", { discovered: { models: [{ id: "claude-old", label: "Old" }] } })),
      row("claude\0new", 7, record("claude", { live: null, discovered: { models: claudeModels }, configured: { modelId: "claude-haiku-5-5", effort: "medium" } })),
      row("codex\0a", 3, record("codex", { live: { models: [{ id: "gpt-6-astra", efforts: ["low", "HIGH"] }] }, discovered: { models: [{ id: "gpt-old" }] } })),
    ];
    const m = parseCatalogRows(rows);
    assert.deepEqual([...m.keys()].sort(), ["claude", "codex"]);
    const claude = m.get("claude")!;
    assert.equal(claude.source, "discovered");
    assert.deepEqual(
      claude.models.map((x) => [x.id, x.label, x.isDefault, x.efforts.map((e) => e.value), x.effortsKnown]),
      [
        ["claude-opus-5-5", "Opus 5.5", true, ["low", "max"], true],
        ["claude-haiku-5-5", "Haiku 5.5", false, [], true],
      ],
    );
    assert.deepEqual(claude.configured, { model: "claude-haiku-5-5", effort: "medium" });
    const codex = m.get("codex")!;
    assert.equal(codex.source, "live");
    assert.deepEqual(codex.models[0], {
      id: "gpt-6-astra",
      label: "gpt-6-astra",
      description: null,
      isDefault: false,
      efforts: [effort("low"), effort("high")],
      effortsKnown: true,
    });
  });
  it("损坏 / 无模型的最新记录被跳过，回退同一基座的上一条；agent 字段缺失时取 key 前缀", () => {
    const m = parseCatalogRows([
      row("droid\0b", 9, "{not json"),
      row("droid\0c", 8, record("droid", { discovered: { models: [] } })),
      row("droid\0a", 2, JSON.stringify({ discovered: { models: [{ id: "glm-5" }] } })),
    ]);
    assert.deepEqual(m.get("droid")?.models.map((x) => x.id), ["glm-5"]);
  });
  it("过滤不合法的模型 ID / 强度，去重", () => {
    const m = parseCatalogRows([
      row(
        "pi\0a",
        1,
        record("pi", {
          discovered: {
            models: [
              { id: "has space" },
              { id: "openai/gpt-5.5", efforts: [{ value: "high" }, { value: "high" }, { value: "very high" }, 3] },
              { id: "openai/gpt-5.5" },
              null,
            ],
          },
        }),
      ),
    ]);
    const pi = m.get("pi")!;
    assert.deepEqual(pi.models.map((x) => x.id), ["openai/gpt-5.5"]);
    assert.deepEqual(pi.models[0].efforts, [effort("high")]);
  });
});

describe("readOrcaModelCatalog（真实 SQLite WAL 文件）", () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-orca-catalog-test-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function createCatalog(file: string) {
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE rows(key TEXT PRIMARY KEY, seq INTEGER NOT NULL, value TEXT NOT NULL)");
    return db;
  }

  it("文件不存在 → missing", async () => {
    const r = await readOrcaModelCatalog(path.join(dir, "nope.db"));
    assert.equal(r.status, "missing");
    assert.equal(r.agents.size, 0);
  });

  it("Orca 持有写连接、数据仍在 -wal 中时只读读取到最新数据，且不阻塞写入、不改动主库", async () => {
    const file = path.join(dir, "live.db");
    const writer = createCatalog(file);
    const insert = writer.prepare("INSERT OR REPLACE INTO rows(key, seq, value) VALUES (?, ?, ?)");
    insert.run("claude\0a", 1, record("claude", { discovered: { models: claudeModels } }));
    const mainBefore = fs.readFileSync(file);
    assert.ok(fs.statSync(`${file}-wal`).size > 0, "数据应位于 WAL 中");

    const r = await readOrcaModelCatalog(file);
    assert.equal(r.status, "ok");
    assert.equal(r.status === "ok" && r.via, "direct");
    assert.deepEqual(r.agents.get("claude")?.models.map((m) => m.id), ["claude-opus-5-5", "claude-haiku-5-5"]);

    // 读取结束后写连接仍可继续写入（读者未持锁），主库未被 checkpoint / 改写
    insert.run("codex\0a", 2, record("codex", { discovered: { models: [{ id: "gpt-6-astra" }] } }));
    assert.deepEqual(fs.readFileSync(file), mainBefore);
    const r2 = await readOrcaModelCatalog(file);
    assert.deepEqual([...r2.agents.keys()].sort(), ["claude", "codex"]);
    writer.close();
  });

  it("读取期间写事务进行中也能读到已提交的快照", async () => {
    const file = path.join(dir, "busy.db");
    const writer = createCatalog(file);
    writer.prepare("INSERT INTO rows VALUES (?, ?, ?)").run("claude\0a", 1, record("claude", { discovered: { models: claudeModels } }));
    writer.exec("BEGIN IMMEDIATE");
    writer.prepare("INSERT INTO rows VALUES (?, ?, ?)").run("droid\0a", 2, record("droid", { discovered: { models: [{ id: "glm-5" }] } }));
    const r = await readOrcaModelCatalog(file);
    writer.exec("COMMIT");
    writer.close();
    assert.equal(r.status, "ok");
    assert.deepEqual([...r.agents.keys()], ["claude"], "未提交的写入不可见");
  });

  it("直接只读打开失败时回退为复制快照读取", async () => {
    const file = path.join(dir, "snap.db");
    const writer = createCatalog(file);
    writer.prepare("INSERT INTO rows VALUES (?, ?, ?)").run("claude\0a", 1, record("claude", { discovered: { models: claudeModels } }));
    // 模拟只读打开失败（例如 -shm 不可访问），读写打开（只用于临时副本）正常
    class ReadonlyFails extends Database {
      constructor(f: string, opts?: Database.Options) {
        if (opts?.readonly) throw new Error("SQLITE_CANTOPEN: unable to open database file");
        super(f, opts);
      }
    }
    const r = await readOrcaModelCatalog(file, { loadSqlite: async () => ReadonlyFails as never });
    writer.close();
    assert.equal(r.status, "ok");
    assert.equal(r.status === "ok" && r.via, "snapshot");
    assert.deepEqual(r.agents.get("claude")?.models.length, 2);
    assert.ok(!fs.existsSync(path.join(dir, "snap.db-journal")));
  });

  it("表结构变动 → invalid；非 SQLite 文件 / SQLite 模块不可用 → 降级而非抛错", async () => {
    const changed = path.join(dir, "changed.db");
    const db = new Database(changed);
    db.exec("CREATE TABLE entries(k TEXT)");
    db.close();
    assert.equal((await readOrcaModelCatalog(changed)).status, "invalid");

    const garbage = path.join(dir, "garbage.db");
    fs.writeFileSync(garbage, "this is not a sqlite database at all, just some text padding ".repeat(20));
    assert.ok(["invalid", "unreadable"].includes((await readOrcaModelCatalog(garbage)).status));

    const noSqlite = await readOrcaModelCatalog(changed, {
      loadSqlite: async () => {
        throw new Error("Cannot find module 'better-sqlite3'");
      },
    });
    assert.equal(noSqlite.status, "unreadable");
  });
});

describe("orca agent installed --json", () => {
  it("解析 CLI 输出（result 包裹或裸对象）", () => {
    const out = JSON.stringify({ id: "x", ok: true, result: { agents: [{ id: "claude", name: "Claude", default: true }, { id: "dsh", name: "DeepSeek Harness" }, { id: "Bad Id" }] } });
    assert.deepEqual(parseInstalledAgents(out), {
      agents: [
        { id: "claude", name: "Claude", isDefault: true },
        { id: "dsh", name: "DeepSeek Harness", isDefault: false },
      ],
    });
    assert.deepEqual(parseInstalledAgents(JSON.stringify({ agents: [{ id: "codex" }] }))?.agents, [{ id: "codex", name: null, isDefault: false }]);
    assert.equal(parseInstalledAgents("orca: command failed"), null);
    assert.equal(parseInstalledAgents(JSON.stringify({ result: {} })), null);
  });
  it("CLI 不存在时返回 unavailable", async () => {
    const r = await runOrcaInstalled({ ...process.env, ORCA_CLI_PATH: path.join(os.tmpdir(), "definitely-not-orca-cli-xyz") }, 2000);
    assert.equal(r.status, "unavailable");
  });
});

describe("buildOrcaCatalog 合并与降级", () => {
  const catalogRows = parseCatalogRows([row("claude\0a", 1, record("claude", { discovered: { models: claudeModels } }))]);

  it("已安装基座在前（默认基座居首），目录中缺失的已安装基座（如 dsh）保留且无模型，预设始终保留", () => {
    const c = buildOrcaCatalog(
      { status: "ok", installed: { agents: [{ id: "dsh", name: "DeepSeek Harness", isDefault: false }, { id: "claude", name: "Claude", isDefault: true }] } },
      { status: "ok", agents: catalogRows, via: "direct" },
    );
    assert.equal(c.defaultAgent, "claude");
    assert.deepEqual(c.agents.slice(0, 2).map((a) => [a.id, a.installed, a.isDefault, a.modelSource, a.models.length]), [
      ["claude", true, true, "discovered", 2],
      ["dsh", true, false, null, 0],
    ]);
    for (const p of AGENT_PRESETS) assert.ok(c.agents.some((a) => a.id === p), `预设 ${p}`);
    assert.equal(new Set(c.agents.map((a) => a.id)).size, c.agents.length, "无重复");
    assert.deepEqual(c.warnings, []);
    assert.equal(c.agents.find((a) => a.id === "devin")?.label, "Devin", "未安装的预设使用 Orca 内置名称");
  });

  it("未安装 Orca：CLI 不可用 + 目录缺失 → 全部为预设并给出提示", () => {
    const c = buildOrcaCatalog({ status: "unavailable" }, { status: "missing", agents: new Map() });
    assert.equal(c.defaultAgent, null);
    assert.deepEqual(c.agents.map((a) => a.id), [...AGENT_PRESETS]);
    assert.ok(c.agents.every((a) => !a.installed && !a.models.length));
    assert.deepEqual(c.status, { cli: "unavailable", catalog: "missing" });
    assert.equal(c.warnings.length, 2);
  });

  it("CLI 失败但目录可读：目录中的基座仍可用", () => {
    const c = buildOrcaCatalog({ status: "error", error: "timeout" }, { status: "ok", agents: catalogRows, via: "direct" });
    assert.equal(c.agents[0].id, "claude");
    assert.equal(c.agents[0].installed, false);
    assert.equal(c.agents[0].models.length, 2);
  });
});

describe("前端联动：模型随基座、强度随模型", () => {
  const catalog: OrcaCatalog = buildOrcaCatalog(
    { status: "ok", installed: { agents: [{ id: "claude", name: "Claude", isDefault: true }] } },
    { status: "ok", agents: parseCatalogRows([row("claude\0a", 1, record("claude", { discovered: { models: [...claudeModels, { id: "claude-x" }] } }))]), via: "direct" },
  );

  it("有目录的基座返回真实模型；无目录 / 未指定基座返回常用预设", () => {
    assert.deepEqual(modelChoices(catalog, "claude").models.map((m) => m.id), ["claude-opus-5-5", "claude-haiku-5-5", "claude-x"]);
    assert.equal(modelChoices(catalog, "claude").source, "discovered");
    for (const agent of ["dsh", "my-agent", null]) {
      const c = modelChoices(catalog, agent);
      assert.equal(c.source, "preset");
      assert.deepEqual(c.models.map((m) => m.id), MODEL_SUGGESTIONS);
    }
    assert.equal(modelChoices(null, "claude").source, "preset", "目录未加载时同样降级");
  });

  it("强度：模型声明的档位 / 明确不支持 / 未知时通用档位", () => {
    assert.deepEqual(effortChoices(catalog, "claude", "claude-opus-5-5"), { efforts: [effort("low", "Low"), effort("max", "Max")], source: "model" });
    assert.deepEqual(effortChoices(catalog, "claude", "claude-haiku-5-5"), { efforts: [], source: "none" });
    assert.deepEqual(effortChoices(catalog, "claude", "claude-x"), { efforts: DEFAULT_EFFORT_OPTIONS, source: "generic" });
    assert.deepEqual(effortChoices(catalog, "claude", "not-in-catalog"), { efforts: DEFAULT_EFFORT_OPTIONS, source: "generic" });
    assert.deepEqual(effortChoices(catalog, null, null).source, "generic");
  });

  it("模型搜索：ID / 名称 / 描述，多词同时命中", () => {
    const models = modelChoices(catalog, "claude").models;
    assert.deepEqual(filterModels(models, "opus").map((m) => m.id), ["claude-opus-5-5"]);
    assert.deepEqual(filterModels(models, "HAIKU 5.5").map((m) => m.id), ["claude-haiku-5-5"]);
    assert.deepEqual(filterModels(models, "complex").map((m) => m.id), ["claude-opus-5-5"]);
    assert.equal(filterModels(models, "  ").length, 3);
    assert.equal(filterModels(models, "gpt").length, 0);
  });
});

describe("Orca 原版基座图标", () => {
  it("常见基座均解析到 Orca 图标（矢量或离线位图），别名生效", () => {
    for (const agent of [...AGENT_PRESETS, "claude-agent-teams", "opencode", "copilot", "gemini", "cursor"]) {
      const r = resolveAgentIcon(agent);
      assert.ok(r.kind === "svg" || r.kind === "png", `${agent} → ${r.kind}`);
    }
    assert.equal(ORCA_ICON_ALIASES["opencode2"], "opencode");
    assert.equal(resolveAgentIcon("CLAUDE").kind, "svg");
  });
  it("未指定 / 自定义基座使用兜底图标", () => {
    assert.deepEqual(resolveAgentIcon(null), { kind: "none" });
    assert.deepEqual(resolveAgentIcon("  "), { kind: "none" });
    assert.deepEqual(resolveAgentIcon("my-agent"), { kind: "letter", letter: "M" });
  });
  it("位图文件随仓库提供（public/agent-icons，无外链），矢量图标不含外部引用", () => {
    for (const [id, icon] of Object.entries(ORCA_PNG_ICONS)) {
      assert.match(icon.src, /^\/agent-icons\/[\w.-]+\.png$/, id);
      const file = path.join(root, "public", icon.src);
      assert.ok(fs.existsSync(file), `${file} 存在`);
      assert.equal(fs.readFileSync(file).subarray(1, 4).toString("ascii"), "PNG");
    }
    for (const [id, icon] of Object.entries(ORCA_SVG_ICONS)) {
      assert.doesNotMatch(icon.body, /https?:|href=|<script|on\w+=/i, id);
    }
  });
});
