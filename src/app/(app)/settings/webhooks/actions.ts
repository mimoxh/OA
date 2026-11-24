"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { parseInput } from "@/lib/oa/validate";
import { audit } from "@/lib/services/notify";
import {
  createBotSchema,
  createWebhookBot,
  deleteWebhookBot,
  rotateWebhookToken,
  setWebhookBotEnabled,
  updateBotSchema,
  updateWebhookBot,
} from "@/lib/im/webhook-admin";
import { pingConnector, replyEndpoint, typingEndpoint } from "@/lib/im/webhook-outbound";

const id = z.string().min(1);

function revalidate() {
  revalidatePath("/settings/webhooks");
  revalidatePath("/contacts");
  revalidatePath("/messages", "layout");
}

export type WebhookSecretReveal = { connectorId: string; botName: string; token: string; replyUrl: string; typingUrl: string };

export async function createWebhookBotAction(input: z.input<typeof createBotSchema>) {
  return runAction("admin", async (user): Promise<WebhookSecretReveal> => {
    const v = parseInput(createBotSchema, input);
    const res = await db.$transaction((tx) => createWebhookBot(tx, user.id, v));
    await audit(db, { entityType: "webhook_connector", entityId: res.connectorId, action: "create", detail: v.name, userId: user.id });
    revalidate();
    return { connectorId: res.connectorId, botName: v.name, token: res.token, replyUrl: replyEndpoint(res.connectorId), typingUrl: typingEndpoint(res.connectorId) };
  });
}

export async function updateWebhookBotAction(input: z.input<typeof updateBotSchema>) {
  return runAction("admin", async (user) => {
    const v = parseInput(updateBotSchema, input);
    await db.$transaction((tx) => updateWebhookBot(tx, v));
    await audit(db, { entityType: "webhook_connector", entityId: v.id, action: "update", userId: user.id });
    revalidate();
  });
}

export async function setWebhookBotEnabledAction(connectorId: string, enabled: boolean) {
  return runAction("admin", async (user) => {
    const cid = parseInput(id, connectorId);
    await db.$transaction((tx) => setWebhookBotEnabled(tx, cid, !!enabled));
    await audit(db, { entityType: "webhook_connector", entityId: cid, action: enabled ? "enable" : "disable", userId: user.id });
    revalidate();
  });
}

export async function rotateWebhookTokenAction(connectorId: string) {
  return runAction("admin", async (user): Promise<WebhookSecretReveal> => {
    const cid = parseInput(id, connectorId);
    const res = await db.$transaction((tx) => rotateWebhookToken(tx, cid));
    const c = await db.webhookConnector.findUniqueOrThrow({ where: { id: cid }, include: { botUser: { select: { name: true } } } });
    await audit(db, { entityType: "webhook_connector", entityId: cid, action: "rotate_token", userId: user.id });
    revalidate();
    return { connectorId: cid, botName: c.botUser.name, token: res.token, replyUrl: replyEndpoint(cid), typingUrl: typingEndpoint(cid) };
  });
}

export async function deleteWebhookBotAction(connectorId: string) {
  return runAction("admin", async (user) => {
    const cid = parseInput(id, connectorId);
    await db.$transaction((tx) => deleteWebhookBot(tx, cid));
    await audit(db, { entityType: "webhook_connector", entityId: cid, action: "delete", userId: user.id });
    revalidate();
  });
}

export async function pingWebhookBotAction(connectorId: string) {
  return runAction("admin", async () => {
    const cid = parseInput(id, connectorId);
    const res = await pingConnector(cid);
    revalidatePath("/settings/webhooks");
    return res;
  });
}
