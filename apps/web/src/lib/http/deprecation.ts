import { NextResponse } from 'next/server';
import { PHASE4_SUNSET_HTTP_DATE } from '@/lib/domain/phase4-flags';

export function withDeprecationHeaders(
  response: NextResponse,
  successor?: { organizationId: string; incidentId: string },
): NextResponse {
  response.headers.set('Deprecation', 'true');
  response.headers.set('Sunset', PHASE4_SUNSET_HTTP_DATE);
  if (successor) {
    response.headers.set(
      'Link',
      `</api/v1/organizations/${successor.organizationId}/incidents/${successor.incidentId}>; rel="successor-version"`,
    );
  }
  return response;
}
