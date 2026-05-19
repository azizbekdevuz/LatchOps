# LatchOps deployment guide

Deploy the LatchOps monorepo to a Linux VPS with Nginx, PM2 (web), and an optional systemd-managed Python analysis service. Replace every `yourdomain.com` and placeholder secret with your own values.

This guide assumes you already built and tested locally (`pnpm install`, `pnpm build`).

---

## Prerequisites

- VPS with Ubuntu or Debian
- Domain name with DNS access
- SSH access to the VPS
- Basic shell familiarity

---

## Overview

You will deploy:

1. **Next.js web app** (port 3000) — PM2
2. **Python analysis service** (port 8000) — optional, systemd
3. **Nginx** (ports 80/443) — reverse proxy
4. **Database** — per `DATABASE_URL` in `apps/web` (PostgreSQL recommended for production; SQLite possible for small setups)

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

# Python
sudo apt install -y python3 python3-pip python3-venv python3-dev

# Nginx, Git, build tools
sudo apt install -y nginx git build-essential

# pnpm and PM2
sudo npm install -g pnpm pm2

node --version
python3 --version
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

**SCP from your machine**

```bash
rsync -avz --exclude node_modules --exclude .git --exclude venv \
  . user@YOUR_VPS_IP:/var/www/latchops/
```

### 3.2 Install and build

```bash
cd /var/www/latchops
pnpm install
pnpm build
```

---

## Step 4: Python analysis service (optional)

### 4.1 Virtual environment

```bash
cd /var/www/latchops/apps/agent
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 4.2 Environment file

```bash
nano .env
```

```bash
ANTHROPIC_API_KEY=your-key-here
MODEL_NAME=claude-sonnet-4-20250514
PORT=8000
HOST=0.0.0.0
LOG_LEVEL=INFO
```

### 4.3 Test run

```bash
source venv/bin/activate
python main.py
# Expect: Uvicorn on http://0.0.0.0:8000
# Ctrl+C to stop before enabling systemd
```

### 4.4 Systemd unit

Copy `apps/agent/latchops-agent.service` or create `/etc/systemd/system/latchops-agent.service`:

```ini
[Unit]
Description=LatchOps analysis service
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/latchops/apps/agent
Environment="PATH=/var/www/latchops/apps/agent/venv/bin:/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=/var/www/latchops/apps/agent/.env
ExecStart=/var/www/latchops/apps/agent/venv/bin/python main.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=latchops-agent

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable latchops-agent
sudo systemctl start latchops-agent
sudo systemctl status latchops-agent
sudo journalctl -u latchops-agent -f
```

---

## Step 5: Next.js web app

### 5.1 Environment

```bash
cd /var/www/latchops/apps/web
nano .env.local
```

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/latchops"
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
AGENT_URL="http://localhost:8000"
ANTHROPIC_API_KEY=""
NODE_ENV="production"
```

Generate a secret:

```bash
openssl rand -base64 32
```

### 5.2 Database

```bash
cd /var/www/latchops/apps/web
pnpm exec prisma generate
pnpm exec prisma db push
# or: pnpm exec prisma migrate deploy
```

### 5.3 PM2

Edit `/var/www/latchops/ecosystem.config.js` with your domain and secrets, then:

```bash
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

## Step 6: Nginx reverse proxy

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

Do not expose ports 3000 or 8000 publicly; only 80/443 via Nginx.

---

## Step 7: SSL (recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo certbot renew --dry-run
```

---

## Step 8: Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## Step 9: Verify

```bash
sudo systemctl status latchops-agent   # if using agent
curl http://localhost:8000/health

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

## Step 10: Boot persistence

```bash
sudo reboot
# after reconnect:
sudo systemctl status latchops-agent
pm2 status
sudo systemctl status nginx
sudo systemctl is-enabled latchops-agent
sudo systemctl is-enabled nginx
```

---

## Maintenance

### Logs

```bash
sudo journalctl -u latchops-agent -f
pm2 logs latchops-web
sudo tail -f /var/log/nginx/error.log
```

### Restart

```bash
sudo systemctl restart latchops-agent
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
sudo systemctl restart latchops-agent
```

---

## Troubleshooting

**Service will not start**

```bash
sudo journalctl -u latchops-agent -n 50
pm2 logs latchops-web --err
ls -la /var/www/latchops
```

**Port in use**

```bash
sudo lsof -i :3000
sudo lsof -i :8000
```

**Nginx 502**

```bash
pm2 status
sudo systemctl status latchops-agent
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
| Python agent | `sudo systemctl status latchops-agent` | `sudo journalctl -u latchops-agent -f` |
| Web | `pm2 status` | `pm2 logs latchops-web` |
| Nginx | `sudo systemctl status nginx` | `/var/log/nginx/error.log` |

**Paths**

- Code: `/var/www/latchops`
- Agent: `/var/www/latchops/apps/agent`
- Web: `/var/www/latchops/apps/web`
- Agent env: `/var/www/latchops/apps/agent/.env`
- Web env: `/var/www/latchops/apps/web/.env.local`
- Nginx: `/etc/nginx/sites-available/latchops`
- Systemd: `/etc/systemd/system/latchops-agent.service`

---

## Checklist

- [ ] DNS A records point to VPS IP
- [ ] Node, Python, Nginx, pnpm, PM2 installed
- [ ] `pnpm install` and `pnpm build` succeeded on VPS
- [ ] Web `.env.local` and agent `.env` configured
- [ ] Prisma schema applied
- [ ] PM2 running `latchops-web`
- [ ] Optional: `latchops-agent` active
- [ ] Nginx proxying to port 3000
- [ ] SSL configured (recommended)
- [ ] UFW allows 22, 80, 443 only
- [ ] Site loads in browser

---

## Additional resources

- [PM2 documentation](https://pm2.keymetrics.io/)
- [systemd.service man page](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Nginx documentation](https://nginx.org/en/docs/)
- [Certbot](https://certbot.eff.org/)
