export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function isPrismaUniqueViolation(error: unknown, field?: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  if ((error as { code?: string }).code !== 'P2002') return false;
  if (!field) return true;
  const target = (error as { meta?: { target?: string[] } }).meta?.target;
  return Array.isArray(target) && target.includes(field);
}
