'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

const errorMessages: Record<string, string> = {
  Configuration: 'There is a problem with the server configuration.',
  AccessDenied: 'Access was denied. You may not have permission to access this resource.',
  Verification: 'The verification token has expired or has already been used.',
  Default: 'An authentication error occurred.',
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'Default';
  const errorMessage = errorMessages[error] || errorMessages.Default;

  return (
    <div className="w-full max-w-md">
      <div className="card text-center">
        <div className="mb-4 flex justify-center"><AlertTriangle className="w-12 h-12 text-yellow-500" /></div>
        <h1 className="text-2xl font-bold mb-4">Authentication Error</h1>
        <p className="text-text-secondary mb-6">{errorMessage}</p>
        <Link href="/auth/signin" className="btn btn-primary">
          Back to Sign In
        </Link>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="w-full max-w-md">
      <div className="card text-center">
        <div className="animate-pulse space-y-4">
          <div className="h-10 w-10 bg-bg-tertiary rounded-full mx-auto"></div>
          <div className="h-8 bg-bg-tertiary rounded w-48 mx-auto"></div>
          <div className="h-6 bg-bg-tertiary rounded w-64 mx-auto"></div>
          <div className="h-10 bg-bg-tertiary rounded w-32 mx-auto"></div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Suspense fallback={<LoadingFallback />}>
        <ErrorContent />
      </Suspense>
    </main>
  );
}
