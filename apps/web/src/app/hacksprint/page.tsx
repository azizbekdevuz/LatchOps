import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { HacksprintClient } from './hacksprint-client';

export const metadata: Metadata = {
  title: 'LatchOps Recovery Proof — Daytona HackSprint Seoul',
  description:
    'Before an AI recovery plan touches the real repository, LatchOps proves the recovery inside an isolated Daytona sandbox.',
};

export default function HacksprintPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Header />
      <HacksprintClient />
    </main>
  );
}
