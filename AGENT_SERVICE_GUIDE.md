# LatchOps analysis service (optional)

The `apps/agent` directory is an **optional** Python FastAPI microservice for extended graph-based snapshot analysis. The Next.js app already includes a TypeScript state engine; when `AGENT_URL` is reachable, the web tier may delegate to this service.

## When to run it

| Scenario | Recommendation |
|----------|----------------|
| Fast local iteration | TypeScript only (skip agent) |
| Recovery pipeline traces in UI | Run agent on port 8000 |
| VPS deployment | systemd unit `latchops-agent.service` |

## Architecture

```
pnpm cli send
    -> Web POST /api/snapshots/ingest
        -> (optional) POST {AGENT_URL}/analyze
        -> DB session + traces
    -> Incident room UI
```

## Pipeline stages

1. **detect_issue** — classify repository state incident  
2. **build_graph** — commit / branch topology  
3. **extract_conflicts** — unmerged paths and conflict blocks  
4. **collect_signals** — normalized signals  
5. **generate_analysis** — structured summary and guidance  

Traces appear under **Recovery Pipeline** in the session view.

## Local setup

```bash
cd apps/agent
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Set ANTHROPIC_API_KEY in .env
python main.py
```

Health check: `GET http://localhost:8000/health`

## Web integration

In `apps/web/.env.local`:

```
AGENT_URL=http://localhost:8000
```

If the agent is down, ingest and plan routes use the TypeScript collector, classifier, and planner.

## Environment

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | LLM for analysis nodes |
| `MODEL_NAME` | Default `claude-sonnet-4-20250514` |
| `HOST` / `PORT` | Bind address (default `0.0.0.0:8000`) |

## Deployment

See [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) for systemd and PM2 layout.

## Dependencies

`requirements.txt` lists FastAPI, Anthropic bindings, and an internal graph runtime package used only by this service. It is not part of LatchOps product branding.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ModuleNotFoundError: spoon_ai` | Run `pip install -r requirements.txt` inside the agent venv (imports the graph runtime) |
| Web always uses TypeScript fallback | Check `AGENT_URL`, firewall, and `curl http://localhost:8000/health` |
| CORS errors | Default allows `localhost:3000`; add your production origin in `main.py` if needed |
