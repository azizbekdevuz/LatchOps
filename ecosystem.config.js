// PM2 process configuration for the LatchOps web app.
//
// Secrets are NEVER inlined here. All sensitive values are read from the
// process environment (populate them via your shell, a systemd EnvironmentFile,
// a secrets manager, or a git-ignored .env that PM2 loads). Only non-sensitive
// runtime defaults are set inline.
//
// Required environment variables (must be set before `pm2 start`):
//   - DATABASE_URL     PostgreSQL connection string
//   - NEXTAUTH_URL     public origin of the deployment
//   - NEXTAUTH_SECRET  random secret for NextAuth session encryption
module.exports = {
  apps: [
    {
      name: 'latchops-web',
      script: 'apps/web/node_modules/.bin/next',
      args: 'start',
      cwd: './apps/web',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Sensitive values are intentionally omitted; they are inherited from
        // the process environment:
        //   DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
    },
  ],
};
