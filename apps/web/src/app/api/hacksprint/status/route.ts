import { NextResponse } from 'next/server';
import { readSponsorKeys } from '@/lib/hacksprint/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(readSponsorKeys());
}
