-- CreateTable
CREATE TABLE "OrcaCatalogSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceHost" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "payload" TEXT NOT NULL,
    "agentCount" INTEGER NOT NULL,
    "modelCount" INTEGER NOT NULL,
    "syncedVia" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrcaCustomModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT,
    "efforts" TEXT NOT NULL DEFAULT '[]',
    "defaultEffort" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrcaCatalogSyncKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "createdById" TEXT,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OrcaCatalogSnapshot_sourceHost_key" ON "OrcaCatalogSnapshot"("sourceHost");

-- CreateIndex
CREATE UNIQUE INDEX "OrcaCustomModel_agent_modelId_key" ON "OrcaCustomModel"("agent", "modelId");
