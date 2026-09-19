import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ingestForAuthenticatedUser } from '@/lib/recovery/pipeline';
import { listIncidentsForUser } from '@/lib/domain/incident-service';
import { withDeprecationHeaders } from '@/lib/http/deprecation';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const incidents = await listIncidentsForUser(session.user.id);

    const formattedSessions = incidents.map((s) => ({
      id: s.id,
      legacyGitSessionId: s.legacyGitSessionId,
      createdAt: s.createdAt.toISOString(),
      title: s.title,
      status: s.status,
      analysis: {
        incidentType: s.incidentType,
        summary: s.summary,
      },
      traces: s.traces.map((t) => ({
        stage: t.stage,
        createdAt: t.createdAt.toISOString(),
        success: t.success,
      })),
    }));

    return withDeprecationHeaders(NextResponse.json({ sessions: formattedSessions }));
  } catch (error) {
    console.error('Error fetching sessions:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const result = await ingestForAuthenticatedUser(body?.snapshot, session.user.id);

    return withDeprecationHeaders(
      NextResponse.json({
        sessionId: result.incidentId ?? result.sessionId,
        incidentId: result.incidentId ?? result.sessionId,
        incidentType: result.incidentType,
        summary: result.summary,
        risk: result.risk,
      }),
    );
  } catch (error) {
    console.error('Error creating session:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
