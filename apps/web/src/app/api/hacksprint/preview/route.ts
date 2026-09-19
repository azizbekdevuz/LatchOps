import { NextResponse } from 'next/server';
import { previewProof } from '@/lib/hacksprint/proof';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const preview = await previewProof();
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
