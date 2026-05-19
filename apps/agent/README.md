# LatchOps analysis service

Optional Python FastAPI service for graph-based Git incident analysis. The Next.js app uses its built-in TypeScript recovery planner when `AGENT_URL` is unset or unreachable.

**Run from monorepo** — not a separate published package.

```bash
cd apps/agent
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python main.py
```

See [AGENT_SERVICE_GUIDE.md](../../AGENT_SERVICE_GUIDE.md) for integration and [DEPLOYMENT_GUIDE.md](../../DEPLOYMENT_GUIDE.md) for VPS setup.
