import { b, type JSONNode } from "./content";

export type BuiltinTemplate = {
  key: string;
  name: string;
  icon: string;
  description: string;
  title: () => string;
  content: () => JSONNode;
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: "meeting",
    name: "会议纪要",
    icon: "🗓️",
    description: "记录议程、结论与待办事项",
    title: () => `会议纪要 ${today()}`,
    content: () =>
      b.doc(
        b.callout("📌", "会议时间：", today(), "  ·  地点：", "  ·  主持人："),
        b.h(2, "参会人员"),
        b.p("@ 提及参会成员"),
        b.h(2, "议程"),
        b.ol("议题一", "议题二", "议题三"),
        b.h(2, "讨论与结论"),
        b.ul("结论一", "结论二"),
        b.h(2, "待办事项"),
        b.todo(["待办事项（负责人 / 截止日期）", false], ["待办事项（负责人 / 截止日期）", false]),
      ),
  },
  {
    key: "weekly",
    name: "周报",
    icon: "📊",
    description: "本周进展、下周计划、风险与求助",
    title: () => `周报 ${today()}`,
    content: () =>
      b.doc(
        b.h(2, "本周完成"),
        b.todo(["完成事项 1", true], ["完成事项 2", true]),
        b.h(2, "进行中"),
        b.table(["事项", "进度", "预计完成"], ["事项 A", "60%", ""], ["事项 B", "30%", ""]),
        b.h(2, "下周计划"),
        b.ul("计划 1", "计划 2"),
        b.h(2, "风险与求助"),
        b.callout("⚠️", "需要协调的资源或存在的风险"),
      ),
  },
  {
    key: "prd",
    name: "需求文档",
    icon: "📝",
    description: "背景、目标、用户故事、功能需求与验收标准",
    title: () => "需求文档：",
    content: () =>
      b.doc(
        b.table(["属性", "内容"], ["负责人", ""], ["状态", "草稿"], ["目标版本", ""], ["相关链接", ""]),
        b.h(2, "背景"),
        b.p("为什么要做这个需求？当前存在什么问题？"),
        b.h(2, "目标"),
        b.ul("业务目标", "用户目标"),
        b.h(2, "用户故事"),
        b.quote("作为 ___，我希望 ___，以便 ___。"),
        b.h(2, "功能需求"),
        b.table(["编号", "功能", "优先级", "说明"], ["F1", "", "P0", ""], ["F2", "", "P1", ""]),
        b.h(2, "验收标准"),
        b.todo(["验收条件 1", false], ["验收条件 2", false]),
        b.h(2, "非功能需求"),
        b.ul("性能", "安全", "兼容性"),
      ),
  },
  {
    key: "retro",
    name: "项目复盘",
    icon: "🔍",
    description: "回顾目标与结果，沉淀经验",
    title: () => "项目复盘：",
    content: () =>
      b.doc(
        b.h(2, "目标回顾"),
        b.p(""),
        b.h(2, "结果与数据"),
        b.p(""),
        b.h(2, "做得好的"),
        b.ul(""),
        b.h(2, "待改进的"),
        b.ul(""),
        b.h(2, "后续行动"),
        b.todo(["行动项", false]),
      ),
  },
];

export function findTemplate(key: string) {
  return BUILTIN_TEMPLATES.find((t) => t.key === key) ?? null;
}
