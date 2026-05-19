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
        AGENT_URL: 'http://localhost:8000',
        NEXTAUTH_URL: 'https://yourdomain.com',
        NEXTAUTH_SECRET: 'change-this-to-random-secret',
        DATABASE_URL: 'file:./latchops.db',
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
    }
  ]
};
