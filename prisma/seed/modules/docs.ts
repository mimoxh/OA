import type { SeedContext } from "../base";
import { db } from "@/lib/db";
import { b, extractText, type JSONNode } from "@/lib/docs/content";

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);

type DocData = {
  spaceId: string;
  parentId?: string;
  title: string;
  icon?: string;
  cover?: string;
  fullWidth?: boolean;
  content: JSONNode;
  createdById: string;
  sortOrder?: number;
};

/** 创建文档：content 为共享 schema 的 Tiptap JSON，text 提取纯文本；ydoc 留空由协同服务初始化 */
async function mkDoc(d: DocData) {
  return db.document.create({
    data: {
      spaceId: d.spaceId,
      parentId: d.parentId,
      title: d.title,
      icon: d.icon,
      cover: d.cover,
      fullWidth: d.fullWidth ?? false,
      content: JSON.stringify(d.content),
      text: extractText(d.content),
      sortOrder: d.sortOrder ?? 0,
      createdById: d.createdById,
      updatedById: d.createdById,
    },
  });
}

/** 在文档 JSON 中给第一处 quote 文本打上评论 mark */
function applyCommentMark(node: JSONNode, quote: string, commentId: string): boolean {
  const kids = node.content;
  if (!kids) return false;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.type === "text" && child.text?.includes(quote)) {
      const at = child.text.indexOf(quote);
      const before = child.text.slice(0, at);
      const after = child.text.slice(at + quote.length);
      const replacement: JSONNode[] = [];
      if (before) replacement.push({ ...child, text: before });
      replacement.push({
        ...child,
        text: quote,
        marks: [...(child.marks ?? []), { type: "comment", attrs: { commentId } }],
      });
      if (after) replacement.push({ ...child, text: after });
      kids.splice(i, 1, ...replacement);
      return true;
    }
    if (applyCommentMark(child, quote, commentId)) return true;
  }
  return false;
}

export async function seedDocs(ctx: SeedContext) {
  const { users, spaces, docs } = ctx;

  // ── 产品研发空间：需求文档（含表格、待办、@提及、callout、代码引用） ──
  const prdDoc = await mkDoc({
    spaceId: spaces.rd.id,
    title: "协作平台 2.0 需求文档",
    icon: "📝",
    cover: "ocean",
    sortOrder: 2,
    createdById: users.pm.id,
    content: b.doc(
      b.table(["属性", "内容"], ["负责人", "周敏"], ["状态", "评审中"], ["目标版本", "v2.0"], ["预计上线", "2027-03-31"]),
      b.callout("📌", "本文档为协作平台 2.0 的产品需求文档，评审通过后进入开发排期。"),
      b.h(2, "背景"),
      b.p("1.0 版本解决了文档与流程的统一，但协同体验仍有差距。2.0 聚焦"),
      b.p("离线协同编辑", "、移动端审批与开放 API 三个方向。"),
      b.h(2, "目标"),
      b.ul("文档协同延迟 < 200ms", "审批移动端覆盖率 100%", "开放 API 覆盖核心单据"),
      b.h(2, "用户故事"),
      b.quote("作为一线员工，我希望在地铁上也能审批单据，以便不阻塞业务流程。"),
      b.h(2, "功能需求"),
      b.table(["编号", "功能", "优先级", "负责人"], ["F1", "离线编辑与冲突合并", "P0", "孙浩"], ["F2", "移动端审批", "P0", "周敏"], ["F3", "开放 API", "P1", "待定"]),
      b.h(2, "里程碑"),
      b.todo(["需求冻结（2 月 10 日）", true], ["联调完成（3 月 10 日）", false], ["正式上线（3 月 31 日）", false]),
      b.h(2, "相关同学"),
      b.p("产品：", b.mention(users.pm.id, users.pm.name), "　前端：", b.mention(users.dev.id, users.dev.name)),
    ),
  });

  const apiDoc = await mkDoc({
    spaceId: spaces.rd.id,
    parentId: prdDoc.id,
    title: "接口设计约定",
    icon: "🔌",
    createdById: users.dev.id,
    content: b.doc(
      b.p("所有开放 API 遵循 REST 风格，统一返回包络："),
      b.code("json", '{\n  "code": 0,\n  "data": {},\n  "message": "ok"\n}'),
      b.h(3, "鉴权"),
      b.p("请求头携带 "),
      b.p(),
      b.p("Authorization: Bearer <token>"),
      b.code("http", "GET /api/v1/documents/abc123 HTTP/1.1\nAuthorization: Bearer <token>\nAccept: application/json"),
      b.h(3, "错误码"),
      b.ul("401 未登录或 token 过期", "403 没有访问权限", "429 触发限流，退避重试"),
      b.callout("⚠️", "破坏性变更需要提前一个版本公告。"),
    ),
  });
  await mkDoc({
    spaceId: spaces.rd.id,
    parentId: apiDoc.id,
    title: "限流与配额",
    icon: "🚦",
    createdById: users.dev.id,
    content: b.doc(
      b.p("默认每个应用 600 次/分钟；超出后返回 429 并在响应头给出重试时间。"),
      b.table(["套餐", "限流", "并发"], ["标准版", "600 次/分", "10"], ["旗舰版", "3000 次/分", "50"]),
    ),
  });
  await mkDoc({
    spaceId: spaces.rd.id,
    parentId: prdDoc.id,
    title: "发布计划",
    icon: "🚀",
    sortOrder: 1,
    createdById: users.pm.id,
    content: b.doc(
      b.h(2, "排期"),
      b.table(["阶段", "时间", "交付物"], ["开发", "2.10 - 3.05", "功能分支合并"], ["联调", "3.06 - 3.16", "联调环境"], ["灰度", "3.17 - 3.27", "灰度报告"], ["上线", "3.31", "正式版本"]),
      b.h(2, "发布检查清单"),
      b.todo(["数据库迁移脚本评审", true], ["回滚预案演练", false], ["监控告警阈值确认", false], ["发布通知邮件模板", false]),
    ),
  });

  // ── 公司知识库：OKR 与协作规范 ──
  const okrDoc = await mkDoc({
    spaceId: spaces.kb.id,
    title: "2027 年 OKR 目标",
    icon: "🎯",
    cover: "sunset",
    sortOrder: 2,
    createdById: users.ceo.id,
    content: b.doc(
      b.callout("🎯", "目标：成为中小企业首选的一体化协作平台"),
      b.h(2, "O1：产品体验达到一线水平"),
      b.todo(["KR1：文档协同延迟 < 200ms", false], ["KR2：移动端审批上线", false], ["KR3：NPS ≥ 40", false]),
      b.h(2, "O2：商业化落地"),
      b.todo(["KR1：付费客户 50 家", false], ["KR2：续约率 ≥ 85%", false]),
    ),
  });
  await mkDoc({
    spaceId: spaces.kb.id,
    parentId: okrDoc.id,
    title: "Q1 关键结果拆解",
    icon: "📊",
    createdById: users.pm.id,
    content: b.doc(
      b.table(["KR", "责任人", "当前进度", "风险"], ["协同延迟 < 200ms", "孙浩", "60%", "中继节点选型"], ["移动端审批", "周敏", "30%", "排期紧张"], ["NPS 调研", "李娜", "筹备中", "—"]),
    ),
  });
  const welcome = docs.welcome;
  await mkDoc({
    spaceId: spaces.kb.id,
    title: "团队协作规范",
    icon: "🤝",
    sortOrder: 3,
    createdById: users.admin.id,
    content: b.doc(
      b.p("为了让协作更高效，请遵守以下约定："),
      b.ul("异步优先：能写清楚的不要开会", "文档沉淀：会议结论当天落入文档", "评论不过夜：工作日的评论当天回复"),
      b.quote("写下来的共识才算共识。"),
      b.h(3, "文档规范"),
      b.ul("标题用动词开头，避免「关于…的文档」", "给文档配上图标与封面，方便检索", "重要文档请保存历史版本"),
      b.p("新同学请先阅读 ", b.text("欢迎使用协作空间", { type: "link", attrs: { href: `/docs/${welcome.id}` } }), " 与本页。"),
      b.hr(),
      b.p("本规范由 IT 与总经办共同维护。"),
    ),
  });

  // ── 销售空间 ──
  await mkDoc({
    spaceId: spaces.sales.id,
    title: "重点客户跟进策略",
    icon: "🎯",
    sortOrder: 1,
    createdById: users.sales.id,
    content: b.doc(
      b.p("针对 A 级客户的季度跟进策略（仅销售部可见）："),
      b.table(["客户", "阶段", "下一步动作", "责任人"], ["上海星辰网络", "商务谈判", "本周五报价评审", "李娜"], ["深圳前海金融", "商务谈判", "安排 POC 演示", "李娜"], ["杭州云帆电商", "商务谈判", "确认终端数量", "赵磊"]),
      b.callout("💡", "谈判超过 9 折折扣需销售经理审批。"),
    ),
  });

  // ── 收藏 ──
  await db.documentFavorite.createMany({
    data: [
      { userId: users.admin.id, documentId: welcome.id },
      { userId: users.admin.id, documentId: prdDoc.id },
      { userId: users.pm.id, documentId: prdDoc.id },
      { userId: users.dev.id, documentId: okrDoc.id },
    ],
  });

  // ── 评论：划词评论（带 mark）、回复、已解决 ──
  const selQuote = "离线协同编辑";
  const selComment = await db.comment.create({
    data: {
      targetType: "document",
      targetId: prdDoc.id,
      authorId: users.dev.id,
      content: "这个方向的优先级建议提到 P0 第一条，离线场景诉求很强。",
      quote: selQuote,
    },
  });
  const prdContent = JSON.parse(prdDoc.content) as JSONNode;
  applyCommentMark(prdContent, selQuote, selComment.id);
  await db.document.update({
    where: { id: prdDoc.id },
    data: { content: JSON.stringify(prdContent), text: extractText(prdContent) },
  });

  const thread = await db.comment.create({
    data: {
      targetType: "document",
      targetId: prdDoc.id,
      authorId: users.pm.id,
      content: "大家看一下 F3 开放 API 的负责人谁来接？本周评审前定下来。",
    },
  });
  await db.comment.create({
    data: {
      targetType: "document",
      targetId: prdDoc.id,
      authorId: users.dev.id,
      parentId: thread.id,
      content: "我可以先承担调研，正式排期等架构评审后再定。",
    },
  });
  await db.comment.create({
    data: {
      targetType: "document",
      targetId: welcome.id,
      authorId: users.admin.id,
      content: "欢迎页内容已按新版导航更新，如有遗漏请直接补充。",
      resolved: true,
    },
  });

  // ── 历史版本 ──
  const versions: { documentId: string; title: string; content: JSONNode; by: string; at: Date }[] = [
    {
      documentId: prdDoc.id,
      title: "协作平台 2.0 需求文档",
      by: users.pm.id,
      at: ago(5),
      content: b.doc(b.h(2, "背景"), b.p("1.0 版本解决了文档与流程的统一，但协同体验仍有差距。"), b.h(2, "目标"), b.ul("协同编辑优化", "移动端审批")),
    },
    {
      documentId: prdDoc.id,
      title: "协作平台 2.0 需求文档",
      by: users.pm.id,
      at: ago(2),
      content: b.doc(
        b.callout("📌", "本文档为协作平台 2.0 的产品需求文档。"),
        b.h(2, "背景"),
        b.p("2.0 聚焦离线协同编辑、移动端审批与开放 API。"),
        b.h(2, "功能需求"),
        b.table(["编号", "功能", "优先级"], ["F1", "离线编辑与冲突合并", "P0"], ["F2", "移动端审批", "P0"], ["F3", "开放 API", "P1"]),
      ),
    },
    {
      documentId: welcome.id,
      title: "欢迎使用协作空间",
      by: users.admin.id,
      at: ago(10),
      content: b.doc(b.p("这是一个一体化的办公协作平台。"), b.h(2, "快速上手"), b.todo(["打开全局搜索", false], ["新建一个文档页面", false])),
    },
  ];
  for (const v of versions) {
    await db.documentVersion.create({
      data: { documentId: v.documentId, title: v.title, content: JSON.stringify(v.content), createdById: v.by, createdAt: v.at },
    });
  }
}
