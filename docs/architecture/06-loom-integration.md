# IDEA — Loom Integration (Project #1)

Loom's Observatory is IDEA's **first project**. Loom stays an independent repo;
IDEA integrates by **vendoring a git-ignored checkout**, **controlling its local
process**, **proxying its dashboard**, and **reading its cost config**.

## Coordinates

- **Local checkout (source of truth on this machine):** `c:\Users\14134\dev\loom-template`
- **Remote:** `https://github.com/compiles-first-time/loom-template.git`
- **Dashboard launch:** `node observatory/server.mjs` → `http://127.0.0.1:4040`
- **Cost/config file:** `config.yaml` (port 4040, `cost_rates`, Models & Budget)
- **Observatory internals:** `observatory/server.mjs` (server), `observatory/public/`
  (client), `observatory/lib/` (aggregator, router, otel).

## Step 1 — Bring Loom into IDEA (git-ignored)

From the IDEA repo root:

```bash
# Clone a fresh checkout for a clean project workspace
git clone https://github.com/compiles-first-time/loom-template.git projects/loom

# OR reuse the existing local checkout instead of cloning:
# cp -r /c/Users/14134/dev/loom-template projects/loom

# Never commit vendored project source into IDEA:
grep -qxF "projects/" .gitignore || echo "projects/" >> .gitignore
```

**Contract:** `projects/` is git-ignored (Exception E-7.b). IDEA commits only the
**registry entry**, never Loom's files.

## Step 2 — Register the project

Add to `config/projects.json` (schema = `ProjectRecord` in `05-data-contracts.md`):

```json
{
  "projects": [
    {
      "name": "loom",
      "title": "Loom Observatory",
      "root": "projects/loom",
      "launch": "node observatory/server.mjs",
      "dashboardUrl": "http://127.0.0.1:4040",
      "configPath": "config.yaml",
      "autostart": false
    }
  ]
}
```

## Step 3 — Process control (`lib/projects.ts` + `app/api/projects/*`)

- `POST /api/projects/loom/start` → spawn `node observatory/server.mjs` with
  `cwd = projects/loom`; record pid; wait for `:4040` to answer.
- `POST /api/projects/loom/stop` → kill the pid.
- `GET /api/projects/loom/status` → `ProjectStatus`.

> **Serverless boundary (E-7.a):** these routes control a process on **the machine
> running IDEA locally**. On Vercel there is no such process — the project pane then
> only *links* to a `127.0.0.1:4040` the user runs themselves. Treat process control
> as a "local dev / self-hosted" capability; the deployed app degrades to a link.

## Step 4 — Proxy / embed the dashboard (`components/project-pane.tsx`)

- Preferred: link out to `http://127.0.0.1:4040` (works when the user runs Loom locally).
- Optional same-origin proxy for a seamless pane: `app/api/projects/loom/proxy/[...path]`
  forwarding to `127.0.0.1:4040`, guarded by `IDEA_HELPER_TOKEN` + Host allowlist
  (mirror Loom/ripple's `127.0.0.1 + Host allowlist + token` security pattern).

## Step 5 — Seed cost routing from Loom's config

- Read `projects/loom/config.yaml` → `cost_rates` / Models & Budget.
- Map those rates into IDEA's `ModelRecord.costWeight` (the "monetary adjustment")
  so the deterministic router (`lib/router.ts` + `lib/cost.ts`) uses Loom's own cost
  model as the seed. Later, the reverse can hold too: IDEA emits `RoutingDecision`
  and `ToolTraceEvent` records the Observatory can visualize.

## Integration checklist

- [ ] `projects/loom` present and git-ignored.
- [ ] `config/projects.json` has the `loom` record.
- [ ] `lib/projects.ts` can start/stop/status the Observatory locally.
- [ ] Project pane links (or proxies) `http://127.0.0.1:4040`.
- [ ] `config.yaml` `cost_rates` seed `costWeight` in the model registry.
- [ ] Deployed (Vercel) build degrades gracefully to a link when no local process exists.
