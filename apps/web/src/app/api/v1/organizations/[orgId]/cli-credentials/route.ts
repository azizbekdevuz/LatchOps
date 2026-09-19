import { NextResponse } from 'next/server';
import { AuthzError, requireOrganizationRole } from '@/lib/authz-org';
import { createCliCredential, listCliCredentials } from '@/lib/domain/cli-credential-service';
import { isDomainError } from '@/lib/domain/errors';

function errorResponse(error: unknown) {
  if (error instanceof AuthzError || isDomainError(error)) {
    const status = error instanceof AuthzError ? error.status : error.status;
    const code = error instanceof AuthzError ? 'AUTHZ' : error.code;
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
  console.error(error);
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await context.params;
    await requireOrganizationRole(orgId, ['owner', 'admin']);
    const credentials = await listCliCredentials(orgId);
    return NextResponse.json({
      credentials: credentials.map((c) => ({
        id: c.id,
        name: c.name,
        tokenId: c.tokenId,
        scopes: c.scopes,
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        revokedAt: c.revokedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await context.params;
    const { userId } = await requireOrganizationRole(orgId, ['owner', 'admin']);
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: { code: 'VALIDATION', message: 'name is required' } },
        { status: 400 },
      );
    }

    const { record, token } = await createCliCredential({
      organizationId: orgId,
      createdById: userId,
      name,
      scopes: Array.isArray(body?.scopes) ? body.scopes : undefined,
      expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
    });

    return NextResponse.json(
      {
        id: record.id,
        name: record.name,
        token,
        tokenId: record.tokenId,
        scopes: record.scopes,
        expiresAt: record.expiresAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
