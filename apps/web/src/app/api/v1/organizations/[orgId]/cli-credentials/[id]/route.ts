import { NextResponse } from 'next/server';
import { AuthzError, requireOrganizationRole } from '@/lib/authz-org';
import { revokeCliCredential } from '@/lib/domain/cli-credential-service';
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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ orgId: string; id: string }> },
) {
  try {
    const { orgId, id } = await context.params;
    const { userId } = await requireOrganizationRole(orgId, ['owner', 'admin']);
    await revokeCliCredential({ organizationId: orgId, credentialId: id, actorUserId: userId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
