-- CreateTable
CREATE TABLE "MigrationBackfillError" (
    "id" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorDetail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationBackfillError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationCheckpoint" (
    "id" TEXT NOT NULL,
    "lastProcessedGitSessionId" TEXT,
    "lastProcessedAt" TIMESTAMP(3),
    "mode" TEXT NOT NULL,
    "statsJson" JSONB,

    CONSTRAINT "MigrationCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationBackfillError_sourceTable_sourceId_idx" ON "MigrationBackfillError"("sourceTable", "sourceId");

-- CreateIndex
CREATE INDEX "MigrationBackfillError_errorCode_idx" ON "MigrationBackfillError"("errorCode");
