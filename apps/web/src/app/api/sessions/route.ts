import { NextRequest, NextResponse } from 'next/server';
import { SnapshotV1Schema } from '@latchops/schema';
import { createSession, createSnapshot, saveTrace, getUserSessions } from '@/lib/db';
import { collectSignals } from '@/lib/agent';
import { auth } from '@/lib/auth';
import { createHash } from 'crypto';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await getUserSessions(session.user.id);

    // Transform to match frontend interface
    const formattedSessions = sessions.map(s => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      title: s.title,
      status: s.status,
      analysis: s.analyses[0] ? {
        issueType: s.analyses[0].issueType,
        summary: s.analyses[0].summary,
      } : null,
      traces: s.traces.map(t => ({
        stage: t.stage,
        outputJson: t.outputJson,
        createdAt: t.createdAt.toISOString(),
        success: t.success,
      })),
    }));

    return NextResponse.json({ sessions: formattedSessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { snapshot: rawSnapshot } = body;

    // Validate snapshot
    const snapshot = SnapshotV1Schema.parse(rawSnapshot);

    // Get current user (optional - uploads can be anonymous)
    const session = await auth();
    const userId = session?.user?.id || null;

    // Create hash of repo root for deduplication
    const repoRootHash = createHash('sha256')
      .update(snapshot.repoRoot)
      .digest('hex')
      .slice(0, 16);

    // Generate title from branch and issue
    const title = generateTitle(snapshot);

    // Create session in database
    const gitSession = await createSession({
      title,
      os: snapshot.platform,
      repoRootHash,
      userId,
    });

    // Save snapshot
    const snapshotRecord = await createSnapshot({
      gitSessionId: gitSession.id,
      snapshotJson: snapshot,
    });

    // Run collector and save trace
    const startTime = Date.now();
    const signals = collectSignals(snapshot);
    await saveTrace(gitSession.id, 'collector', snapshotRecord.id, signals, startTime);

    return NextResponse.json({ sessionId: gitSession.id });
  } catch (error) {
    console.error('Error creating session:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function generateTitle(snapshot: {
  branch: { head: string };
  isDetachedHead: boolean;
  unmergedFiles: unknown[];
  rebaseState: { inProgress: boolean };
}): string {
  const parts: string[] = [];

  if (snapshot.unmergedFiles.length > 0) {
    parts.push('Merge Conflict');
  } else if (snapshot.rebaseState.inProgress) {
    parts.push('Rebase');
  } else if (snapshot.isDetachedHead) {
    parts.push('Detached HEAD');
  }

  parts.push(`on ${snapshot.branch.head}`);

  return parts.join(' ') || 'Git Recovery Session';
}
