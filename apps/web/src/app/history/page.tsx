'use client';

import { useRouter } from 'next/navigation';
import { HistoryPage } from '@/components/HistoryPage';

export default function History() {
  const router = useRouter();

  const handleNavigateToSession = (id: string) => {
    router.push(`/incident/${id}`);
  };

  return (
    <HistoryPage
      onNavigateToSession={handleNavigateToSession}
    />
  );
}
