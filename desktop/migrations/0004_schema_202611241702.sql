-- CreateTable
CREATE TABLE "WebhookConnector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botUserId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "outboundUrl" TEXT NOT NULL,
    "outboundSecret" TEXT,
    "outboundHeaders" TEXT,
    "triggerMode" TEXT NOT NULL DEFAULT 'mention_only',
    "defaultAgent" TEXT,
    "defaultModel" TEXT,
    "defaultEffort" TEXT,
    "inboundTokenHash" TEXT NOT NULL,
    "inboundTokenPrefix" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookConnector_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookConnector_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookConversationConfig" (
    "conversationId" TEXT NOT NULL PRIMARY KEY,
    "agent" TEXT,
    "model" TEXT,
    "effort" TEXT,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookConversationConfig_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDeliveryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectorId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "event" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDeliveryLog_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "WebhookConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT '#6b7280',
    "title" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "railPins" TEXT NOT NULL DEFAULT '[]',
    "railOrder" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "avatarColor", "createdAt", "departmentId", "email", "id", "name", "passwordHash", "phone", "railOrder", "railPins", "roleId", "title", "updatedAt") SELECT "active", "avatarColor", "createdAt", "departmentId", "email", "id", "name", "passwordHash", "phone", "railOrder", "railPins", "roleId", "title", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WebhookConnector_botUserId_key" ON "WebhookConnector"("botUserId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_connectorId_createdAt_idx" ON "WebhookDeliveryLog"("connectorId", "createdAt");
