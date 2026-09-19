import { redirect } from 'next/navigation';

/**
 * The session view has been consolidated into the canonical incident room.
 * `/session/[id]` now redirects to `/incident/[id]`.
 *
 * Phase 7 consolidation debt: there were historically two incident UIs
 * (`/session` expecting the legacy PlanV1 shape and `/incident` expecting the
 * DB planStep shape). Phase 3 picked `/incident` as canonical and redirects
 * `/session` here. A full incident-room redesign is deferred to Phase 7.
 */
export default async function SessionRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/incident/${id}`);
}
