import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { ReviewHome } from './review-home';

export const metadata: Metadata = {
  title: 'LatchOps Recovery Review',
  description: 'Evidence first, grounded explanation second, explicit human approval before any isolated recovery.',
};

export default function ReviewPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Header />
      <ReviewHome />
    </main>
  );
}
