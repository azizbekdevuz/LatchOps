import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { ReviewRoom } from './review-room';

export const metadata: Metadata = { title: 'Recovery Review · LatchOps' };

export default async function ReviewRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen bg-bg-primary">
      <Header />
      <ReviewRoom id={id} />
    </main>
  );
}
