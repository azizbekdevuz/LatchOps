/**
 * HMAC pepper for CLI bearer tokens. Production requires LATCHOPS_TOKEN_PEPPER.
 */
export function getTokenPepper(): string {
  const pepper = process.env.LATCHOPS_TOKEN_PEPPER;
  if (process.env.NODE_ENV === 'production') {
    if (!pepper) {
      throw new Error('LATCHOPS_TOKEN_PEPPER is required in production');
    }
    return pepper;
  }
  return pepper || process.env.NEXTAUTH_SECRET || 'dev-only-pepper-change-me';
}

export function assertTokenPepperConfigured(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.LATCHOPS_TOKEN_PEPPER) {
    throw new Error('LATCHOPS_TOKEN_PEPPER is required in production');
  }
}
