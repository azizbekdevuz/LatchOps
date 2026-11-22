import { describe, expect, it } from 'vitest';
import { detectSecrets, redactText } from './redact';

describe('redactText', () => {
  const cases: Array<[string, string, string]> = [
    ['aws key', 'AWS_ACCESS_KEY_ID=AKIAZ7QW3EXAMPLE4XYZ', 'AKIAZ7QW3EXAMPLE4XYZ'],
    ['github token', 'token ghp_9f8e7d6c5b4a3210fedcba9876543210abcd', 'ghp_9f8e7d6c5b4a3210fedcba9876543210abcd'],
    ['url credentials', 'DATABASE_URL=postgres://app:hunter2pass@db:5432/x', 'hunter2pass'],
    ['password assignment', 'DB_PASSWORD=S3cr3t-Pa55w0rd', 'S3cr3t-Pa55w0rd'],
    ['api key yaml', 'api_key: "abcd1234efgh5678"', 'abcd1234efgh5678'],
    ['openai style', 'OPENAI=sk-proj-abcdefghijklmnopqrstuvwx', 'sk-proj-abcdefghijklmnopqrstuvwx'],
    ['jwt', 'auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'dozjgNryP4J3jVmNHl0w5N'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', 'MIIEow'],
    ['bearer', 'Authorization: Bearer abcdefghijklmnop123456', 'abcdefghijklmnop123456'],
  ];

  for (const [name, input, secret] of cases) {
    it(`removes ${name}`, () => {
      const { text, counts } = redactText(input);
      expect(text).not.toContain(secret);
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      expect(detectSecrets(text)).toEqual([]);
    });
  }

  it('keeps ordinary configuration intact', () => {
    const input = 'PORT=8443\nREPLICAS=3\nHEALTHCHECK_PATH=/healthz';
    expect(redactText(input).text).toBe(input);
  });

  it('masks emails and home paths without treating them as secrets', () => {
    const { text } = redactText('by dev@example.com in C:\\Users\\minji\\repo');
    expect(text).toContain('[email]');
    expect(text).toContain('[home]');
  });

  it('detects unredacted secrets', () => {
    expect(detectSecrets('GITHUB_TOKEN=ghp_9f8e7d6c5b4a3210fedcba9876543210abcd')).toContain('github_token');
  });
});
