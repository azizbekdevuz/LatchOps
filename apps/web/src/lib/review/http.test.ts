import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertLocal } from './http';
import { ReviewError } from './service';

describe('local review server', () => {
  it('binds dev and start to loopback in the package scripts', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.dev).toContain('-H 127.0.0.1');
    expect(pkg.scripts.start).toContain('-H 127.0.0.1');
    expect(pkg.scripts['dev:review']).toContain('-H 127.0.0.1');
  });

  it('still rejects a non-local Host header', () => {
    const request = new Request('http://127.0.0.1/api/review/meta', { headers: { host: 'evil.example' } });
    expect(() => assertLocal(request)).toThrow(ReviewError);
  });
});
