import type { SeedContext } from "../base";
import { db } from "@/lib/db";
import { OPPORTUNITY_STAGE_PROBABILITY } from "@/lib/labels";

const DAY = 864e5;

/** 相对今天的日期：负数为过去，正数为未来 */
function at(offsetDays: number, hour = 10) {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setHours(hour, (Math.abs(offsetDays) * 7) % 60, 0, 0);
  return d;
}

type Stage = keyof typeof OPPORTUNITY_STAGE_PROBABILITY;
type UserKey = keyof SeedContext["users"];

export async function seedCrm(ctx: SeedContext) {
  const { users, customers } = ctx;

  // ── 联系人（base 已为每个客户创建 1 个首要联系人）──
  const contactDefs: [customer: number, name: string, title: string, phone: string, email?: string][] = [
    [0, "林晓", "采购经理", "13900001011", "linxiao@xingchen.example"],
    [0, "韩冬", "IT 主管", "13900001012", "handong@xingchen.example"],
    [1, "宋老师", "信息中心主任", "13900001021", "song@yuanhang.example"],
    [1, "邓会计", "财务经理", "13900001022"],
    [2, "沈运营", "运营总监", "13900001031", "shen@yunfan.example"],
    [3, "许工", "设备科科长", "13900001041"],
    [3, "曹助理", "总经理助理", "13900001042", "cao@huanan-med.example"],
    [4, "蒋主管", "信息化主管", "13900001051"],
    [5, "唐律师", "行政合伙人", "13900001061", "tang@shudao.example"],
    [6, "魏会计", "行政经理", "13900001071"],
    [7, "秦经理", "采购经理", "13900001081", "qin@qianhai-fin.example"],
    [7, "黎工", "IT 运维", "13900001082"],
  ];
  for (const [c, name, title, phone, email] of contactDefs) {
    await db.contact.create({ data: { customerId: customers[c].id, name, title, phone, email } });
  }

  // ── 商机 ──
  const oppDefs: {
    customer: number;
    name: string;
    amount: number;
    stage: Stage;
    owner: UserKey;
    close: number;
    created: number;
    lostReason?: string;
  }[] = [
    { customer: 0, name: "协作平台 2.0 增购 200 席位", amount: 360000, stage: "NEGOTIATION", owner: "sales", close: 15, created: -40 },
    { customer: 7, name: "前海金融 办公设备集采", amount: 286000, stage: "NEGOTIATION", owner: "sales", close: 20, created: -35 },
    { customer: 2, name: "云帆仓储扫码终端", amount: 156000, stage: "NEGOTIATION", owner: "sales2", close: 10, created: -28 },
    { customer: 1, name: "远航教育 校区网络改造", amount: 520000, stage: "PROPOSAL", owner: "sales", close: 40, created: -25 },
    { customer: 3, name: "华南医疗 IT 设备更新", amount: 188000, stage: "PROPOSAL", owner: "sales2", close: 35, created: -21 },
    { customer: 4, name: "精工制造 车间看板显示屏", amount: 96000, stage: "NEEDS", owner: "sales", close: 60, created: -14 },
    { customer: 6, name: "金陵会计 办公家具更新", amount: 68000, stage: "NEEDS", owner: "sales", close: 50, created: -12 },
    { customer: 5, name: "蜀道律所 OA 实施", amount: 45000, stage: "QUALIFY", owner: "sales2", close: 75, created: -6 },
    { customer: 4, name: "精工 MES 集成咨询", amount: 120000, stage: "QUALIFY", owner: "sales", close: 90, created: -3 },
    { customer: 0, name: "星辰 年度运维服务", amount: 98000, stage: "WON", owner: "sales", close: -20, created: -70 },
    { customer: 2, name: "云帆 年会礼品采购", amount: 52000, stage: "WON", owner: "sales2", close: -45, created: -80 },
    { customer: 6, name: "金陵 打印机租赁", amount: 30000, stage: "LOST", owner: "sales", close: -30, created: -60, lostReason: "价格高于竞品约 15%，客户选择了本地服务商" },
  ];
  const stageCount: Partial<Record<Stage, number>> = {};
  const opps = [];
  for (const o of oppDefs) {
    const n = (stageCount[o.stage] = (stageCount[o.stage] ?? 0) + 1);
    opps.push(
      await db.opportunity.create({
        data: {
          customerId: customers[o.customer].id,
          name: o.name,
          amount: o.amount,
          stage: o.stage,
          probability: OPPORTUNITY_STAGE_PROBABILITY[o.stage],
          expectedCloseDate: at(o.close, 0),
          lostReason: o.lostReason,
          ownerId: users[o.owner].id,
          sortOrder: n * 1000,
          createdAt: at(o.created),
          updatedAt: at(Math.min(o.created + 10, -1)),
        },
      }),
    );
  }

  // ── 跟进记录 ──
  const followDefs: [customer: number, opp: number | null, type: string, user: UserKey, ago: number, content: string, next?: number][] = [
    [0, 9, "visit", "sales", -72, "上门拜访钱总，介绍年度运维服务方案，客户关注响应时效。"],
    [0, 9, "email", "sales", -65, "发送运维服务报价单与 SLA 条款。"],
    [0, 9, "meeting", "sales", -22, "签约会议，双方确认服务范围，合同已盖章。"],
    [0, 0, "call", "sales", -38, "钱总提出协作平台需要扩容至 500 人，约下周演示新版本。"],
    [0, 0, "meeting", "sales", -30, "线上演示协作平台 2.0，CTO 与 IT 主管参会，反馈积极。"],
    [0, 0, "wechat", "sales", -9, "林晓确认采购预算已批，等待法务审核合同条款。", 3],
    [7, 1, "visit", "sales", -33, "拜访前海金融运营总监，梳理办公设备更新清单（笔记本 60 台、显示器 80 台）。"],
    [7, 1, "email", "sales", -18, "发送第二版报价，含三年上门保修。"],
    [7, 1, "call", "sales", -5, "秦经理希望单价再降 3%，已向王总申请特价。", 2],
    [2, 2, "call", "sales2", -26, "周经理反馈仓库扫码枪老化，需要 40 台新终端。"],
    [2, 2, "meeting", "sales2", -15, "带样机到现场测试，识读速度满足要求。"],
    [2, 2, "wechat", "sales2", -4, "客户内部走采购流程中，预计本周给出结论。", 1],
    [1, 3, "visit", "sales", -24, "实地勘察两个校区机房与弱电间，记录点位数量。"],
    [1, 3, "email", "sales", -12, "提交校区网络改造方案 V1 与预算。"],
    [1, 3, "call", "sales", -2, "宋老师反馈方案需补充无线覆盖热力图。", 5],
    [3, 4, "call", "sales2", -20, "吴总监介绍今年 IT 设备更新计划，涉及 3 个院区。"],
    [3, 4, "meeting", "sales2", -8, "方案讲解会，设备科提出需要医疗级消毒键盘。", 7],
    [4, 5, "visit", "sales", -13, "参观精工车间，确认看板显示屏安装位置和尺寸。"],
    [4, 5, "call", "sales", -6, "郑厂长要求提供同行业案例，已整理两家制造业客户材料。", 4],
    [6, 6, "call", "sales", -11, "陈所长计划下季度更换会议室与工位家具。"],
    [6, 6, "wechat", "sales", -3, "发送家具样册与报价区间。", 10],
    [6, 11, "meeting", "sales", -40, "打印机租赁方案比价会，客户认为价格偏高。"],
    [6, 11, "call", "sales", -31, "客户确认选择本地服务商，商机关闭，保持联系。"],
    [5, 7, "call", "sales2", -6, "冯律师咨询 OA 审批与文档管理功能，约线上演示。", 6],
    [5, null, "email", "sales2", -5, "发送产品白皮书与律所行业方案。"],
    [4, 8, "meeting", "sales", -3, "与信息化主管初步沟通 MES 与 OA 数据打通需求。", 14],
    [2, 10, "visit", "sales2", -78, "云帆年会礼品选型，确认数量与预算。"],
    [2, 10, "call", "sales2", -46, "礼品已全部送达，客户满意。"],
    [7, null, "wechat", "sales", -1, "褚总询问年底续约优惠政策，已转交王总。", 8],
    [3, null, "call", "sales2", -1, "曹助理确认下周三院区走访行程。", 9],
    [1, null, "visit", "ceo", -16, "王总陪同拜访远航教育集团领导，建立高层联系。"],
  ];
  for (const [c, o, type, user, ago, content, next] of followDefs) {
    await db.followUp.create({
      data: {
        customerId: customers[c].id,
        opportunityId: o === null ? null : opps[o].id,
        type,
        content,
        userId: users[user].id,
        nextAt: next === undefined ? null : at(next, 10),
        createdAt: at(ago, 9 + (Math.abs(ago) % 8)),
      },
    });
  }
}
