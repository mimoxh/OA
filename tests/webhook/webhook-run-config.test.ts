import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBotSchema, updateBotSchema } from "@/lib/im/webhook-admin";
import {
  EMPTY_RUN_METADATA,
  isEmptyRunConfig,
  normalizeEffort,
  resolveRunMetadata,
  runConfigPatchSchema,
} from "@/lib/im/webhook-run-config";

const noDefaults = { defaultAgent: null, defaultModel: null, defaultEffort: null };
const botDefaults = { defaultAgent: "droid", defaultModel: null, defaultEffort: "high" };

describe("resolveRunMetadata 合并优先级", () => {
  it("机器人与会话均未设置时全部为 null", () => {
    assert.deepEqual(resolveRunMetadata(noDefaults), EMPTY_RUN_METADATA);
    assert.deepEqual(resolveRunMetadata(noDefaults, null), { agent: null, model: null, effort: null });
    assert.deepEqual(resolveRunMetadata(null, undefined), EMPTY_RUN_METADATA);
  });
  it("仅机器人默认", () => {
    assert.deepEqual(resolveRunMetadata(botDefaults), { agent: "droid", model: null, effort: "high" });
  });
  it("会话覆盖逐字段优先于机器人默认", () => {
    assert.deepEqual(resolveRunMetadata(botDefaults, { model: "claude-opus-5-5" }), { agent: "droid", model: "claude-opus-5-5", effort: "high" });
    assert.deepEqual(resolveRunMetadata(botDefaults, { agent: "codex", effort: "xhigh" }), { agent: "codex", model: null, effort: "xhigh" });
    assert.deepEqual(resolveRunMetadata(noDefaults, { agent: "claude", model: "m-1", effort: "low" }), { agent: "claude", model: "m-1", effort: "low" });
  });
  it("重置（覆盖为空）后恢复机器人默认", () => {
    assert.deepEqual(resolveRunMetadata(botDefaults, EMPTY_RUN_METADATA), resolveRunMetadata(botDefaults));
    assert.deepEqual(resolveRunMetadata(botDefaults, { agent: null, model: null, effort: null }), { agent: "droid", model: null, effort: "high" });
  });
  it("空白字符串与非法 effort 归一化为 null 并回退", () => {
    assert.deepEqual(resolveRunMetadata({ defaultAgent: "  ", defaultModel: "", defaultEffort: " " }), EMPTY_RUN_METADATA);
    assert.deepEqual(resolveRunMetadata(botDefaults, { agent: "   ", model: " ", effort: "" }), { agent: "droid", model: null, effort: "high" });
    assert.deepEqual(resolveRunMetadata({ ...botDefaults, defaultEffort: "very high" }), { agent: "droid", model: null, effort: null });
    // Orca 模型目录中的其他档位（如 Claude 的 max）按原值透传
    assert.deepEqual(resolveRunMetadata({ ...botDefaults, defaultEffort: "max" }), { agent: "droid", model: null, effort: "max" });
    assert.equal(resolveRunMetadata(botDefaults, { model: "  gpt-6-astra  " }).model, "gpt-6-astra");
  });
  it("normalizeEffort / isEmptyRunConfig", () => {
    assert.equal(normalizeEffort("HIGH"), "high");
    assert.equal(normalizeEffort(" xhigh "), "xhigh");
    assert.equal(normalizeEffort("Max"), "max");
    assert.equal(normalizeEffort("extra-high"), "extra-high");
    assert.equal(normalizeEffort("very high"), null);
    assert.equal(normalizeEffort("<x>"), null);
    assert.equal(normalizeEffort(null), null);
    assert.equal(isEmptyRunConfig({ agent: " ", model: "", effort: null }), true);
    assert.equal(isEmptyRunConfig({ effort: "low" }), false);
    assert.equal(isEmptyRunConfig(null), true);
  });
});

describe("运行配置校验", () => {
  it("合法输入：空白归一化为 null，基座与强度转小写", () => {
    assert.deepEqual(runConfigPatchSchema.parse({ agent: " Droid ", model: " claude-opus-5-5 ", effort: "High" }), {
      agent: "droid",
      model: "claude-opus-5-5",
      effort: "high",
    });
    assert.deepEqual(runConfigPatchSchema.parse({ agent: "", model: "   ", effort: "" }), { agent: null, model: null, effort: null });
    assert.deepEqual(runConfigPatchSchema.parse({}), {});
    assert.deepEqual(runConfigPatchSchema.parse({ agent: null }), { agent: null });
    for (const model of ["gpt-6-astra", "openai/gpt-5.5:latest", "anthropic@claude_opus+1"]) {
      assert.equal(runConfigPatchSchema.parse({ model }).model, model);
    }
    // Orca 各基座的强度档位：通用四档之外还有 none / minimal / max / ultra / extra-high 等
    for (const effort of ["low", "medium", "high", "xhigh", "max", "minimal", "none", "ultra", "extra-high"]) {
      assert.equal(runConfigPatchSchema.parse({ effort }).effort, effort);
    }
    assert.equal(runConfigPatchSchema.parse({ effort: " MAX " }).effort, "max");
  });
  it("非法输入被拒绝", () => {
    for (const effort of ["very high", "-low", "1x", "e".repeat(25), "<script>", 3, true]) {
      assert.equal(runConfigPatchSchema.safeParse({ effort }).success, false, `effort=${String(effort)}`);
    }
    for (const agent of ["bad agent", "-x", "a".repeat(41), "中文", 1]) {
      assert.equal(runConfigPatchSchema.safeParse({ agent }).success, false, `agent=${String(agent)}`);
    }
    for (const model of ["has space", "m".repeat(121), "<script>", "-leading"]) {
      assert.equal(runConfigPatchSchema.safeParse({ model }).success, false, `model=${model}`);
    }
    const r = runConfigPatchSchema.safeParse({ effort: "very high" });
    assert.ok(!r.success && /思考强度只能是/.test(r.error.issues[0].message));
  });
  it("机器人表单：默认运行配置可选、空白归一化，非法 effort 拒绝", () => {
    const base = { name: "Orca", avatarColor: "#9065b0", outboundUrl: "https://hooks.example.com/x" };
    const created = createBotSchema.parse({ ...base, defaultAgent: "Codex", defaultModel: " ", defaultEffort: "" });
    assert.equal(created.defaultAgent, "codex");
    assert.equal(created.defaultModel, null);
    assert.equal(created.defaultEffort, null);
    const omitted = createBotSchema.parse(base);
    assert.equal(omitted.defaultAgent, undefined);
    assert.equal(createBotSchema.safeParse({ ...base, defaultEffort: "very high" }).success, false);
    assert.equal(createBotSchema.parse({ ...base, defaultEffort: "Max" }).defaultEffort, "max");
    assert.equal(updateBotSchema.safeParse({ id: "c1", name: "Orca", avatarColor: "#9065b0", defaultEffort: "xhigh" }).success, true);
    assert.equal(updateBotSchema.safeParse({ id: "c1", name: "Orca", avatarColor: "#9065b0", defaultAgent: "has space" }).success, false);
  });
});
