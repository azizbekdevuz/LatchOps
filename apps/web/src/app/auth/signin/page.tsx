'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const error = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(error ? 'Authentication failed' : '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setErrorMessage('Invalid email or password');
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setErrorMessage('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    signIn('google', { callbackUrl });
  };

  const handleKakaoSignIn = () => {
    signIn('kakao', { callbackUrl });
  };

  const inputClass =
    'w-full px-3.5 py-2.5 rounded-lg bg-bg-primary border border-border-color text-text-primary placeholder-text-muted focus:border-accent-green focus:outline-none transition-colors text-sm';

  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl border border-border-color bg-bg-secondary/90 backdrop-blur p-8 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
        <Link href="/" className="block text-center mb-2 no-underline hover:no-underline">
          <span className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Latch<span className="text-accent-green">Ops</span>
          </span>
        </Link>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted text-center mb-8">
          incident room access
        </p>
        <h1 className="font-display text-lg font-semibold mb-6 text-center text-text-primary">
          Sign in to your account
        </h1>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-lg bg-accent-red/10 border border-accent-red/40 text-accent-red text-sm" role="alert">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5 text-text-secondary">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1.5 text-text-secondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary w-full !py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="my-6 flex items-center">
          <div className="flex-1 hairline"></div>
          <span className="px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">or continue with</span>
          <div className="flex-1 hairline"></div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleGoogleSignIn}
            className="btn w-full !py-2.5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google
          </button>

          <button
            onClick={handleKakaoSignIn}
            className="w-full py-2.5 px-4 rounded-lg border border-transparent bg-[#FEE500] text-[#000000] hover:bg-[#FDD800] transition-colors flex items-center justify-center gap-2 text-sm font-medium"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#000000"
                d="M12 3C6.477 3 2 6.463 2 10.691c0 2.648 1.787 4.972 4.473 6.317l-.982 3.632c-.073.268.21.479.448.334l4.134-2.792c.634.084 1.28.127 1.927.127 5.523 0 10-3.463 10-7.618S17.523 3 12 3z"
              />
            </svg>
            Kakao
          </button>
        </div>

        <p className="text-center text-sm text-text-muted mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="text-accent-green hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl border border-border-color bg-bg-secondary p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-bg-tertiary rounded w-32 mx-auto"></div>
          <div className="h-6 bg-bg-tertiary rounded w-48 mx-auto"></div>
          <div className="h-10 bg-bg-tertiary rounded"></div>
          <div className="h-10 bg-bg-tertiary rounded"></div>
          <div className="h-10 bg-bg-tertiary rounded"></div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="relative min-h-screen flex items-center justify-center p-4 bg-bg-primary overflow-hidden">
      <div className="aurora" aria-hidden="true" />
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden="true" />
      <div className="relative">
        <Suspense fallback={<LoadingFallback />}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
