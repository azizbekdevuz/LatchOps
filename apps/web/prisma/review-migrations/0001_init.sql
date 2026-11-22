-- CreateTable
CREATE TABLE "ReviewIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "scenarioId" TEXT,
    "title" TEXT NOT NULL,
    "incidentType" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'evidence_ready'
);

-- CreateTable
CREATE TABLE "EvidenceSnapshotRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceHash" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "signalsJson" TEXT NOT NULL,
    "redactionJson" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "EvidenceSnapshotRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ReviewIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ConsentRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ReviewIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExplanationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outputJson" TEXT,
    "rawOutput" TEXT,
    "validationJson" TEXT NOT NULL,
    "retrievedIds" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    CONSTRAINT "ExplanationRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ReviewIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DecisionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "selectedAlternativeId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "explanationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "DecisionRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ReviewIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "decisionId" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorized" BOOLEAN NOT NULL,
    "authJson" TEXT NOT NULL,
    "verdict" TEXT,
    "resultJson" TEXT,
    CONSTRAINT "ExecutionRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ReviewIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewAuditEvent" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "incidentId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    CONSTRAINT "ReviewAuditEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ReviewIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EvidenceSnapshotRecord_incidentId_idx" ON "EvidenceSnapshotRecord"("incidentId");

-- CreateIndex
CREATE INDEX "ConsentRecord_incidentId_idx" ON "ConsentRecord"("incidentId");

-- CreateIndex
CREATE INDEX "ExplanationRecord_incidentId_idx" ON "ExplanationRecord"("incidentId");

-- CreateIndex
CREATE INDEX "DecisionRecord_incidentId_idx" ON "DecisionRecord"("incidentId");

-- CreateIndex
CREATE INDEX "ExecutionRecord_incidentId_idx" ON "ExecutionRecord"("incidentId");

-- CreateIndex
CREATE INDEX "ReviewAuditEvent_incidentId_idx" ON "ReviewAuditEvent"("incidentId");

