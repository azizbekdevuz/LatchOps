-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "GitSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "os" TEXT,
    "repoRootHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "userId" TEXT,

    CONSTRAINT "GitSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gitSessionId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gitSessionId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "summary" TEXT,
    "repoGraphJson" JSONB,
    "signalsJson" JSONB,
    "planJson" JSONB,
    "risk" TEXT,
    "engineVersion" TEXT,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictFile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analysisId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "highLevelSummary" TEXT,

    CONSTRAINT "ConflictFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictHunk" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conflictFileId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "baseText" TEXT NOT NULL,
    "oursText" TEXT NOT NULL,
    "theirsText" TEXT NOT NULL,
    "explanation" TEXT,
    "suggestedChoice" TEXT,
    "suggestedContent" TEXT,
    "userChoice" TEXT,
    "userContent" TEXT,

    CONSTRAINT "ConflictHunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanStep" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analysisId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT,
    "dangerLevel" TEXT NOT NULL DEFAULT 'safe',
    "commandsJson" JSONB NOT NULL,
    "verifyJson" JSONB NOT NULL,
    "undoJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trace" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gitSessionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "snapshotId" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "durationMs" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,

    CONSTRAINT "Trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "gitSessionId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuthenticationLog_userId_idx" ON "AuthenticationLog"("userId");

-- CreateIndex
CREATE INDEX "AuthenticationLog_action_idx" ON "AuthenticationLog"("action");

-- CreateIndex
CREATE INDEX "AuthenticationLog_createdAt_idx" ON "AuthenticationLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "GitSession_userId_idx" ON "GitSession"("userId");

-- CreateIndex
CREATE INDEX "GitSession_createdAt_idx" ON "GitSession"("createdAt");

-- CreateIndex
CREATE INDEX "GitSession_status_idx" ON "GitSession"("status");

-- CreateIndex
CREATE INDEX "Snapshot_gitSessionId_idx" ON "Snapshot"("gitSessionId");

-- CreateIndex
CREATE INDEX "Snapshot_createdAt_idx" ON "Snapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_snapshotId_key" ON "Analysis"("snapshotId");

-- CreateIndex
CREATE INDEX "Analysis_gitSessionId_idx" ON "Analysis"("gitSessionId");

-- CreateIndex
CREATE INDEX "Analysis_issueType_idx" ON "Analysis"("issueType");

-- CreateIndex
CREATE INDEX "ConflictFile_analysisId_idx" ON "ConflictFile"("analysisId");

-- CreateIndex
CREATE INDEX "ConflictHunk_conflictFileId_idx" ON "ConflictHunk"("conflictFileId");

-- CreateIndex
CREATE INDEX "PlanStep_analysisId_idx" ON "PlanStep"("analysisId");

-- CreateIndex
CREATE INDEX "PlanStep_index_idx" ON "PlanStep"("index");

-- CreateIndex
CREATE INDEX "Trace_gitSessionId_idx" ON "Trace"("gitSessionId");

-- CreateIndex
CREATE INDEX "Trace_stage_idx" ON "Trace"("stage");

-- CreateIndex
CREATE INDEX "Trace_createdAt_idx" ON "Trace"("createdAt");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Event_userId_idx" ON "Event"("userId");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- AddForeignKey
ALTER TABLE "AuthenticationLog" ADD CONSTRAINT "AuthenticationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSession" ADD CONSTRAINT "GitSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_gitSessionId_fkey" FOREIGN KEY ("gitSessionId") REFERENCES "GitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_gitSessionId_fkey" FOREIGN KEY ("gitSessionId") REFERENCES "GitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictFile" ADD CONSTRAINT "ConflictFile_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictHunk" ADD CONSTRAINT "ConflictHunk_conflictFileId_fkey" FOREIGN KEY ("conflictFileId") REFERENCES "ConflictFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanStep" ADD CONSTRAINT "PlanStep_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_gitSessionId_fkey" FOREIGN KEY ("gitSessionId") REFERENCES "GitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trace" ADD CONSTRAINT "Trace_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
