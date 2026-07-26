# NEXT — Precise Next Action (build/)

**Updated at the end of every session. Read at the start of every session.**
**Last updated:** 2026-04-12 (Phase 3 final close — WSL2 handoff)

---

## IMMEDIATE NEXT ACTION

**Set up the WSL2 development environment, then begin Phase 4 implementation.**

Nick's confirmed decisions:

| ID | Decision |
|----|----------|
| BD-5 | Foundation-first: SR_GOV_01 + SR_DM_01 |
| BD-6 | Rust backend first (Tokio + Axum) |
| BD-7 | cargo test + Jest + Playwright |
| BD-8 | Hybrid deployment: cloud admin portal (browser) + local Tauri desktop app (employee chat) |
| BD-9 | Compilation split: backend in WSL2, Tauri desktop app on Windows |

---

## Phase 4 Setup: Step by Step

### Step 0: Open VS Code connected to WSL2

```
1. Open VS Code on Windows
2. Press Ctrl+Shift+P → "WSL: Connect to WSL"
3. Select your Ubuntu distribution
4. VS Code reopens with WSL2 as the backend
```

### Step 1: Create the WSL2 workspace

In the VS Code terminal (now running in WSL2 Ubuntu):

```bash
mkdir -p ~/projects/meridian
cd ~/projects/meridian
```

### Step 2: Copy build artifacts from Windows D: drive

```bash
# Copy everything from the Phase 3 build directory
cp -r /mnt/d/Projects/IDEA/build/* ~/projects/meridian/
cp -r /mnt/d/Projects/IDEA/build/.claude ~/projects/meridian/
cp -r /mnt/d/Projects/IDEA/build/.gitignore ~/projects/meridian/

# Verify the copy
ls -la ~/projects/meridian/
ls ~/projects/meridian/spec/ | wc -l        # should be 14
ls ~/projects/meridian/.claude/skills/ | wc -l  # should be 7
ls ~/projects/meridian/.claude/agents/ | wc -l  # should be 5
```

### Step 3: Initialize Git in the WSL2 workspace

```bash
cd ~/projects/meridian
git init
git add .
git commit -m "Phase 4: initialize WSL2 workspace from Phase 3 build artifacts"
```

### Step 4: Install Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustc --version    # verify
cargo --version    # verify
```

### Step 5: Install Docker (if not already installed)

```bash
# Check if Docker is already available
docker --version

# If not, install Docker Engine in WSL2 (not Docker Desktop)
# Follow: https://docs.docker.com/engine/install/ubuntu/
```

### Step 6: Create docker-compose.yml for platform services

```yaml
# ~/projects/meridian/docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: meridian
      POSTGRES_USER: meridian
      POSTGRES_PASSWORD: dev_only_change_in_prod
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  neo4j:
    image: neo4j:5
    environment:
      NEO4J_AUTH: neo4j/dev_only_change_in_prod
    ports:
      - "7474:7474"   # browser
      - "7687:7687"   # bolt
    volumes:
      - neo4jdata:/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  neo4jdata:
  redisdata:
```

Start services: `docker compose up -d`
Stop services: `docker compose down`
Reset everything: `docker compose down -v` (destroys data)

### Step 7: Scaffold the Rust workspace

```bash
cd ~/projects/meridian
cargo init --name meridian-api src/governance
# The build chat will scaffold the full Cargo workspace structure
```

### Step 8: Run cross-verification in WSL2

```bash
cd ~/projects/meridian
python3 validation/_xverify_phase_a.py
# Must report 484/484, exit code 0
```

### Step 9: Open Claude Code in the WSL2 workspace

```bash
cd ~/projects/meridian
claude   # or however Claude Code is invoked in your WSL2 terminal
```

The `.claude/settings.json` hooks will fire on SessionStart. Run the `context-loader` agent as the first action.

### Step 10: Update path references

The first task in the new Claude Code session: update any absolute Windows paths in CLAUDE.md, HANDOFF.md, and STATE.md to use the WSL2 paths:

| Old (Windows) | New (WSL2) |
|---------------|-----------|
| `D:\Projects\IDEA\build\` | `~/projects/meridian/` |
| `D:\Projects\IDEA\source\*` | `/mnt/d/Projects/IDEA/source/` |
| `D:\Projects\IDEA\master\*` | `/mnt/d/Projects/IDEA/master/` |
| `D:\Projects\IDEA\explore\*` | `/mnt/d/Projects/IDEA/explore/` |
| `D:\Projects\IDEA\working\*` | `/mnt/d/Projects/IDEA/working/` |

The trunk reference files on D: are still accessible from WSL2 via `/mnt/d/` — they are read-only reference only and are not compiled, so the cross-filesystem speed penalty does not matter.

---

## Two Development Environments Going Forward

| Environment | What Runs | How to Access |
|-------------|----------|---------------|
| **WSL2 Ubuntu** (`~/projects/meridian/`) | Rust API server, PostgreSQL, Neo4j, Redis (Docker), React shared components, Next.js admin portal | VS Code → Remote WSL |
| **Windows** (PowerShell, separate project directory) | Tauri desktop app (`cargo tauri dev`, `cargo tauri build`) | VS Code → local Windows, or PowerShell directly |

The Tauri desktop app development will begin after the backend API is functional (BD-6: Rust backend first). When that time comes, the new Claude Code chat will set up a Windows-side Tauri project that imports the shared React components from the WSL2 workspace.

---

## What the First Phase 4 Session Should Do

After the WSL2 workspace is set up and cross-verification passes:

1. Run `context-loader` agent
2. Confirm state to Nick
3. Start with `SR_GOV_01` (tenant onboarding): create the PostgreSQL governance schema
4. Follow the implementation workflow from CLAUDE.md:
   - `verify-against-spec` → read full SR row → plan → confirm with Nick → implement → `trace-requirement` → `generate-test-from-spec` → test → `implementation-reviewer` → commit → update PROGRESS.md

---

## Sync Script for Workbook Updates

If the workbook needs updating during Phase 4, the sync path changes slightly for WSL2:

```bash
# From ~/projects/meridian/
python3 validation/sync-workbook.py
```

The `sync-workbook.py` script's path constants use `BUILD_ROOT / parent` which resolves to `~/projects/` in WSL2. The source workbook path (`/mnt/d/Projects/IDEA/working/`) may need updating in the script if it still references `D:\`. The first Phase 4 session should verify this.

---

## Architecture Reference (Read-Only, on D: drive)

These files are NOT in the WSL2 workspace. They are accessed via `/mnt/d/` when needed:

| Path (from WSL2) | What It Contains |
|-------------------|-----------------|
| `/mnt/d/Projects/IDEA/CLAUDE.md` | Project-level instructions, cardinal rules |
| `/mnt/d/Projects/IDEA/explore/BASE-STATE.md` | Trunk architecture snapshot |
| `/mnt/d/Projects/IDEA/explore/001-alt-predictive-governance-platform/` | 77 decisions, 14 original specs, skills, agents |
| `/mnt/d/Projects/IDEA/explore/002-spec-expansion/` | 484 SR rows, 4 sessions, PHASE_3_KICKOFF.md |
| `/mnt/d/Projects/IDEA/source/` | 25 trunk source files |
| `/mnt/d/Projects/IDEA/master/` | 6 consolidated master documents |
| `/mnt/d/Projects/IDEA/working/` | Workbook source, builder scripts |
