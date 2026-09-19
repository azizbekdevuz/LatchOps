# LatchOps deployment guide

Deploy the LatchOps monorepo to a Linux VPS with Nginx and PM2. LatchOps analysis is fully deterministic and runs **in-process** inside the Next.js app (`@latchops/state-engine` + `@latchops/recovery-engine`) — there is no separate analysis service to deploy. Replace every `yourdomain.com` and placeholder secret with your own values.

This guide assumes you already built and tested locally (`pnpm install`, `pnpm build`).

Secrets are provided via **environment variables only** — never commit them to `ecosystem.config.js` or any tracked file.

---

## Prerequisites

- VPS with Ubuntu or Debian
- Domain name with DNS access
- SSH access to the VPS
- A PostgreSQL database (managed or self-hosted)
- Basic shell familiarity

---

## Overview

You will deploy:

1. **Next.js web app** (port 3000) — PM2 (runs the deterministic engines in-process)
2. **Nginx** (ports 80/443) — reverse proxy
3. **Database** — PostgreSQL, per `DATABASE_URL` in `apps/web`

Services should be enabled to start on boot.

---

## Step 1: Domain DNS

### 1.1 VPS public IP

```bash
curl -4 ifconfig.me
```

### 1.2 DNS records

At your DNS provider, add:

```
Type: A    Name: @      Points to: YOUR_VPS_IP
Type: A    Name: www    Points to: YOUR_VPS_IP
```

Wait for propagation (often 5–30 minutes).

### 1.3 Verify (optional)

```bash
nslookup yourdomain.com
dig yourdomain.com +short
```

---

## Step 2: Initial VPS setup

### 2.1 Connect

```bash
ssh root@YOUR_VPS_IP
# or: ssh username@YOUR_VPS_IP
```

### 2.2 Update packages

```bash
sudo apt update && sudo apt upgrade -y
```

### 2.3 Install software

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Nginx, Git, build tools
sudo apt install -y nginx git build-essential

# pnpm and PM2
sudo npm install -g pnpm pm2

node --version
nginx -v
pm2 --version
pnpm --version
```

### 2.4 Application directory

```bash
sudo mkdir -p /var/www/latchops
sudo chown -R $USER:$USER /var/www/latchops
```

---

## Step 3: Deploy code

### 3.1 Upload

**Git clone (recommended)**

```bash
cd /var/www/latchops
git clone https://github.com/YOUR_USERNAME/latchops.git .
```

**rsync from your machine**

```bash
rsync -avz --exclude node_modules --exclude .git \
  . user@YOUR_VPS_IP:/var/www/latchops/
```

### 3.2 Install and build

```bash
cd /var/www/latchops
pnpm install
pnpm build
```

---

## Step 4: Next.js web app

### 4.1 Environment

```bash
cd /var/www/latchops/apps/web
nano .env.local
```

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/latchops"
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NODE_ENV="production"
```

Generate a secret:

```bash
openssl rand -base64 32
```

No API keys are required — analysis is deterministic and local to the app.

### 4.2 Database

```bash
cd /var/www/latchops/apps/web
pnpm exec prisma generate
pnpm exec prisma db push
# or: pnpm exec prisma migrate deploy
```

The Phase 3 canonical fields (`Analysis.signalsJson`, `Analysis.planJson`, `Analysis.risk`, `Analysis.engineVersion`) are additive and nullable; `db push` applies them without data loss. See `apps/web/prisma/manual-migrations/` for the equivalent DDL.

### 4.3 PM2

`ecosystem.config.js` contains **no secrets**. Export the required environment variables (or use a git-ignored env file / systemd `EnvironmentFile` / secrets manager) before starting:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/latchops"
export NEXTAUTH_URL="https://yourdomain.com"
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"

sudo mkdir -p /var/log/latchops
sudo chown -R $USER:$USER /var/log/latchops

cd /var/www/latchops
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# run the sudo command PM2 prints
pm2 status
pm2 logs latchops-web
```

---

## Step 5: Nginx reverse proxy

```bash
sudo nano /etc/nginx/sites-available/latchops
```

Use a standard reverse proxy to `http://localhost:3000` for `yourdomain.com` and `www.yourdomain.com`. Example HTTP block:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/latchops /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

Do not expose port 3000 publicly; only 80/443 via Nginx.

---

## Step 6: SSL (recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo certbot renew --dry-run
```

---

## Step 7: Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## Step 8: Verify

```bash
pm2 status
curl -I http://localhost:3000

sudo systemctl status nginx
```

Browser: `http://yourdomain.com` or `https://yourdomain.com` after SSL.

From your workstation (with monorepo and VPN/SSH tunnel if needed):

```bash
pnpm cli send -u https://yourdomain.com
```

---

## Step 9: Boot persistence

```bash
sudo reboot
# after reconnect:
pm2 status
sudo systemctl status nginx
sudo systemctl is-enabled nginx
```

---

## Maintenance

### Logs

```bash
pm2 logs latchops-web
sudo tail -f /var/log/nginx/error.log
```

### Restart

```bash
pm2 restart latchops-web
sudo systemctl restart nginx
```

### Update code

```bash
cd /var/www/latchops
git pull
pnpm install
pnpm build
pm2 restart latchops-web
```

---

## Troubleshooting

**Service will not start**

```bash
pm2 logs latchops-web --err
ls -la /var/www/latchops
```

**Port in use**

```bash
sudo lsof -i :3000
```

**Nginx 502**

```bash
pm2 status
sudo nginx -t
sudo systemctl restart nginx
```

**Database**

```bash
cd /var/www/latchops/apps/web
pnpm exec prisma generate
```

**DNS**

```bash
dig yourdomain.com +short
```

---

## Quick reference

| Service | Status | Logs |
|---------|--------|------|
| Web | `pm2 status` | `pm2 logs latchops-web` |
| Nginx | `sudo systemctl status nginx` | `/var/log/nginx/error.log` |

**Paths**

- Code: `/var/www/latchops`
- Web: `/var/www/latchops/apps/web`
- Web env: `/var/www/latchops/apps/web/.env.local`
- Nginx: `/etc/nginx/sites-available/latchops`

---

## Checklist

- [ ] DNS A records point to VPS IP
- [ ] Node, Nginx, pnpm, PM2 installed
- [ ] `pnpm install` and `pnpm build` succeeded on VPS
- [ ] Web `.env.local` configured (no secrets in tracked files)
- [ ] Required env vars exported before `pm2 start`
- [ ] Prisma schema applied
- [ ] PM2 running `latchops-web`
- [ ] Nginx proxying to port 3000
- [ ] SSL configured (recommended)
- [ ] UFW allows 22, 80, 443 only
- [ ] Site loads in browser

---

## Additional resources

- [PM2 documentation](https://pm2.keymetrics.io/)
- [Nginx documentation](https://nginx.org/en/docs/)
- [Certbot](https://certbot.eff.org/)
