-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('detected', 'triaged', 'plan_ready', 'recovery_in_progress', 'verification_pending', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('cli', 'web_import', 'legacy_migration');

-- CreateEnum
CREATE TYPE "SnapshotKind" AS ENUM ('capture', 'verification');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('user', 'system', 'cli');

-- DropForeignKey
ALTER TABLE "Snapshot" DROP CONSTRAINT "Snapshot_gitSessionId_fkey";

-- DropForeignKey
ALTER TABLE "Analysis" DROP CONSTRAINT "Analysis_gitSessionId_fkey";

-- DropForeignKey
ALTER TABLE "Trace" DROP CONSTRAINT "Trace_gitSessionId_fkey";

-- DropIndex
DROP INDEX "Snapshot_createdAt_idx";

-- AlterTable
ALTER TABLE "GitSession" ADD COLUMN     "incidentId" TEXT;

-- AlterTable
ALTER TABLE "Snapshot" ADD COLUMN     "incidentId" TEXT,
ADD COLUMN     "kind" "SnapshotKind" NOT NULL DEFAULT 'capture',
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "gitSessionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN     "incidentId" TEXT,
ADD COLUMN     "recoveryPlanRecordId" TEXT,
ALTER COLUMN "gitSessionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Trace" ADD COLUMN     "auditEventId" TEXT,
ADD COLUMN     "incidentId" TEXT,
ALTER COLUMN "gitSessionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "kind" TEXT NOT NULL DEFAULT 'team',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "personalOwnerUserId" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "primaryRemote" TEXT,
    "rootCommitOid" TEXT,
    "missingRemote" BOOLEAN NOT NULL DEFAULT false,
    "platform" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdById" TEXT,
    "title" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'detected',
    "source" "IncidentSource" NOT NULL DEFAULT 'cli',
    "incidentType" TEXT NOT NULL,
    "risk" TEXT,
    "summary" TEXT,
    "engineVersion" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triagedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "legacyGitSessionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryPlanRecord" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "signalsJson" JSONB NOT NULL,
    "planJson" JSONB NOT NULL,
    "incidentType" TEXT NOT NULL,
    "summary" TEXT,
    "risk" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyAnalysisId" TEXT,

    CONSTRAINT "RecoveryPlanRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRun" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recoveryPlanRecordId" TEXT NOT NULL,
    "afterSnapshotId" TEXT NOT NULL,
    "selectedAlternativeId" TEXT,
    "status" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "incidentId" TEXT,
    "actorUserId" TEXT,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'authoritative',
    "payload" JSONB,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyTraceId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_personalOwnerUserId_key" ON "Organization"("personalOwnerUserId");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "Organization_kind_idx" ON "Organization"("kind");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Repository_organizationId_idx" ON "Repository"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_organizationId_fingerprint_key" ON "Repository"("organizationId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_id_organizationId_key" ON "Repository"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_legacyGitSessionId_key" ON "Incident"("legacyGitSessionId");

-- CreateIndex
CREATE INDEX "Incident_organizationId_status_idx" ON "Incident"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Incident_organizationId_createdAt_idx" ON "Incident"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_repositoryId_idx" ON "Incident"("repositoryId");

-- CreateIndex
CREATE INDEX "Incident_incidentType_idx" ON "Incident"("incidentType");

-- CreateIndex
CREATE INDEX "Incident_legacyGitSessionId_idx" ON "Incident"("legacyGitSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_id_organizationId_key" ON "Incident"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryPlanRecord_legacyAnalysisId_key" ON "RecoveryPlanRecord"("legacyAnalysisId");

-- CreateIndex
CREATE INDEX "RecoveryPlanRecord_incidentId_isCurrent_idx" ON "RecoveryPlanRecord"("incidentId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryPlanRecord_incidentId_version_key" ON "RecoveryPlanRecord"("incidentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryPlanRecord_id_incidentId_key" ON "RecoveryPlanRecord"("id", "incidentId");

-- CreateIndex
CREATE INDEX "VerificationRun_incidentId_createdAt_idx" ON "VerificationRun"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRun_recoveryPlanRecordId_idx" ON "VerificationRun"("recoveryPlanRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_legacyTraceId_key" ON "AuditEvent"("legacyTraceId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_incidentId_createdAt_idx" ON "AuditEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_incidentId_idx" ON "IdempotencyRecord"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_key_key" ON "IdempotencyRecord"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GitSession_incidentId_key" ON "GitSession"("incidentId");

-- CreateIndex
CREATE INDEX "Snapshot_incidentId_createdAt_idx" ON "Snapshot"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Snapshot_incidentId_sequence_idx" ON "Snapshot"("incidentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_id_incidentId_key" ON "Snapshot"("id", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_recoveryPlanRecordId_key" ON "Analysis"("recoveryPlanRecordId");

-- CreateIndex
CREATE INDEX "Analysis_incidentId_idx" ON "Analysis"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Trace_auditEventId_key" ON "Trace"("auditEventId");

-- CreateIndex
CREATE INDEX "Trace_incidentId_idx" ON "Trace"("incidentId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_personalOwnerUserId_fkey" FOREIGN KEY ("personalOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_repositoryId_organizationId_fkey" FOREIGN KEY ("repositoryId", "organizationId") REFERENCES "Repository"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryPlanRecord" ADD CONSTRAINT "RecoveryPlanRecord_incidentId_organizationId_fkey" FOREIGN KEY ("incidentId", "organizationId") REFERENCES "Incident"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryPlanRecord" ADD CONSTRAINT "RecoveryPlanRecord_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryPlanRecord" ADD CONSTRAINT "RecoveryPlanRecord_legacyAnalysisId_fkey" FOREIGN KEY ("legacyAnalysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_incidentId_organizationId_fkey" FOREIGN KEY ("incidentId", "organizationId") REFERENCES "Incident"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_recoveryPlanRecordId_incidentId_fkey" FOREIGN KEY ("recoveryPlanRecordId", "incidentId") REFERENCES "RecoveryPlanRecord"("id", "incidentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_afterSnapshotId_fkey" FOREIGN KEY ("afterSnapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_incidentId_organizationId_fkey" FOREIGN KEY ("incidentId", "organizationId") REFERENCES "Incident"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSession" ADD CONSTRAINT "GitSession_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_gitSessionId_fkey" FOREIGN KEY ("gitSessionId") REFERENCES "GitSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_gitSessionId_fkey" FOREIGN KEY ("gitSessionId") REFERENCES "GitSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_recoveryPlanRecordId_fkey" FOREIGN KEY ("recoveryPlanRecordId") REFERENCES "RecoveryPlanRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_gitSessionId_fkey" FOREIGN KEY ("gitSessionId") REFERENCES "GitSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes (not expressible in Prisma DSL)
CREATE UNIQUE INDEX "Membership_one_owner_per_org"
  ON "Membership" ("organizationId")
  WHERE role = 'owner';

CREATE UNIQUE INDEX "RecoveryPlanRecord_one_current_per_incident"
  ON "RecoveryPlanRecord" ("incidentId")
  WHERE "isCurrent" = true;
