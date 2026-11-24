import { requirePermission } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { decryptOptional, decryptSecret, maskTokenPrefix, maskUrl, parseHeadersJson } from "@/lib/im/webhook-crypto";
import { normalizeTriggerMode, publicBaseUrl, replyEndpoint } from "@/lib/im/webhook-outbound";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { NewWebhookBotButton, WebhookBotList, type WebhookBotRow } from "@/components/settings/webhook-bots";

export const metadata = { title: "Webhook 机器人" };

function safeMask(cipher: string): string {
  try {
    return maskUrl(decryptSecret(cipher));
  } catch {
    return "（无法解密，请重新填写）";
  }
}

function headerNames(cipher: string | null): string[] {
  try {
    return Object.keys(parseHeadersJson(decryptOptional(cipher)));
  } catch {
    return ["（无法解密）"];
  }
}

export default async function WebhooksPage() {
  await requirePermission("admin");
  const connectors = await db.webhookConnector.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      botUser: { select: { id: true, name: true, avatarColor: true, title: true, active: true } },
      logs: { orderBy: { createdAt: "desc" }, take: 15 },
    },
  });
  const rows: WebhookBotRow[] = connectors.map((c) => ({
    id: c.id,
    botUserId: c.botUserId,
    name: c.botUser.name,
    avatarColor: c.botUser.avatarColor,
    title: c.botUser.title,
    description: c.description,
    enabled: c.enabled && c.botUser.active,
    triggerMode: normalizeTriggerMode(c.triggerMode),
    outboundUrlMasked: safeMask(c.outboundUrl),
    hasSecret: !!c.outboundSecret,
    headerNames: headerNames(c.outboundHeaders),
    tokenPrefix: maskTokenPrefix(c.inboundTokenPrefix),
    replyUrl: replyEndpoint(c.id),
    createdAt: c.createdAt.toISOString(),
    logs: c.logs.map((l) => ({
      id: l.id,
      direction: l.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      event: l.event,
      status: l.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      httpStatus: l.httpStatus,
      latencyMs: l.latencyMs,
      error: l.error,
      conversationId: l.conversationId,
      createdAt: l.createdAt.toISOString(),
    })),
  }));

  return (
    <>
      <TopBar crumbs={[{ label: "设置", href: "/settings" }, { label: "Webhook 机器人" }]} actions={<NewWebhookBotButton />} />
      <Page wide>
        <PageHeader
          icon="🤖"
          title="Webhook 机器人"
          description={`把外部服务（如 Orca Bot）接入为通讯录联系人：单聊消息、群聊中 @ 它或回复它的消息会 POST 到 Outbound URL，外部服务再通过 Inbound Reply URL 回复。回调地址基于 ${publicBaseUrl()}（OA_PUBLIC_BASE_URL）。`}
        />
        <WebhookBotList bots={rows} />
      </Page>
    </>
  );
}
