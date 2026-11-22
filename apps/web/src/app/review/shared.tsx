'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';

export interface PublicActor {
  id: string;
  name: string;
  role: 'viewer' | 'requester' | 'approver';
  demoToken?: string;
}

export interface ReviewMeta {
  actors: PublicActor[];
  demoActors: boolean;
  provider: { id: string; model: string; local: boolean; reachable: boolean; modelPresent: boolean };
  scenarios: Array<{
    id: string;
    title: string;
    description: string;
    category: 'repository' | 'control';
    selectedAlternativeId: string;
    expectedVerdict: string;
  }>;
  reviews: Array<{ id: string; title: string; status: string; source: string; requestedBy: string; createdAt: string }>;
}

const TOKEN_KEY = 'latchops-review-actor-token';

export function useReviewMeta() {
  const [meta, setMeta] = useState<ReviewMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/review/meta', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Failed to load');
      setMeta(json as ReviewMeta);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { meta, error, reload };
}

export function useActorToken(actors: PublicActor[] | undefined) {
  const [token, setTokenState] = useState<string | null>(null);
  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) setTokenState(stored);
    else if (actors?.[0]?.demoToken) setTokenState(actors[0].demoToken);
  }, [actors]);
  const setToken = useCallback((value: string) => {
    window.localStorage.setItem(TOKEN_KEY, value);
    setTokenState(value);
  }, []);
  const actor = actors?.find((a) => a.demoToken === token) ?? null;
  return { token, setToken, actor };
}

export async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-review-actor': token } : {}),
      ...(init.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${response.status}`);
  return json as T;
}

const ROLE_STYLE: Record<PublicActor['role'], string> = {
  requester: 'badge-blue',
  approver: 'badge-purple',
  viewer: 'badge-yellow',
};

export function ActorSwitcher({
  actors,
  token,
  onChange,
  demo,
}: {
  actors: PublicActor[];
  token: string | null;
  onChange: (token: string) => void;
  demo: boolean;
}) {
  if (!demo) {
    return (
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <UserRound className="w-4 h-4" />
        <input
          type="password"
          placeholder="actor token"
          defaultValue={token ?? ''}
          onBlur={(e) => onChange(e.target.value)}
          className="bg-bg-tertiary border border-border-color rounded-md px-2 py-1 font-mono text-xs"
        />
      </label>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Acting as">
      <span className="text-[11px] uppercase tracking-[0.18em] text-text-muted font-mono">Acting as</span>
      {actors.map((actor) => {
        const active = actor.demoToken === token;
        return (
          <button
            key={actor.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => actor.demoToken && onChange(actor.demoToken)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
              active ? 'border-accent-green text-text-primary bg-bg-tertiary' : 'border-border-color text-text-secondary hover:border-border-strong'
            }`}
          >
            <span className={`badge ${ROLE_STYLE[actor.role]} !py-0 !px-1.5 !text-[10px]`}>{actor.role}</span>
            {actor.name.replace(/ \(.*\)$/, '')}
          </button>
        );
      })}
      <span className="text-[10px] text-text-muted">demo identities · local only</span>
    </div>
  );
}

export function verdictClass(verdict: string | null | undefined): string {
  if (verdict === 'VERIFIED') return 'badge-green';
  if (verdict === 'FAILED') return 'badge-red';
  if (verdict === 'BLOCKED') return 'badge-yellow';
  return 'badge-blue';
}

export function statusClass(status: string): string {
  switch (status) {
    case 'executed':
    case 'accepted':
    case 'approved':
      return 'badge-green';
    case 'rejected':
    case 'error':
      return 'badge-red';
    case 'explained':
      return 'badge-purple';
    default:
      return 'badge-blue';
  }
}
