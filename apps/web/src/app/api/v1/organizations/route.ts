import { NextResponse } from 'next/server';
import { AuthzError } from '@/lib/authz-org';
import { DomainError, isDomainError } from '@/lib/domain/errors';
import { createOrganization, getOrganizationsForUser } from '@/lib/domain/organization-service';
import { auth } from '@/lib/auth';

function errorResponse(error: unknown) {
  if (error instanceof AuthzError || isDomainError(error)) {
    const status = error instanceof AuthzError ? error.status : error.status;
    const code = error instanceof AuthzError ? 'AUTHZ' : error.code;
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
  console.error(error);
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, { status: 401 });
    }
    const memberships = await getOrganizationsForUser(session.user.id);
    return NextResponse.json({
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        kind: m.organization.kind,
        status: m.organization.status,
        role: m.role,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, { status: 401 });
    }
    const body = (await request.json()) as { name?: string; slug?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'name is required' } }, { status: 400 });
    }
    const org = await createOrganization(session.user.id, { name: body.name.trim(), slug: body.slug });
    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
