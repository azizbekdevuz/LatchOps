'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Home, History, LogOut, User, Menu, X } from 'lucide-react';
import { useState } from 'react';

function LatchMark() {
  return (
    <span className="relative flex w-9 h-9 items-center justify-center rounded-[10px] border border-border-strong bg-bg-tertiary overflow-hidden transition-shadow duration-300 group-hover:shadow-[0_0_24px_-6px_rgba(52,224,161,0.5)]">
      {/* Latch glyph: a bracket that "locks" */}
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M5 2H3.5C2.7 2 2 2.7 2 3.5v11c0 .8.7 1.5 1.5 1.5H5" stroke="var(--accent-green)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M13 2h1.5c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5H13" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 9h6" stroke="var(--accent-green)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12.5" cy="9" r="1.6" fill="var(--accent-green)" />
      </svg>
    </span>
  );
}

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAuthenticated = status === 'authenticated';
  const isLoading = status === 'loading';

  const isActive = (path: string) => pathname === path;

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border-color bg-bg-primary/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            href={isAuthenticated ? '/dashboard' : '/'}
            className="flex items-center gap-3 group no-underline hover:no-underline"
          >
            <LatchMark />
            <span className="hidden sm:flex items-baseline gap-1.5">
              <span className="font-display font-semibold text-lg tracking-tight text-text-primary">
                LatchOps
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                resilience
              </span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {isAuthenticated ? (
              <>
                <Link
                  href="/dashboard"
                  data-active={isActive('/dashboard')}
                  className={`nav-link flex items-center gap-2 py-1 text-sm font-medium no-underline hover:no-underline transition-colors ${
                    isActive('/dashboard') ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Home className="w-4 h-4" />
                  Dashboard
                </Link>
                <Link
                  href="/history"
                  data-active={isActive('/history')}
                  className={`nav-link flex items-center gap-2 py-1 text-sm font-medium no-underline hover:no-underline transition-colors ${
                    isActive('/history') ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <History className="w-4 h-4" />
                  History
                </Link>
              </>
            ) : (
              <>
                <a
                  href="/#capabilities"
                  className="nav-link py-1 text-sm text-text-secondary hover:text-text-primary no-underline hover:no-underline transition-colors"
                >
                  Capabilities
                </a>
                <a
                  href="/#how-it-works"
                  className="nav-link py-1 text-sm text-text-secondary hover:text-text-primary no-underline hover:no-underline transition-colors"
                >
                  How it works
                </a>
              </>
            )}
          </nav>

          {/* Auth Section */}
          <div className="hidden md:flex items-center gap-3">
            {isLoading ? (
              <div className="w-8 h-8 rounded-full bg-bg-tertiary animate-pulse" />
            ) : isAuthenticated ? (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-color bg-bg-secondary">
                  <User className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary max-w-[150px] truncate">
                    {session?.user?.name || session?.user?.email?.split('@')[0]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:text-accent-red border border-border-color rounded-lg hover:border-accent-red/50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/signin"
                  className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary no-underline hover:no-underline transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  className="btn btn-primary no-underline hover:no-underline text-sm"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation"
            className="md:hidden p-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border-color">
            <nav className="flex flex-col gap-1">
              {isAuthenticated ? (
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg no-underline ${
                      isActive('/dashboard')
                        ? 'bg-bg-tertiary text-text-primary'
                        : 'text-text-secondary'
                    }`}
                  >
                    <Home className="w-5 h-5" />
                    Dashboard
                  </Link>
                  <Link
                    href="/history"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg no-underline ${
                      isActive('/history')
                        ? 'bg-bg-tertiary text-text-primary'
                        : 'text-text-secondary'
                    }`}
                  >
                    <History className="w-5 h-5" />
                    History
                  </Link>
                  <div className="my-2 hairline" />
                  <div className="px-4 py-2 text-sm text-text-muted">
                    Signed in as {session?.user?.email}
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex items-center gap-3 px-4 py-3 text-accent-red"
                  >
                    <LogOut className="w-5 h-5" />
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/auth/signin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="px-4 py-3 text-text-secondary no-underline"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/auth/signup"
                    onClick={() => setMobileMenuOpen(false)}
                    className="mx-4 py-3 text-center btn btn-primary no-underline"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
