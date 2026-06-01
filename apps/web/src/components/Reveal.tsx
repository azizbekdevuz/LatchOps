'use client';

import { useEffect, useRef, type ReactNode, type ElementType } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Stagger delay in ms applied via CSS custom property. */
  delay?: number;
  className?: string;
  as?: ElementType;
}

/**
 * Scroll-choreographed entrance. Pure IntersectionObserver — no deps.
 * Reduced-motion users get content instantly (handled in globals.css).
 */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={`reveal ${className}`}
      style={{ ['--reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
