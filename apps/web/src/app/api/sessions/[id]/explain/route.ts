import { NextRequest, NextResponse } from 'next/server';
import { SnapshotV1Schema } from '@latchops/schema';
import { getSession, getLatestSnapshot, saveTrace } from '@/lib/db';
import { explainConflict, explainState } from '@/lib/agent/explainer';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const body = await request.json();
    const { type, fileIndex, blockIndex } = body;

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const snapshotRecord = await getLatestSnapshot(sessionId);
    if (!snapshotRecord) {
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
    }

    const snapshot = SnapshotV1Schema.parse(snapshotRecord.snapshotJson);

    const explainerStart = Date.now();

    if (type === 'conflict') {
      // Explain a specific conflict block
      if (fileIndex === undefined || blockIndex === undefined) {
        return NextResponse.json({ error: 'fileIndex and blockIndex required' }, { status: 400 });
      }

      const file = snapshot.unmergedFiles[fileIndex];
      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const block = file.conflictBlocks[blockIndex];
      if (!block) {
        return NextResponse.json({ error: 'Conflict block not found' }, { status: 404 });
      }

      const explanation = await explainConflict(file, block, blockIndex, snapshot);

      // Save trace for recovery engine visualization
      await saveTrace(sessionId, 'visual_explainer', snapshotRecord.id, explanation, explainerStart);

      return NextResponse.json({ explanation });
    } else if (type === 'state') {
      // Explain the overall repo state (detached HEAD, rebase, etc.)
      const explanation = await explainState(snapshot);

      // Save trace for recovery engine visualization
      await saveTrace(sessionId, 'visual_explainer', snapshotRecord.id, explanation, explainerStart);

      return NextResponse.json({ explanation });
    } else {
      return NextResponse.json({ error: 'Invalid type. Use "conflict" or "state"' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error explaining:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
