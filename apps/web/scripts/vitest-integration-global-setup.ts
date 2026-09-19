import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('TEST_DATABASE_URL not set — integration tests will be skipped at runtime');
    return;
  }

  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
