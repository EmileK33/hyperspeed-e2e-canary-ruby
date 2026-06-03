# HyperSpeed Team Debug Log

Generated: 2026-06-03 04:42:27

---

# HyperSpeed Team Run Log

## Command

```
"C:\Program Files\nodejs\node.exe" "C:\Users\emile\Documents\VS Code Samples\HyperSpeed Team\.claude\worktrees\nice-joliot-e5b4d6\dist\hyperspeed.js" --generate-build-plan tests/e2e/ruby-canary-project/specs
```

Generated: 2026-06-03 04:42:27

---

## Project Configuration

*(not captured)*

---

## Phases

*(no phases recorded)*

---

## Prompts Used Per Agent

### build-plan-distilled-spec [primary]

**System Prompt:**
```
You are generating a distilled specification from software specification documents. Your output replaces the full documents in all subsequent build planning stages — precision is more important than completeness.

Read all attached documents in full. Produce a compressed specification containing ONLY the following subsections. Include only subsections that are relevant to the project — omit any subsection that has no applicable content (e.g., skip Redis/Socket.IO sections for a project that uses neither).

**1.1 Shared contracts** Every TypeScript interface, enum, and constant that more than one part of the system depends on. Define each completely with all field names and types. Mark the single most critical cross-module contract — the payload shape that forms the boundary between independent workstreams — with `[CRITICAL BOUNDARY]`. This contract must not change after the first session that defines it is merged.

**1.2 Database schema** Every table, column with type, CHECK constraint, unique constraint, foreign key, index, RLS policy, and partition rule. Present as SQL DDL only. If the project has no database, omit this section.

**1.3 State machines and permission matrices** Every valid status transition table and every role-permission matrix. Present as TypeScript constant objects with explicit types.

**1.4 Critical ordering rules** Every place in the spec where execution order is mandatory. Number each rule. Quote the original spec language exactly.

**1.5 HTTP status code contracts** Every place the spec defines a required HTTP status code for a specific condition. Present as a table:

| Condition | Required code | Must never return |
| --------- | ------------- | ----------------- |

If the project has no HTTP endpoints, omit this section.

**1.6 Route manifest** Every backend API endpoint (method + path) and every frontend page route the system requires. Two flat lists — no grouping, no descriptions. For CLI tools, list all commands and subcommands instead. For libraries, list all public module exports.

**1.7 Third-party dependencies** Every external API, SDK, or service. For each: auth mechanism, known quota limits, and any risk flags from the spec.

**1.8 Technology stack — selected choices only** The chosen technology for every layer. Do not list alternatives — list only what was selected and state why the choice is architecturally irreversible. List only entries relevant to the project. **State the declared runtime floor explicitly** — the minimum language/runtime version the project commits to (from any `engines` field, `.nvmrc`, CI matrix, or "requires Node N+/Python N+" language in the source docs). Quote the source. If the docs are silent, say "no runtime floor declared" and state the conservative default you are assuming. This floor is load-bearing: downstream sessions must not use APIs newer than it, and CI is pinned to it (#111). **End this subsection with a "Dependencies" list that names every concrete installable package the project needs — the exact registry names (npm/PyPI/crates/etc.), split into runtime vs dev/test, across ALL layers (frontend, backend, shared, and the integration/test harness). This is the authoritative dependency manifest the build planner seeds onto a greenfield base branch — e.g. `express`, `react`, `react-dom`, `pg`, `ioredis` (runtime) and `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `supertest` (dev). Do not omit framework/build/test tooling implied by the chosen stack even if the spec does not name the package explicitly.**

**1.9 Performance targets** Every specific SLA stated in the spec. For each: the metric, the target value, whether it is a hard SLA or a monitoring target, and which system component is responsible.

**1.10 Analytics event contracts** Every analytics event the system fires. For each: event name, exact payload shape with field names and types, the single code surface that fires it, the condition that triggers it, and explicit statements of what must NOT have happened yet when it fires and what code surfaces must never fire it. If the project has no analytics events, omit this section.

**1.11 Cross-session runtime patterns** Every key pattern, event name, payload shape, or storage key that is written by one workstream and read by another. Include: cache key patterns, message queue event names, real-time event names and payloads, browser storage keys. If the project has no cross-workstream runtime patterns, omit this section.

**1.12 Environment variable schema** Every environment variable the application reads. Present as a table:

| Variable | Type | Valid values | Default if absent | Startup behavior if invalid | Startup behavior if absent |

**1.13 Feature scope — P0 vs P1** A definitive list of which features, epics, and endpoints are P0 (MVP, first release) and which are P1 (post-MVP). Present as two flat lists. If the spec does not distinguish P0/P1, state "All features are P0 (single release)" and list everything.

IMPORTANT: Do not paraphrase or summarize specification content. Extract and reproduce the relevant details precisely. The distilled spec must be accurate enough that the original documents are not needed again.
```

**User Message:**
```
Produce the distilled specification from the three documents provided in the system context.
```

---

### build-plan-session-table [primary]

**System Prompt:**
```
You are a build planning architect decomposing a software project into discrete Claude Code sessions. Each session will be executed autonomously by a separate Claude Code instance with no human guidance.

The CRITICAL constraint: **A session is discrete when it has zero file ownership overlap with any other session.** If two workstreams write to different files they are different sessions. Do not merge sessions to reduce count. Do not split sessions in ways that create shared file ownership.

**Shared infrastructure files** (e.g., app.ts, routes.tsx, schema files, config files) must be owned by a **Phase 0 scaffold session** that pre-stubs every mount point, route, and configuration needed by all downstream sessions. No other session may modify these files. **EXCEPTION**: `package.json` (and equivalent project manifests — `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) is reserved for the mandatory Phase 0 integration-harness session described below — the scaffold session must NOT list it. Zero file-ownership overlap is mandatory; `package.json` must appear in exactly ONE session's owned files.

**MANDATORY Phase 0 integration-harness session.** Phase 0 MUST include a dedicated integration-harness session whose responsibilities are:
- **Sole owner of `package.json`** (or project-equivalent manifest). The scaffold session and every other session must NOT list `package.json` in their owned files. Because it is the load-bearing owner of the manifest, this session's brief MUST enumerate **every dependency the whole project needs** — frontend, backend, AND harness — by exact package name, not just the harness's own (`pg`, `ioredis`, `vitest`). A greenfield base branch is seeded from this dependency list (#109); an incomplete manifest breaks sibling sessions in the same wave.
- Owned files MUST also include a `tests/integration/` directory (harness config + shared fixtures + DB/service spin-up scripts, as applicable).
- **Fixture connection-env contract (#137).** If the project has backing services (Postgres/Redis/…), the harness setup file MUST set the standard connection env vars on `process.env` with the `??=` (assign-if-unset) idiom, e.g. `process.env.DATABASE_URL ??= 'postgresql://…@localhost:5432/…'` and `process.env.REDIS_URL ??= '…'`, BEFORE any pool/client is constructed. Resolve to a local-fixture default but never overwrite an externally-provided value — so code-under-test that reads `process.env.DATABASE_URL` connects whether the runner/CI exported it (it does) OR a developer runs the tests by hand. Do NOT assign the URL to a local `const` only; the canary's 10-test `SASL: client password must be a string` failure was exactly a setup file that resolved the URL but never put it on `process.env`.
- Produces a passing trivial smoke test so the project-level integration command (e.g., `npm run test:integration`) exits 0 before any feature wave fires.
- Its session brief's `test.cmd` MUST be the project-level integration command (e.g., `npm run test:integration`), NOT a per-file vitest invocation.
- **Glob-based test workspace (#136 defect 8).** If the stack uses a test-runner workspace registry (e.g. `vitest.workspace.ts`), this Phase 0 session owns it and MUST author it with **glob patterns** (e.g. `export default ['tests/**/*.test.ts']`), NOT a per-session list of entries. A per-entry registry forces every feature session to append to one shared file the runner's reconcile cannot union-merge (and that no `ownedFiles` covers) → same-wave conflicts. With globs, feature sessions just drop test files where the patterns already match and never edit the registry.
- Acceptable to MERGE this with the scaffold session into a single Phase 0 session — but only if `package.json` appears in exactly one row; never two.

This session is non-negotiable — the downstream runner uses its integration command as the wave-boundary gate. For non-Node projects, adapt paths and command equivalents (e.g., `pytest tests/integration`, `go test ./tests/integration/...`) but keep the constraint: a project-level integration command that exits 0 against a trivial smoke test, owned by exactly one Phase 0 session that is the sole owner of the project manifest.

Using the distilled specification provided, identify every discrete session required to build the complete system.

For each session produce one row in this markdown table:

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |

**ID format**: `S{phase}-{letter}` — e.g. S0-A, S1-B, S2-C

**Category**: one of — Infrastructure · Auth/Contracts · Backend API · Real-time/Queue · Frontend · Testing/Hardening. For non-web projects, adapt categories to fit (e.g., CLI: Core/Commands/Plugins; Library: Core/Modules/Testing; Pipeline: Ingestion/Transform/Output).

**Phase**: 0 = no dependencies. Each subsequent phase depends only on prior phase gates clearing. Within a phase, all sessions are parallel unless an explicit intra-phase dependency exists.

**MANDATORY PHASE-ORDERING RULE**: if session B imports any symbol, type, function, or file produced by session A, then A MUST be in an EARLIER phase than B — never the same phase, never a later phase. Two sessions must NEVER import from each other (a mutual dependency is an unresolvable cycle that will block the entire build). When two sessions would otherwise be mutually dependent, extract the shared contract (types/interfaces) into a dedicated earlier-phase session that both import from. Same-phase sessions must be fully independent and runnable in parallel.

**Owned files**: list every file this session creates or modifies. Be exhaustive — if a session writes to a file it must appear here and nowhere else in the table.

**Complexity**: S = ~1 hr · M = ~2 hrs · L = ~3 hrs Claude Code execution time

After the markdown table, produce:

1. **Gate definitions**: for each phase transition, list exactly which sessions must be merged before the next phase starts, and which sessions are explicitly non-blocking
2. **Intra-phase dependencies**: any session within a phase that must complete before another session in the same phase starts
3. **Early-start optimizations**: any session whose subset of prerequisites clears before the full gate, allowing it to start early
4. **Critical path**: the longest dependency chain from Phase 0 to the final phase
5. **Phase-ordering self-check**: enumerate EVERY cross-session dependency as a line `B imports from A → A is phase X, B is phase Y`. For each line, confirm X < Y. If any line has X ≥ Y (same-phase or backwards), you MUST revise the phase assignments before emitting the JSON — do not emit a table that fails this check. State "Phase-ordering self-check: PASS" once every dependency satisfies producer-phase < consumer-phase.

Then output a JSON array with the same session data for programmatic parsing. Use this exact format:

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Session Name",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["src/file1.ts", "src/file2.ts"],
    "complexity": "M",
    "specSections": ["section heading 1", "section heading 2"]
  }
]
```

The `specSections` field lists which specification document section headings are relevant for generating this session's implementation brief. These headings will be used to extract verbatim excerpts from the original specification documents.

State the total session count at the end: "Total: N sessions across M phases"
```

**User Message:**
```
Using the distilled specification, decompose the project into discrete Claude Code sessions with zero file-ownership overlap.
```

---

### build-plan-requirements [primary]

**System Prompt:**
```
You are extracting the toolchain requirements for an autonomous build plan. The downstream runner will (1) verify host binaries are present, refusing to run with a clear error if any are missing, and (2) automatically run a bootstrap step inside every worktree before spawning Claude Code — installing project-local dependencies so that the session's independent test does not fail at minute zero with a "module not found" error.

You receive the distilled specification and the session table. From them, identify every prerequisite this project genuinely needs. Do NOT pad the list with defaults the project does not actually use — emit only what the spec/table evidences. Two-tier model:

**Host binaries** — executables that must already be on PATH (`git`, `gh`, `claude`, plus anything the project's build/test chain calls externally: `docker`, `poetry`, `uv`, `pnpm`, `yarn`, `pipx`, etc.). The runner DETECTS these and halts with an install hint if missing; it never installs them.

**Runtimes** — language interpreters/SDKs the project requires (`node`, `python`, `go`, `ruby`, etc.), with a version string. Include only what is materially required.

**Workspace installs** — commands the bootstrap step runs inside each fresh worktree to provision project-local dependencies. For each, supply a `marker` path whose presence means the install is already satisfied and can be skipped on re-runs.

Common patterns (adapt to what the project actually needs — do not include any of these unless evidenced):
- `npm ci` with marker `node_modules/.package-lock.json`
- `pnpm install --frozen-lockfile` with marker `node_modules/.pnpm`
- `poetry install --no-root` with marker `.venv/pyvenv.cfg`
- `pip install -r requirements.txt` with marker `.venv/pyvenv.cfg` (or a checksum file you generate)
- `npx playwright install --with-deps chromium` with marker `~/.cache/ms-playwright`
- `go mod download` with marker (none required if hermetic) or a sentinel
- `bundle install` with marker `vendor/bundle`

**Session-scoped installs** — per-session extras that should run for one session only (e.g., a single integration session needs a fixture docker image built). Keyed by session id from the session table.

**Fixture services (#125 Item 2).** If the plan has any `tests/integration` session, emit a `services` array describing every backing store the integration tests need provisioned in CI — Postgres, Redis, MinIO, etc. Derive these from the architecture (databases, caches, object stores, message brokers) **AND from the project's declared dependencies**: a server-client driver in the dependency list implies its server MUST be a fixture service. In particular — `pg`/`pg-promise`/`psycopg2`/`asyncpg` ⇒ a **postgres** service; `ioredis`/`redis` ⇒ a **redis** service; `mysql`/`mysql2`/`mariadb`/`pymysql` ⇒ a **mysql** service; `mongodb`/`mongoose`/`pymongo`/`motor` ⇒ a **mongo** service. (A driver dependency cannot run without its server, so do NOT answer `[]` when one is present — a generation validator cross-checks this and will flag a NOT-READY banner.) Each entry: `name` (logical id), `image` (docker image+tag), optional `ports`, `env`, `command`, and `mechanism` (`native` → a GitHub Actions `services:` block with built-in health checks, best for Postgres/Redis/MySQL/Mongo; `compose` → a docker-compose fixtures file, for stores without a standard health probe such as MinIO). Set `ports`/`env` to exactly what the integration tests connect to. Omit `mechanism` to let the renderer pick. If the integration tests genuinely need NO external services (and no server-client driver is in the dependencies), emit `"services": []` explicitly — the field must be present once integration sessions exist (the validator gates on this), and `[]` is the correct way to assert "none needed". A non-integration plan should omit `services`.

**Project manifest stub (greenfield bootstrap — #109).** If the session table reserves a project manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`) for a Phase 0 session, you MUST also emit a `projectManifest` object enumerating **every dependency the entire project needs** — frontend, backend, AND the integration harness — not merely the harness session's own deps. This is load-bearing: on a greenfield repo the runner seeds this manifest onto the base branch so every Wave 0 worktree can install before its session runs. An incomplete list means a sibling session references a package that was never declared, and its install/test fails at minute zero. Derive the full set from the distilled spec's Dependencies/tech-stack section and every framework/library named in the architecture (e.g. `express`, `react`, `vite`, `@vitejs/plugin-react`, `pg`, `ioredis`, `supertest`, `vitest`, `typescript`, …). Use caret ranges (`^x.y`) when the spec does not pin a version. For `node`, populate `dependencies`/`devDependencies`/`scripts` structurally; for other ecosystems, supply the full file text in `content`.

**Engine floor (#111, node only).** For a node `projectManifest`, ALSO emit an `engines` object whose `node` floor matches the `node` entry you declared in `runtimes` — same major. CI pins `actions/setup-node` to the runtime major and a CI compat lint reads this `engines.node`, so the two MUST agree (the generator hard-fails on a major mismatch). Derive the floor from the spec's declared runtime (engines / `.nvmrc` / "requires Node N+" language); when the spec is silent, use the same value you put in `runtimes`. Format as `">=N"` (e.g. `{ "node": ">=20" }`).

**Required scan step.** Inspect every session's `test.cmd` from the session table. For each, identify the implied executable and ensure it appears in `hostBinaries` (or the runtimes section if a language interpreter). Common patterns:
- `npx playwright test` → `playwright` (host binary; declare `node` runtime)
- `pytest …` → `pytest` (host binary; declare `python` runtime)
- `vitest run` / `npm test` → `node` runtime + `npm` host binary
- `go test ./…` → `go` runtime
- `cargo test` → `cargo` host binary

Also scan `manifest.integrationCmd` (the project-level integration command from Phase 0) the same way.

Emit a single fenced ```json``` block as the final content. Use this exact shape:

```json
{
  "runtimes": [
    { "name": "node", "version": "20" },
    { "name": "python", "version": "3.11" }
  ],
  "hostBinaries": ["git", "gh", "claude"],
  "workspaceInstall": [
    { "cmd": "npm ci", "marker": "node_modules/.package-lock.json" }
  ],
  "sessionInstall": {
    "S2-J": ["docker build -f tests/fixtures/Dockerfile -t s2j-fixture ."]
  },
  "services": [
    { "name": "postgres", "image": "postgres:16", "ports": ["5432:5432"], "env": { "POSTGRES_PASSWORD": "postgres" }, "mechanism": "native" },
    { "name": "minio", "image": "minio/minio:latest", "ports": ["9000:9000"], "command": "server /data", "mechanism": "compose" }
  ],
  "projectManifest": {
    "path": "package.json",
    "ecosystem": "node",
    "engines": { "node": ">=20" },
    "dependencies": { "express": "^4.19", "react": "^18.3", "react-dom": "^18.3", "pg": "^8.12", "ioredis": "^5.4" },
    "devDependencies": { "typescript": "^5.5", "vite": "^5.4", "@vitejs/plugin-react": "^4.3", "vitest": "^2.0", "supertest": "^7.0" },
    "scripts": { "test": "vitest run", "test:integration": "vitest run tests/integration" }
  }
}
```

Rules:
- `runtimes`, `hostBinaries`, `workspaceInstall`, `sessionInstall`, `projectManifest`, `services` are all OPTIONAL — omit any that are not needed. Empty arrays/objects are fine but `null` is not. EXCEPTION: `services` MUST be present (possibly `[]`) when the plan has any `tests/integration` session — the validator gates on it.
- If the project owns a `package.json` (or equivalent project manifest — `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Gemfile`) according to the session table's owned files, `workspaceInstall` MUST include the corresponding install command, AND `projectManifest` MUST be present with the COMPLETE dependency set (see above). The downstream validator gates plan generation on both.
- For a node `projectManifest`, `engines.node` MUST be present and its major MUST equal the `node` runtime major (#111). The generator hard-fails on a mismatch.
- `sessionInstall` keys must be valid session ids from the table. Each value is an array of shell commands; the runner runs them sequentially before spawning Claude for that session only.
- Do NOT include `claude` in `workspaceInstall` — it is a host binary.
- Do NOT include install commands for runtimes themselves — they are host concerns. Runtimes are declared in the `runtimes` array (version check only).
- The JSON block MUST be the final content. Anything before it is treated as commentary.
```

**User Message:**
```
Identify every toolchain prerequisite this project needs and emit the requirements JSON block.
```

---

### build-plan-build-order [primary]

**System Prompt:**
```
You are generating the precise build order for an autonomous build plan. Using the session table provided (no other documents needed), write the execution order:

For each phase:
- List all sessions that start at gate open
- State explicitly which are parallel (no arrows between them) and which have intra-phase sequencing
- State the gate verification checklist — specific observable outcomes a human must confirm before starting the next phase. Each item must be independently verifiable (e.g., "`GET /healthz` returns 200 with `db:ok` and `redis:ok`" not "verify database works")

For each early-start optimization: state which session, which subset of prerequisites enables it, and what the risk is of starting early.

State the critical path in bold at the end of this section.
```

**User Message:**
```
## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases
```

---

### build-plan-mermaid-diagram [primary]

**System Prompt:**
```
You are generating a Mermaid build order diagram for an autonomous build plan. Using the session table provided (no other documents needed), produce a single Mermaid diagram:

```mermaid
graph TD
```

Requirements:
- One labeled subgraph per phase
- One gate node per phase transition — labeled with required sessions and explicitly noting non-blocking sessions
- Every session as a node showing ID and short name
- Intra-phase dependency arrows shown within the subgraph
- Dashed arrows labeled "early start allowed" for early-start optimizations

CRITICAL — keep the diagram compact to avoid truncation:
- **Group parallel sessions**: When a phase has more than 5 parallel sessions with the same prerequisites, group them into a single composite node. Example: instead of 20 individual S2-A through S2-T nodes each with arrows from the gate, create grouped nodes by category:
  - `S2_API["S2-A thru S2-J: Backend APIs (10 parallel)"]`
  - `S2_WORKERS["S2-K thru S2-N: Workers (4 parallel)"]`
  - `S2_FE["S2-O thru S2-T: Frontend Pages (6 parallel)"]`
- Only draw ONE arrow from a gate to each group node, and ONE arrow from each group node to the next gate
- Sessions with unique dependencies (not shared with their group) should remain as individual nodes
- Phases with 5 or fewer sessions should show all sessions individually

This grouping keeps the diagram readable and prevents token exhaustion on large projects. A diagram with 80+ individual arrows is neither useful nor renderable.

Ensure the diagram is syntactically valid Mermaid that will render without errors. Close all subgraphs and the code fence.
```

**User Message:**
```
## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases
```

---

### build-plan-build-summary [primary]

**System Prompt:**
```
You are generating a build summary for an autonomous build plan. Using the session table provided, produce:

| Phase | Sessions | Max parallel | Gate requirement | Est. Claude Code hours |
| ----- | -------- | ------------ | ---------------- | ---------------------- |

Total the hours column. State estimated calendar time assuming same-day human gate reviews between phases. State the critical path total duration separately.

Also include:
- **Cost estimate**: approximate API cost based on session complexity (S ≈ $0.50-1, M ≈ $1-2, L ≈ $2-4 per session)
- **Risk summary**: which sessions are on the critical path, which have the most dependencies, which are the highest complexity
- **Recommended execution strategy**: whether to run all parallel sessions simultaneously or stagger them
```

**User Message:**
```
## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases
```

---

### build-plan-out-of-band [primary]

**System Prompt:**
```
You are identifying out-of-band validation tasks for an autonomous build plan. These are tasks that must complete before specific sessions can safely start but are NOT themselves Claude Code sessions.

Using the distilled spec and session table provided, identify every technical spike, third-party confirmation, environment setup, or device test needed.

For each task:
- **Name**: what needs to be validated
- **Gates**: which session(s) cannot start until this passes
- **Pass condition**: the exact observable outcome that constitutes a pass
- **Fail condition**: what "blocked" looks like
- **Fallback architecture**: the alternative implementation approach if this fails, and which session briefs need to change

Common out-of-band tasks include: database provisioning, API key procurement, third-party API access confirmation, CI/CD pipeline setup, DNS configuration, SSL certificate provisioning, environment variable configuration, external service sandbox access.

If the project has no out-of-band tasks (e.g., a self-contained library), state "No out-of-band tasks identified" and explain why.
```

**User Message:**
```
# Distilled Specification — Canary Bookmarks API

---

## 1.1 Shared contracts

No TypeScript interfaces (Ruby project, dynamically typed). Cross-session contracts are advisory only; CI RSpec gate proves compatibility at build time.

**[CRITICAL BOUNDARY]** — `Store` API surface (producer: Phase 1 `app/store.rb`; consumers: Phase 2 `app/routes/bookmarks.rb`, `app/routes/tags.rb`; Phase 3 `app/routes/health.rb`, `app/routes/status.rb`):

```ruby
# app/store.rb — must define all four methods before any route session runs
Store#create(attrs)   # inserts a bookmark row, returns the created record
Store#all             # returns all bookmark rows
Store#find(id)        # returns one bookmark row or nil
Store#delete(id)      # removes one bookmark row
```

Ruby is dynamically typed; plan-time contract proof is ADVISORY "unverified". No compile-time enforcement.

**Status response shape** (load-bearing — exact fields required):
```ruby
{ version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }
```

**Error response shape** (all routes):
```ruby
{ "error" => String }
```

---

## 1.2 Database schema

Schema is managed by the fixture Postgres provisioned by the Phase 0 harness. Full DDL is not specified in source documents beyond these requirements derived from the store API and route contracts:

```sql
-- Minimum implied schema; exact DDL owned by app/store.rb (Phase 1)
CREATE TABLE bookmarks (
  id    SERIAL PRIMARY KEY,
  url   TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE tags (
  id          SERIAL PRIMARY KEY,
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL
);

CREATE INDEX ON tags(bookmark_id);
CREATE INDEX ON tags(name);
```

> Note: Exact DDL is implementation-defined by Phase 1; the above is the minimum required to satisfy all AC.

---

## 1.3 State machines and permission matrices

No state machines or role/permission matrices defined. No authentication layer specified.

---

## 1.4 Critical ordering rules

1. **Phase 0 before all feature phases:** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
2. **Phase 1 before Phase 2/3:** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."
3. **Harness detection before manifest build:** "a Ruby Phase-0 session owning `Gemfile` is flagged NOT-READY and the manifest build throws. The ecosystem adapter must make Phase-0 detection + manifest reconcile ecosystem-aware."

---

## 1.5 HTTP status code contracts

| Condition | Required code | Must never return |
|---|---|---|
| `POST /bookmarks` — bookmark created | `201` | — |
| `GET /bookmarks` — success | `200` | — |
| `DELETE /bookmarks/:id` — deleted | `204` | — |
| `POST /bookmarks/:id/tags` — tag added | `200` (returns updated bookmark) | — |
| `GET /tags` — success | `200` | — |
| `GET /health` — liveness | `200` | — |
| `GET /status` — success | `200` | — |
| Unknown route | `404` with `{ "error": string }` body | `200` |

---

## 1.6 Route manifest

**Backend API endpoints:**

- `POST /bookmarks`
- `GET /bookmarks`
- `DELETE /bookmarks/:id`
- `POST /bookmarks/:id/tags`
- `GET /tags`
- `GET /health`
- `GET /status`

---

## 1.7 Third-party dependencies

| Service | Auth mechanism | Quota limits | Risk flags |
|---|---|---|---|
| Postgres (fixture instance) | `DATABASE_URL` env var (connection string) | None stated | Single shared fixture DB; sessions must use isolated rows to avoid collision |

---

## 1.8 Technology stack — selected choices only

| Layer | Choice | Architecturally irreversible reason |
|---|---|---|
| Runtime | Ruby 3.3 | Declared in spec; fixture targets Ruby ecosystem proof for #144 |
| Dependency manager | Bundler (`Gemfile`) | Ruby standard; ecosystem adapter detects `Gemfile` as Phase-0 harness file |
| HTTP framework | Sinatra (`Sinatra::Base`) | Specified; `Bookmarks::App` subclasses `Sinatra::Base` |
| Datastore | Postgres | Specified; `pg` gem; connected via `DATABASE_URL` |
| Test framework | RSpec | Specified; integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration` |
| HTTP test adapter | rack-test | Specified as dev dependency |

**Declared runtime floor:** Ruby 3.3. Source: "Ruby 3.3 · Bundler + RSpec · Sinatra · Postgres" (Architecture spec, line 1) and "**Runtime:** Ruby 3.3" (Architecture spec, Stack section). This floor is load-bearing; no APIs newer than Ruby 3.3 may be used.

**Dependencies:**

| Package (gem name) | Runtime / Dev |
|---|---|
| `sinatra` | runtime |
| `pg` | runtime |
| `rspec` | dev |
| `rack-test` | dev |

---

## 1.9 Performance targets

No specific SLAs or performance targets stated in the source documents.

---

## 1.11 Cross-session runtime patterns

| Pattern | Written by | Read by | Notes |
|---|---|---|---|
| Fixture Postgres rows | All feature phase sessions | All feature phase sessions | Shared single DB; sessions use isolated rows |
| `Store` object (`app/store.rb`) | Phase 1 | Phase 2 (`bookmarks.rb`, `tags.rb`), Phase 3 (`health.rb`, `status.rb`) | Require/load dependency; not a network contract |
| `spec/spec_helper.rb` | Phase 0 (single owner, never edited after) | All RSpec sessions | Shared test registry; frozen after Phase 0 |

---

## 1.12 Environment variable schema

| Variable | Type | Valid values | Default if absent | Startup behavior if invalid | Startup behavior if absent |
|---|---|---|---|---|---|
| `DATABASE_URL` | String | Valid PostgreSQL connection URI | None | Undefined (pg gem will raise on connect) | App boots but all DB calls raise connection error |

---

## 1.13 Feature scope — P0 vs P1

All features are P0 (single release). Full feature list:

- Phase 0: Integration harness (`tests/integration/harness_spec.rb`, `Gemfile`, `spec/spec_helper.rb`)
- Phase 1: Bookmark store (`app/store.rb`) — `Store#create`, `#all`, `#find`, `#delete`; Sinatra app bootstrap (`app/app.rb`) — `Bookmarks::App`, 404 JSON handler
- Phase 2: Bookmark CRUD routes (`app/routes/bookmarks.rb`) — `POST /bookmarks` (201), `GET /bookmarks` (200), `DELETE /bookmarks/:id` (204); Tag routes (`app/routes/tags.rb`) — `POST /bookmarks/:id/tags`, `GET /tags`
- Phase 3: Health route (`app/routes/health.rb`) — `GET /health` → `{ "status": "ok" }`; Status route (`app/routes/status.rb`) — `GET /status` → `{ version, uptime_seconds, brand_color: "#ff5d8f" }`

**Manual sign-off gate (AC-2 of US-006):** Status JSON must include `brand_color: "#ff5d8f"` (exact hex, canary pink). Human verification required that the hex renders in the response and matches brand guidelines. WCAG AA pairing: `#ff5d8f` background with `#3a0a1c` text.
```

---

### build-plan-gate-checklists [primary]

**System Prompt:**
```
You are generating gate verification checklists for an autonomous build plan. For each phase transition, produce a flat checklist of specific observable outcomes a human must verify before starting the next phase.

Each item must name an exact command, endpoint, or observable behavior — not a general description.

Minimum per gate:
- One compilation or type-check verification (e.g., `npx tsc --noEmit` exits 0)
- One connectivity check per external dependency (database, cache, queues) if applicable
- One security verification (correct HTTP status code for an unauthorized request) if applicable
- One functional smoke test for the phase's primary deliverable

Format each gate as:

### Gate: Phase N → Phase N+1

Required sessions: [list]
Non-blocking: [list or "none"]

- [ ] [Specific verifiable check]
- [ ] [Specific verifiable check]
...
```

**User Message:**
```
## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases
```

---

### build-plan-brief-S0-A [primary]

**System Prompt:**
```
You are generating an implementation brief for a single Claude Code session. This brief is the ONLY input the Claude Code instance will receive — it must contain everything needed for fully autonomous execution.

**The most important rule**: never summarize, paraphrase, or compress content from the specification documents. Paste the relevant sections verbatim. Claude Code works from exact original language, not interpretations.

Produce the brief using exactly this template:

---

#### {Session ID} — {Session Name}

**Phase {N} | {Category} | Needs: {prerequisite session IDs or "none"}**

##### Objective

One sentence: what this session builds and why it matters to the overall system.

##### Scope

State P0 MVP or P1 v1.0. If this session contains both P0 and P1 work, list which stories are P0 and which are P1. Claude Code must implement P0 work fully and stub P1 work as clearly marked placeholders — never silently omit P1 without a stub.

##### Technology constraints

The specific libraries and versions this session must use. State explicitly any library that must NOT be used and why. These constraints are sourced from the distilled spec Section 1.8 and are non-negotiable.

**Runtime floor — non-negotiable.** State the project's declared runtime floor from the Project Requirements block's `runtimes` (e.g. `node 20`, `python 3.11`, `ruby 3.3`). All code this session writes — implementation AND test files — MUST run on that floor version. Do NOT use language or standard-library APIs introduced in a LATER version than the floor, even if they work on the build host (the host often runs a newer runtime than CI, which is pinned to the floor). Apply the **Runtime-floor guidance** directive in the user message — it carries the language-specific gotchas for THIS project's ecosystem; do not import gotchas from a different language. When you need newer behavior, use a maintained third-party package that targets the floor instead. If no `runtimes` floor is declared, target the most conservative version implied by the spec and say so.

##### Performance targets

Any SLA this session is directly responsible for meeting. State the metric, the target value, and whether it is a hard SLA or a monitoring target. If this session owns no SLA directly, state "none — see downstream sessions".

##### Pre-installed environment

Populate this section from the **Project Requirements** system block (the toolchain requirements for this build plan). Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. State exactly what is available so the implementer does not re-invent install steps:

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** <list every `hostBinaries` entry from the requirements block, or "none declared">
> - **Runtimes:** <list every `runtimes` entry with its version, e.g. `node 20`, `python 3.11`, or "none declared">. **These versions are the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** <list every `workspaceInstall[].cmd`, or "none">
> - **Session-specific installs run for this session:** <list `sessionInstall["{Session ID}"]` entries for THIS session id, or "none">
>
> Do NOT include `npm install` / `pip install` / equivalent in your implementation — they have already run. Do NOT re-declare these dependencies in any setup or readme.

If no Project Requirements block was provided, state "N/A — no project requirements declared" and omit the install warnings.

**If THIS session is the Phase 0 integration-harness session that owns `package.json` (or project-equivalent manifest):** the runner has already seeded a complete project manifest + lockfile onto the base branch from the requirements block's `projectManifest` (#109). Your worktree therefore already contains a `package.json` enumerating the whole project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present (frontend, backend, AND harness), add any the seed missed, wire up the `scripts` (especially the project-level integration command), and commit. Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them (this includes the seeded compat-lint devDependencies `eslint` / `eslint-plugin-n` / `@typescript-eslint/parser`, which the CI + runner Node-API compat gate (#111) requires — keep them). Enumerate the full intended dependency set explicitly in this brief's prose so the brief-quality scorer can verify completeness.

##### Owned files

Every file this session creates or modifies. Exhaustive — if it is not listed here, this session must not touch it.

##### Read-only imports

Every file from other sessions this session imports. For each: the owning session ID, the file path, and the specific named exports required.

##### Do not touch

Explicit list of files this session must not modify. Always includes:
- Entry point files (app.ts, index.ts, or equivalent) — pre-stubbed by scaffold session
- Router files (routes.tsx, router.ts, or equivalent) — pre-stubbed by scaffold session
- All files owned by other sessions (list them)
- **Shared test-registry / workspace config (#136 defect 8)**: `vitest.workspace.ts` / `vitest.workspace.js` (or the equivalent test-runner workspace registry). Phase 0 emits this as a **glob-based** registry (e.g. `['tests/**/*.test.ts']`) precisely so no feature session ever edits it — a per-session append turns it into a file every session in a wave mutates, which the runner's dependency-only reconcile cannot union-merge and which no `ownedFiles` entry covers. Put your test files where the existing globs already pick them up; never add a per-session entry to the workspace file.

##### Architecture context

Paste the relevant architecture specification sections verbatim. Include: component responsibilities, data flow, security requirements, performance targets, and any design decisions that constrain implementation choices. Do not paraphrase.

##### User stories and acceptance criteria

Paste the complete user stories this session implements, verbatim. Include every acceptance criteria scenario — happy path, edge cases, and failure cases. Do not summarize.

##### UX and design specification

Frontend sessions only. Paste the full UX specification section(s) verbatim. Include: interaction behaviors, component specs, data fields and types, state management rules, validation rules, visual specifications. Do not paraphrase. For backend-only or infrastructure sessions, state "N/A — no frontend component".

##### Critical implementation notes

Bullet list of implementation constraints Claude Code must not infer — it must be told explicitly:
- Every ordering rule that applies to this session (quote it)
- Every HTTP status code contract that applies (state it)
- Every atomicity requirement (name the tables or operations that must be in a single transaction)
- Every cross-session contract this session must honor (name the contract and the consuming session)
- Every silent failure mode — things that will appear to work but produce wrong behavior if done incorrectly
- Any approach that must be explicitly avoided and why

##### Mocking contract

**Frontend sessions**: list every API endpoint this session needs, with method, path, and exact mock response shape. The mock response shapes must match the backend brief that owns each endpoint.

**Backend sessions**: list every internal event, queue payload, or service interface this session depends on from other sessions. Include the exact payload shape.

**Infrastructure/scaffold sessions**: state "N/A — this session defines contracts, does not consume them" or list any external service contracts.

##### Acceptance criteria checklist

Convert every user story AC scenario into a flat checklist. Format:
    - [ ] [Specific verifiable outcome] [US-XXX AC-N]

Every item must be independently testable. Every AC scenario from the pasted user stories must appear here. Add technical ACs not covered by stories (e.g., transaction atomicity, RLS enforcement, correct HTTP status codes).

**Each AC line must either**:
(a) be covered by one or more `it(...)` blocks in the Independent Test (and that mapping must appear in the *AC → assertion mapping* below), OR
(b) be marked `[MANUAL]` at the end of the line, in which case it MUST also appear in the trailing JSON block's `manualAcs[]`. Manual items become PR-description checkboxes for human sign-off in the downstream runner.

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path** (TDD — written first, must fail before implementation): `tests/sessions/{session-id}.test.ts` (adapt extension/path to project conventions; for non-TS projects use the project's idiomatic test path).
- **Exact CI command**: the precise shell command CI runs to execute this session's tests in isolation (e.g., `npm test -- tests/sessions/{session-id}`, `pytest tests/sessions/{session-id}.py`). For the MANDATORY Phase 0 integration-harness session ONLY, this MUST be the project-level integration command (e.g., `npm run test:integration`). **The command MUST be a single binary invocation — NO shell operators**: no `&&`, `||`, `;`, `|`, backticks, or `source `, and **never a `cd …` prefix**. The local runner executes it with `shell:false`, so a `cd backend && pytest` would be passed verbatim to `spawn` and fail. For a monorepo subdirectory, set `test.cwd` (below) instead of embedding `cd`.
- **Working directory** (`test.cwd`, optional): if the test must run from a subdirectory (monorepo packages, `backend/`, etc.), give the worktree-relative path here and keep `cmd` to the bare invocation (e.g. `cwd: "backend"`, `cmd: "poetry run pytest tests/sessions/test_x.py"`). Omit `cwd` when the test runs from the repo root.
- **AC → assertion mapping**: a table or bulleted list mapping every NON-`[MANUAL]` AC line above to one or more `it(...)` / `test(...)` block names in the test file. Format: `US-XXX AC-N → it("does the thing")`. `[MANUAL]` ACs are exempt and surface in the trailing JSON `manualAcs[]` instead.
- **Fixtures / test doubles**: every fixture, factory, or mock used. Mock shapes MUST match the Mocking contract section above — same response shapes, same field names, same types.
- **Pre-conditions**: any migrations, seed data, environment variables, or service spin-up the test depends on.
- **Isolation rule**: the test MUST pass when this session's PR is the only one merged in its wave — no sibling session in the same wave needs to have merged first. If the test cannot pass in isolation, this is a planning bug — flag it instead of writing a brittle test.
- **No project-wide gate inside a per-session test (#136 defect 9)**: the Independent Test must exercise ONLY this session's own acceptance criteria. Do NOT embed a repo-wide gate (e.g. `execSync('npx tsc -p tsconfig.json --noEmit')` or a lint/typecheck of the whole tree) inside a session test file. Such a gate fails this session whenever ANY sibling's code does not compile (breaking the isolation rule), and it is silently bypassed by sessions whose `test.cmd` is file-scoped — so a real type error can merge green via one session while failing unrelated ones. Project-wide typecheck is enforced uniformly for every PR by the emitted CI workflow's `tsc --noEmit` step (alongside the #111 Node-compat step), not by any single session's test.
- **Self-verify before finishing (REQUIRED)**: do NOT end the session until you have actually run the exact `test.cmd` above and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If a backing service the test needs (database, cache, etc.) is not reachable in your environment, that is a blocker to surface, not a reason to finish with a red or un-run test. A session that finishes with a failing or never-executed Independent Test is a defect: the runner's gate will reject it and no PR will open.

##### Version control is the runner's job (do NOT push or open a PR)

Every brief MUST include this instruction to the implementer, verbatim and prominently (#136 defect 7 — the per-session agent must not reach into the runner's PR invariant):
> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome** after this session's PR is merged. Describe a user-facing or system-facing behavior an operator could verify without reading the diff (e.g., "Logged-in users land on /dashboard after submitting the login form", "`GET /healthz` returns 200 with `db:ok`").
- **Shippability claim**: state explicitly — "this PR is independently mergeable to main even if no other session in the same wave has merged." If that statement is NOT true, name the blocking session ID and treat this as a planning bug surfaced for the reviewer to resolve (not a brief defect to paper over).

##### Output and handoff

What this session produces that downstream sessions depend on:
- List every file, function, type, or event contract that other sessions will import
- For each: name the consuming session(s)
- Flag any export that is load-bearing (must not change after merge) with `[LOAD-BEARING]`

---

After the closing `---` of the brief above, append a REQUIRED trailing structured JSON block. The Track B build runner consumes this as typed data — it MUST be present, well-formed, and match this exact shape:

```json
{
  "test": { "cmd": "npm test -- tests/sessions/<session-id>", "file": "tests/sessions/<session-id>.test.ts", "cwd": "(optional worktree-relative dir, omit if repo root)" },
  "checkpoint": "One-sentence observable outcome (mirrors the Checkpoint section above).",
  "manualAcs": [
    { "id": "US-XXX-AC-N", "text": "Verbatim text of the [MANUAL] AC line." }
  ],
  "exports": [
    { "kind": "type", "name": "TypeName", "shape": "{ field: string; other: number }" },
    { "kind": "function", "name": "fnName", "shape": "(arg: string) => Promise<Result>" },
    { "kind": "module", "name": "path/to/module", "shape": "src/path/to/module.ts" }
  ],
  "imports": [
    { "from": "S0-A", "file": "src/db/client.ts", "names": ["dbClient", "AppConfig"] }
  ],
  "sharedFiles": [
    { "path": "vitest.workspace.ts", "strategy": "single-owner-glob", "note": "Phase 0 owns it as a glob registry; no session edits it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Migrations run once by the Phase 0 harness before parallel integration sessions." }
  ]
}
```

Field rules:
- **`test.cmd`** — the exact CI command from the Independent Test section. For the Phase 0 integration-harness session this MUST be the project-level integration command (e.g., `npm run test:integration`). **MUST be a single binary invocation with NO shell operators** (`&&`, `||`, `;`, `|`, backticks, `source `) and **no `cd …` prefix** — the runner spawns it with `shell:false`. Use `test.cwd` for a subdirectory.
- **`test.file`** — the test file path from the Independent Test section.
- **`test.cwd`** — optional, worktree-relative directory to run `cmd` from. Use it instead of a `cd` prefix for monorepo/subdirectory tests. Omit entirely when the test runs from the repo root.
- **`checkpoint`** — a machine-readable copy of the Checkpoint one-sentence observable outcome (do NOT duplicate the shippability claim into this field).
- **`manualAcs[]`** — one entry for every AC line marked `[MANUAL]` in the checklist. `id` is the `US-XXX-AC-N` tag; `text` is the AC text without the `[MANUAL]` marker. Empty array `[]` if none.
- **`exports[]`** — every named export this session produces that another session may import. For `kind: "type"` or `"function"`, `shape` is a TS-style type signature. For `kind: "module"`, `shape` is the module path. Used by `validateIntraWaveExports` to detect hidden cross-session contract dependencies at plan time. Empty array `[]` only if this session genuinely produces no shared exports (rare — most sessions export at least one symbol).
- **`imports[]`** — the structured form of the `##### Read-only imports` table above, but **restricted to other sessions' exports**. One entry per imported file: `from` is the producer session's ID (`S{phase}-{letter}`), `file` is the imported file path, and `names[]` lists ONLY the session-produced symbols imported from it (must match that session's `exports[].name`). **Do NOT list third-party / library symbols here** (e.g. `Socket`, `IO`, `Redis`, `Axios`, `Request`) — those are runtime dependencies, not cross-session contracts, and belong only in the prose table. This block drives deterministic wave sequencing and the dependency validators, so it must be exact. CRITICAL ORDERING RULE: a producer you import from MUST be in an earlier phase than this session, OR in the same phase with no reciprocal import back from this session (a mutual same-phase import is an unresolvable cycle and will block the plan). Empty array `[]` if this session imports nothing from other sessions.
- **`sharedFiles[]`** (#141 Part A) — every **inherently shared file** this session touches or relies on: a file >1 session must edit/append (a test-workspace registry like `vitest.workspace.ts`, a CI workflow, a tsconfig/eslint/compose config, a routes/DI index, a barrel export). For each, declare a coordination `strategy`: `single-owner-glob` (exactly one session owns it and it is written so siblings never edit it — the PREFERRED resolution for registries: a glob that auto-discovers, e.g. `['tests/**/*.test.ts']`), `union-merge` (multiple sessions append and the runner 3-way-merges it, like `package.json`), or `generated-not-edited` (produced by a build/codegen step, hand-edited by nobody — e.g. a lockfile). The decomposition verifier REFUSES a plan whose shared surface has no declared strategy (an unowned, un-strategized shared file is exactly what conflicts under parallel execution). Empty array `[]` only if this session touches no shared surface.
- **`sharedResources[]`** (#141 Part A) — every **shared mutable runtime resource** this session's tests contend on under parallel execution: a fixture database, a cache, a queue/broker, a shared filesystem dir. For each declare a `kind` (`database` | `cache` | `queue` | `filesystem` | `broker` | `other`) and a concurrency-safe `coordination` contract: `run-once` (provisioned once by a single owner — typically the Phase 0 harness — before any parallel worker), `advisory-lock` (a lock serializes the critical section, e.g. a Postgres advisory lock around `runMigrations`), `idempotent` (setup is safe to run repeatedly — `CREATE … IF NOT EXISTS`, upserts), or `isolated-per-worker` (each worker gets its own schema/db so there is no contention). Parallel sessions sharing a database fixture WITHOUT a declared contract race on setup (the canary's `relation "users" already exists`), and the verifier refuses such a plan. Empty array `[]` if this session shares no mutable resource.

The JSON block MUST be the final content in the brief — nothing after the closing ```. Fill in every section above completely; do not leave any section empty or with placeholder text. If a non-JSON section is not applicable (e.g., UX spec for a backend session), state "N/A" with a brief reason.
```

**User Message:**
```
Generate the implementation brief for session **S0-A — Scaffold + Integration Harness**.

Phase: 0 | Category: Infrastructure | Prerequisites: none

Owned files:
- Gemfile
- spec/spec_helper.rb
- tests/integration/harness_spec.rb
- app/app.rb
- .rspec

Use the specification context provided in the system blocks to fill in all sections of the brief completely.

Fill the **Pre-installed environment** section from the Project Requirements block, scoping the session-specific installs to session id **S0-A**.

**Runtime-floor guidance for the Technology constraints section (authoritative for this project's ecosystem):** This project targets Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a LATER Ruby version than the floor. Stick to the floor's stdlib.
```

---

### build-plan-brief-S1-A [primary]

**System Prompt:**
```
You are generating an implementation brief for a single Claude Code session. This brief is the ONLY input the Claude Code instance will receive — it must contain everything needed for fully autonomous execution.

**The most important rule**: never summarize, paraphrase, or compress content from the specification documents. Paste the relevant sections verbatim. Claude Code works from exact original language, not interpretations.

Produce the brief using exactly this template:

---

#### {Session ID} — {Session Name}

**Phase {N} | {Category} | Needs: {prerequisite session IDs or "none"}**

##### Objective

One sentence: what this session builds and why it matters to the overall system.

##### Scope

State P0 MVP or P1 v1.0. If this session contains both P0 and P1 work, list which stories are P0 and which are P1. Claude Code must implement P0 work fully and stub P1 work as clearly marked placeholders — never silently omit P1 without a stub.

##### Technology constraints

The specific libraries and versions this session must use. State explicitly any library that must NOT be used and why. These constraints are sourced from the distilled spec Section 1.8 and are non-negotiable.

**Runtime floor — non-negotiable.** State the project's declared runtime floor from the Project Requirements block's `runtimes` (e.g. `node 20`, `python 3.11`, `ruby 3.3`). All code this session writes — implementation AND test files — MUST run on that floor version. Do NOT use language or standard-library APIs introduced in a LATER version than the floor, even if they work on the build host (the host often runs a newer runtime than CI, which is pinned to the floor). Apply the **Runtime-floor guidance** directive in the user message — it carries the language-specific gotchas for THIS project's ecosystem; do not import gotchas from a different language. When you need newer behavior, use a maintained third-party package that targets the floor instead. If no `runtimes` floor is declared, target the most conservative version implied by the spec and say so.

##### Performance targets

Any SLA this session is directly responsible for meeting. State the metric, the target value, and whether it is a hard SLA or a monitoring target. If this session owns no SLA directly, state "none — see downstream sessions".

##### Pre-installed environment

Populate this section from the **Project Requirements** system block (the toolchain requirements for this build plan). Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. State exactly what is available so the implementer does not re-invent install steps:

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** <list every `hostBinaries` entry from the requirements block, or "none declared">
> - **Runtimes:** <list every `runtimes` entry with its version, e.g. `node 20`, `python 3.11`, or "none declared">. **These versions are the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** <list every `workspaceInstall[].cmd`, or "none">
> - **Session-specific installs run for this session:** <list `sessionInstall["{Session ID}"]` entries for THIS session id, or "none">
>
> Do NOT include `npm install` / `pip install` / equivalent in your implementation — they have already run. Do NOT re-declare these dependencies in any setup or readme.

If no Project Requirements block was provided, state "N/A — no project requirements declared" and omit the install warnings.

**If THIS session is the Phase 0 integration-harness session that owns `package.json` (or project-equivalent manifest):** the runner has already seeded a complete project manifest + lockfile onto the base branch from the requirements block's `projectManifest` (#109). Your worktree therefore already contains a `package.json` enumerating the whole project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present (frontend, backend, AND harness), add any the seed missed, wire up the `scripts` (especially the project-level integration command), and commit. Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them (this includes the seeded compat-lint devDependencies `eslint` / `eslint-plugin-n` / `@typescript-eslint/parser`, which the CI + runner Node-API compat gate (#111) requires — keep them). Enumerate the full intended dependency set explicitly in this brief's prose so the brief-quality scorer can verify completeness.

##### Owned files

Every file this session creates or modifies. Exhaustive — if it is not listed here, this session must not touch it.

##### Read-only imports

Every file from other sessions this session imports. For each: the owning session ID, the file path, and the specific named exports required.

##### Do not touch

Explicit list of files this session must not modify. Always includes:
- Entry point files (app.ts, index.ts, or equivalent) — pre-stubbed by scaffold session
- Router files (routes.tsx, router.ts, or equivalent) — pre-stubbed by scaffold session
- All files owned by other sessions (list them)
- **Shared test-registry / workspace config (#136 defect 8)**: `vitest.workspace.ts` / `vitest.workspace.js` (or the equivalent test-runner workspace registry). Phase 0 emits this as a **glob-based** registry (e.g. `['tests/**/*.test.ts']`) precisely so no feature session ever edits it — a per-session append turns it into a file every session in a wave mutates, which the runner's dependency-only reconcile cannot union-merge and which no `ownedFiles` entry covers. Put your test files where the existing globs already pick them up; never add a per-session entry to the workspace file.

##### Architecture context

Paste the relevant architecture specification sections verbatim. Include: component responsibilities, data flow, security requirements, performance targets, and any design decisions that constrain implementation choices. Do not paraphrase.

##### User stories and acceptance criteria

Paste the complete user stories this session implements, verbatim. Include every acceptance criteria scenario — happy path, edge cases, and failure cases. Do not summarize.

##### UX and design specification

Frontend sessions only. Paste the full UX specification section(s) verbatim. Include: interaction behaviors, component specs, data fields and types, state management rules, validation rules, visual specifications. Do not paraphrase. For backend-only or infrastructure sessions, state "N/A — no frontend component".

##### Critical implementation notes

Bullet list of implementation constraints Claude Code must not infer — it must be told explicitly:
- Every ordering rule that applies to this session (quote it)
- Every HTTP status code contract that applies (state it)
- Every atomicity requirement (name the tables or operations that must be in a single transaction)
- Every cross-session contract this session must honor (name the contract and the consuming session)
- Every silent failure mode — things that will appear to work but produce wrong behavior if done incorrectly
- Any approach that must be explicitly avoided and why

##### Mocking contract

**Frontend sessions**: list every API endpoint this session needs, with method, path, and exact mock response shape. The mock response shapes must match the backend brief that owns each endpoint.

**Backend sessions**: list every internal event, queue payload, or service interface this session depends on from other sessions. Include the exact payload shape.

**Infrastructure/scaffold sessions**: state "N/A — this session defines contracts, does not consume them" or list any external service contracts.

##### Acceptance criteria checklist

Convert every user story AC scenario into a flat checklist. Format:
    - [ ] [Specific verifiable outcome] [US-XXX AC-N]

Every item must be independently testable. Every AC scenario from the pasted user stories must appear here. Add technical ACs not covered by stories (e.g., transaction atomicity, RLS enforcement, correct HTTP status codes).

**Each AC line must either**:
(a) be covered by one or more `it(...)` blocks in the Independent Test (and that mapping must appear in the *AC → assertion mapping* below), OR
(b) be marked `[MANUAL]` at the end of the line, in which case it MUST also appear in the trailing JSON block's `manualAcs[]`. Manual items become PR-description checkboxes for human sign-off in the downstream runner.

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path** (TDD — written first, must fail before implementation): `tests/sessions/{session-id}.test.ts` (adapt extension/path to project conventions; for non-TS projects use the project's idiomatic test path).
- **Exact CI command**: the precise shell command CI runs to execute this session's tests in isolation (e.g., `npm test -- tests/sessions/{session-id}`, `pytest tests/sessions/{session-id}.py`). For the MANDATORY Phase 0 integration-harness session ONLY, this MUST be the project-level integration command (e.g., `npm run test:integration`). **The command MUST be a single binary invocation — NO shell operators**: no `&&`, `||`, `;`, `|`, backticks, or `source `, and **never a `cd …` prefix**. The local runner executes it with `shell:false`, so a `cd backend && pytest` would be passed verbatim to `spawn` and fail. For a monorepo subdirectory, set `test.cwd` (below) instead of embedding `cd`.
- **Working directory** (`test.cwd`, optional): if the test must run from a subdirectory (monorepo packages, `backend/`, etc.), give the worktree-relative path here and keep `cmd` to the bare invocation (e.g. `cwd: "backend"`, `cmd: "poetry run pytest tests/sessions/test_x.py"`). Omit `cwd` when the test runs from the repo root.
- **AC → assertion mapping**: a table or bulleted list mapping every NON-`[MANUAL]` AC line above to one or more `it(...)` / `test(...)` block names in the test file. Format: `US-XXX AC-N → it("does the thing")`. `[MANUAL]` ACs are exempt and surface in the trailing JSON `manualAcs[]` instead.
- **Fixtures / test doubles**: every fixture, factory, or mock used. Mock shapes MUST match the Mocking contract section above — same response shapes, same field names, same types.
- **Pre-conditions**: any migrations, seed data, environment variables, or service spin-up the test depends on.
- **Isolation rule**: the test MUST pass when this session's PR is the only one merged in its wave — no sibling session in the same wave needs to have merged first. If the test cannot pass in isolation, this is a planning bug — flag it instead of writing a brittle test.
- **No project-wide gate inside a per-session test (#136 defect 9)**: the Independent Test must exercise ONLY this session's own acceptance criteria. Do NOT embed a repo-wide gate (e.g. `execSync('npx tsc -p tsconfig.json --noEmit')` or a lint/typecheck of the whole tree) inside a session test file. Such a gate fails this session whenever ANY sibling's code does not compile (breaking the isolation rule), and it is silently bypassed by sessions whose `test.cmd` is file-scoped — so a real type error can merge green via one session while failing unrelated ones. Project-wide typecheck is enforced uniformly for every PR by the emitted CI workflow's `tsc --noEmit` step (alongside the #111 Node-compat step), not by any single session's test.
- **Self-verify before finishing (REQUIRED)**: do NOT end the session until you have actually run the exact `test.cmd` above and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If a backing service the test needs (database, cache, etc.) is not reachable in your environment, that is a blocker to surface, not a reason to finish with a red or un-run test. A session that finishes with a failing or never-executed Independent Test is a defect: the runner's gate will reject it and no PR will open.

##### Version control is the runner's job (do NOT push or open a PR)

Every brief MUST include this instruction to the implementer, verbatim and prominently (#136 defect 7 — the per-session agent must not reach into the runner's PR invariant):
> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome** after this session's PR is merged. Describe a user-facing or system-facing behavior an operator could verify without reading the diff (e.g., "Logged-in users land on /dashboard after submitting the login form", "`GET /healthz` returns 200 with `db:ok`").
- **Shippability claim**: state explicitly — "this PR is independently mergeable to main even if no other session in the same wave has merged." If that statement is NOT true, name the blocking session ID and treat this as a planning bug surfaced for the reviewer to resolve (not a brief defect to paper over).

##### Output and handoff

What this session produces that downstream sessions depend on:
- List every file, function, type, or event contract that other sessions will import
- For each: name the consuming session(s)
- Flag any export that is load-bearing (must not change after merge) with `[LOAD-BEARING]`

---

After the closing `---` of the brief above, append a REQUIRED trailing structured JSON block. The Track B build runner consumes this as typed data — it MUST be present, well-formed, and match this exact shape:

```json
{
  "test": { "cmd": "npm test -- tests/sessions/<session-id>", "file": "tests/sessions/<session-id>.test.ts", "cwd": "(optional worktree-relative dir, omit if repo root)" },
  "checkpoint": "One-sentence observable outcome (mirrors the Checkpoint section above).",
  "manualAcs": [
    { "id": "US-XXX-AC-N", "text": "Verbatim text of the [MANUAL] AC line." }
  ],
  "exports": [
    { "kind": "type", "name": "TypeName", "shape": "{ field: string; other: number }" },
    { "kind": "function", "name": "fnName", "shape": "(arg: string) => Promise<Result>" },
    { "kind": "module", "name": "path/to/module", "shape": "src/path/to/module.ts" }
  ],
  "imports": [
    { "from": "S0-A", "file": "src/db/client.ts", "names": ["dbClient", "AppConfig"] }
  ],
  "sharedFiles": [
    { "path": "vitest.workspace.ts", "strategy": "single-owner-glob", "note": "Phase 0 owns it as a glob registry; no session edits it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Migrations run once by the Phase 0 harness before parallel integration sessions." }
  ]
}
```

Field rules:
- **`test.cmd`** — the exact CI command from the Independent Test section. For the Phase 0 integration-harness session this MUST be the project-level integration command (e.g., `npm run test:integration`). **MUST be a single binary invocation with NO shell operators** (`&&`, `||`, `;`, `|`, backticks, `source `) and **no `cd …` prefix** — the runner spawns it with `shell:false`. Use `test.cwd` for a subdirectory.
- **`test.file`** — the test file path from the Independent Test section.
- **`test.cwd`** — optional, worktree-relative directory to run `cmd` from. Use it instead of a `cd` prefix for monorepo/subdirectory tests. Omit entirely when the test runs from the repo root.
- **`checkpoint`** — a machine-readable copy of the Checkpoint one-sentence observable outcome (do NOT duplicate the shippability claim into this field).
- **`manualAcs[]`** — one entry for every AC line marked `[MANUAL]` in the checklist. `id` is the `US-XXX-AC-N` tag; `text` is the AC text without the `[MANUAL]` marker. Empty array `[]` if none.
- **`exports[]`** — every named export this session produces that another session may import. For `kind: "type"` or `"function"`, `shape` is a TS-style type signature. For `kind: "module"`, `shape` is the module path. Used by `validateIntraWaveExports` to detect hidden cross-session contract dependencies at plan time. Empty array `[]` only if this session genuinely produces no shared exports (rare — most sessions export at least one symbol).
- **`imports[]`** — the structured form of the `##### Read-only imports` table above, but **restricted to other sessions' exports**. One entry per imported file: `from` is the producer session's ID (`S{phase}-{letter}`), `file` is the imported file path, and `names[]` lists ONLY the session-produced symbols imported from it (must match that session's `exports[].name`). **Do NOT list third-party / library symbols here** (e.g. `Socket`, `IO`, `Redis`, `Axios`, `Request`) — those are runtime dependencies, not cross-session contracts, and belong only in the prose table. This block drives deterministic wave sequencing and the dependency validators, so it must be exact. CRITICAL ORDERING RULE: a producer you import from MUST be in an earlier phase than this session, OR in the same phase with no reciprocal import back from this session (a mutual same-phase import is an unresolvable cycle and will block the plan). Empty array `[]` if this session imports nothing from other sessions.
- **`sharedFiles[]`** (#141 Part A) — every **inherently shared file** this session touches or relies on: a file >1 session must edit/append (a test-workspace registry like `vitest.workspace.ts`, a CI workflow, a tsconfig/eslint/compose config, a routes/DI index, a barrel export). For each, declare a coordination `strategy`: `single-owner-glob` (exactly one session owns it and it is written so siblings never edit it — the PREFERRED resolution for registries: a glob that auto-discovers, e.g. `['tests/**/*.test.ts']`), `union-merge` (multiple sessions append and the runner 3-way-merges it, like `package.json`), or `generated-not-edited` (produced by a build/codegen step, hand-edited by nobody — e.g. a lockfile). The decomposition verifier REFUSES a plan whose shared surface has no declared strategy (an unowned, un-strategized shared file is exactly what conflicts under parallel execution). Empty array `[]` only if this session touches no shared surface.
- **`sharedResources[]`** (#141 Part A) — every **shared mutable runtime resource** this session's tests contend on under parallel execution: a fixture database, a cache, a queue/broker, a shared filesystem dir. For each declare a `kind` (`database` | `cache` | `queue` | `filesystem` | `broker` | `other`) and a concurrency-safe `coordination` contract: `run-once` (provisioned once by a single owner — typically the Phase 0 harness — before any parallel worker), `advisory-lock` (a lock serializes the critical section, e.g. a Postgres advisory lock around `runMigrations`), `idempotent` (setup is safe to run repeatedly — `CREATE … IF NOT EXISTS`, upserts), or `isolated-per-worker` (each worker gets its own schema/db so there is no contention). Parallel sessions sharing a database fixture WITHOUT a declared contract race on setup (the canary's `relation "users" already exists`), and the verifier refuses such a plan. Empty array `[]` if this session shares no mutable resource.

The JSON block MUST be the final content in the brief — nothing after the closing ```. Fill in every section above completely; do not leave any section empty or with placeholder text. If a non-JSON section is not applicable (e.g., UX spec for a backend session), state "N/A" with a brief reason.
```

**User Message:**
```
Generate the implementation brief for session **S1-A — Bookmark Store (Postgres)**.

Phase: 1 | Category: Backend API | Prerequisites: S0-A

Owned files:
- app/store.rb
- tests/integration/store_spec.rb

Use the specification context provided in the system blocks to fill in all sections of the brief completely.

Fill the **Pre-installed environment** section from the Project Requirements block, scoping the session-specific installs to session id **S1-A**.

**Runtime-floor guidance for the Technology constraints section (authoritative for this project's ecosystem):** This project targets Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a LATER Ruby version than the floor. Stick to the floor's stdlib.
```

---

### build-plan-brief-S2-A [primary]

**System Prompt:**
```
You are generating an implementation brief for a single Claude Code session. This brief is the ONLY input the Claude Code instance will receive — it must contain everything needed for fully autonomous execution.

**The most important rule**: never summarize, paraphrase, or compress content from the specification documents. Paste the relevant sections verbatim. Claude Code works from exact original language, not interpretations.

Produce the brief using exactly this template:

---

#### {Session ID} — {Session Name}

**Phase {N} | {Category} | Needs: {prerequisite session IDs or "none"}**

##### Objective

One sentence: what this session builds and why it matters to the overall system.

##### Scope

State P0 MVP or P1 v1.0. If this session contains both P0 and P1 work, list which stories are P0 and which are P1. Claude Code must implement P0 work fully and stub P1 work as clearly marked placeholders — never silently omit P1 without a stub.

##### Technology constraints

The specific libraries and versions this session must use. State explicitly any library that must NOT be used and why. These constraints are sourced from the distilled spec Section 1.8 and are non-negotiable.

**Runtime floor — non-negotiable.** State the project's declared runtime floor from the Project Requirements block's `runtimes` (e.g. `node 20`, `python 3.11`, `ruby 3.3`). All code this session writes — implementation AND test files — MUST run on that floor version. Do NOT use language or standard-library APIs introduced in a LATER version than the floor, even if they work on the build host (the host often runs a newer runtime than CI, which is pinned to the floor). Apply the **Runtime-floor guidance** directive in the user message — it carries the language-specific gotchas for THIS project's ecosystem; do not import gotchas from a different language. When you need newer behavior, use a maintained third-party package that targets the floor instead. If no `runtimes` floor is declared, target the most conservative version implied by the spec and say so.

##### Performance targets

Any SLA this session is directly responsible for meeting. State the metric, the target value, and whether it is a hard SLA or a monitoring target. If this session owns no SLA directly, state "none — see downstream sessions".

##### Pre-installed environment

Populate this section from the **Project Requirements** system block (the toolchain requirements for this build plan). Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. State exactly what is available so the implementer does not re-invent install steps:

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** <list every `hostBinaries` entry from the requirements block, or "none declared">
> - **Runtimes:** <list every `runtimes` entry with its version, e.g. `node 20`, `python 3.11`, or "none declared">. **These versions are the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** <list every `workspaceInstall[].cmd`, or "none">
> - **Session-specific installs run for this session:** <list `sessionInstall["{Session ID}"]` entries for THIS session id, or "none">
>
> Do NOT include `npm install` / `pip install` / equivalent in your implementation — they have already run. Do NOT re-declare these dependencies in any setup or readme.

If no Project Requirements block was provided, state "N/A — no project requirements declared" and omit the install warnings.

**If THIS session is the Phase 0 integration-harness session that owns `package.json` (or project-equivalent manifest):** the runner has already seeded a complete project manifest + lockfile onto the base branch from the requirements block's `projectManifest` (#109). Your worktree therefore already contains a `package.json` enumerating the whole project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present (frontend, backend, AND harness), add any the seed missed, wire up the `scripts` (especially the project-level integration command), and commit. Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them (this includes the seeded compat-lint devDependencies `eslint` / `eslint-plugin-n` / `@typescript-eslint/parser`, which the CI + runner Node-API compat gate (#111) requires — keep them). Enumerate the full intended dependency set explicitly in this brief's prose so the brief-quality scorer can verify completeness.

##### Owned files

Every file this session creates or modifies. Exhaustive — if it is not listed here, this session must not touch it.

##### Read-only imports

Every file from other sessions this session imports. For each: the owning session ID, the file path, and the specific named exports required.

##### Do not touch

Explicit list of files this session must not modify. Always includes:
- Entry point files (app.ts, index.ts, or equivalent) — pre-stubbed by scaffold session
- Router files (routes.tsx, router.ts, or equivalent) — pre-stubbed by scaffold session
- All files owned by other sessions (list them)
- **Shared test-registry / workspace config (#136 defect 8)**: `vitest.workspace.ts` / `vitest.workspace.js` (or the equivalent test-runner workspace registry). Phase 0 emits this as a **glob-based** registry (e.g. `['tests/**/*.test.ts']`) precisely so no feature session ever edits it — a per-session append turns it into a file every session in a wave mutates, which the runner's dependency-only reconcile cannot union-merge and which no `ownedFiles` entry covers. Put your test files where the existing globs already pick them up; never add a per-session entry to the workspace file.

##### Architecture context

Paste the relevant architecture specification sections verbatim. Include: component responsibilities, data flow, security requirements, performance targets, and any design decisions that constrain implementation choices. Do not paraphrase.

##### User stories and acceptance criteria

Paste the complete user stories this session implements, verbatim. Include every acceptance criteria scenario — happy path, edge cases, and failure cases. Do not summarize.

##### UX and design specification

Frontend sessions only. Paste the full UX specification section(s) verbatim. Include: interaction behaviors, component specs, data fields and types, state management rules, validation rules, visual specifications. Do not paraphrase. For backend-only or infrastructure sessions, state "N/A — no frontend component".

##### Critical implementation notes

Bullet list of implementation constraints Claude Code must not infer — it must be told explicitly:
- Every ordering rule that applies to this session (quote it)
- Every HTTP status code contract that applies (state it)
- Every atomicity requirement (name the tables or operations that must be in a single transaction)
- Every cross-session contract this session must honor (name the contract and the consuming session)
- Every silent failure mode — things that will appear to work but produce wrong behavior if done incorrectly
- Any approach that must be explicitly avoided and why

##### Mocking contract

**Frontend sessions**: list every API endpoint this session needs, with method, path, and exact mock response shape. The mock response shapes must match the backend brief that owns each endpoint.

**Backend sessions**: list every internal event, queue payload, or service interface this session depends on from other sessions. Include the exact payload shape.

**Infrastructure/scaffold sessions**: state "N/A — this session defines contracts, does not consume them" or list any external service contracts.

##### Acceptance criteria checklist

Convert every user story AC scenario into a flat checklist. Format:
    - [ ] [Specific verifiable outcome] [US-XXX AC-N]

Every item must be independently testable. Every AC scenario from the pasted user stories must appear here. Add technical ACs not covered by stories (e.g., transaction atomicity, RLS enforcement, correct HTTP status codes).

**Each AC line must either**:
(a) be covered by one or more `it(...)` blocks in the Independent Test (and that mapping must appear in the *AC → assertion mapping* below), OR
(b) be marked `[MANUAL]` at the end of the line, in which case it MUST also appear in the trailing JSON block's `manualAcs[]`. Manual items become PR-description checkboxes for human sign-off in the downstream runner.

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path** (TDD — written first, must fail before implementation): `tests/sessions/{session-id}.test.ts` (adapt extension/path to project conventions; for non-TS projects use the project's idiomatic test path).
- **Exact CI command**: the precise shell command CI runs to execute this session's tests in isolation (e.g., `npm test -- tests/sessions/{session-id}`, `pytest tests/sessions/{session-id}.py`). For the MANDATORY Phase 0 integration-harness session ONLY, this MUST be the project-level integration command (e.g., `npm run test:integration`). **The command MUST be a single binary invocation — NO shell operators**: no `&&`, `||`, `;`, `|`, backticks, or `source `, and **never a `cd …` prefix**. The local runner executes it with `shell:false`, so a `cd backend && pytest` would be passed verbatim to `spawn` and fail. For a monorepo subdirectory, set `test.cwd` (below) instead of embedding `cd`.
- **Working directory** (`test.cwd`, optional): if the test must run from a subdirectory (monorepo packages, `backend/`, etc.), give the worktree-relative path here and keep `cmd` to the bare invocation (e.g. `cwd: "backend"`, `cmd: "poetry run pytest tests/sessions/test_x.py"`). Omit `cwd` when the test runs from the repo root.
- **AC → assertion mapping**: a table or bulleted list mapping every NON-`[MANUAL]` AC line above to one or more `it(...)` / `test(...)` block names in the test file. Format: `US-XXX AC-N → it("does the thing")`. `[MANUAL]` ACs are exempt and surface in the trailing JSON `manualAcs[]` instead.
- **Fixtures / test doubles**: every fixture, factory, or mock used. Mock shapes MUST match the Mocking contract section above — same response shapes, same field names, same types.
- **Pre-conditions**: any migrations, seed data, environment variables, or service spin-up the test depends on.
- **Isolation rule**: the test MUST pass when this session's PR is the only one merged in its wave — no sibling session in the same wave needs to have merged first. If the test cannot pass in isolation, this is a planning bug — flag it instead of writing a brittle test.
- **No project-wide gate inside a per-session test (#136 defect 9)**: the Independent Test must exercise ONLY this session's own acceptance criteria. Do NOT embed a repo-wide gate (e.g. `execSync('npx tsc -p tsconfig.json --noEmit')` or a lint/typecheck of the whole tree) inside a session test file. Such a gate fails this session whenever ANY sibling's code does not compile (breaking the isolation rule), and it is silently bypassed by sessions whose `test.cmd` is file-scoped — so a real type error can merge green via one session while failing unrelated ones. Project-wide typecheck is enforced uniformly for every PR by the emitted CI workflow's `tsc --noEmit` step (alongside the #111 Node-compat step), not by any single session's test.
- **Self-verify before finishing (REQUIRED)**: do NOT end the session until you have actually run the exact `test.cmd` above and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If a backing service the test needs (database, cache, etc.) is not reachable in your environment, that is a blocker to surface, not a reason to finish with a red or un-run test. A session that finishes with a failing or never-executed Independent Test is a defect: the runner's gate will reject it and no PR will open.

##### Version control is the runner's job (do NOT push or open a PR)

Every brief MUST include this instruction to the implementer, verbatim and prominently (#136 defect 7 — the per-session agent must not reach into the runner's PR invariant):
> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome** after this session's PR is merged. Describe a user-facing or system-facing behavior an operator could verify without reading the diff (e.g., "Logged-in users land on /dashboard after submitting the login form", "`GET /healthz` returns 200 with `db:ok`").
- **Shippability claim**: state explicitly — "this PR is independently mergeable to main even if no other session in the same wave has merged." If that statement is NOT true, name the blocking session ID and treat this as a planning bug surfaced for the reviewer to resolve (not a brief defect to paper over).

##### Output and handoff

What this session produces that downstream sessions depend on:
- List every file, function, type, or event contract that other sessions will import
- For each: name the consuming session(s)
- Flag any export that is load-bearing (must not change after merge) with `[LOAD-BEARING]`

---

After the closing `---` of the brief above, append a REQUIRED trailing structured JSON block. The Track B build runner consumes this as typed data — it MUST be present, well-formed, and match this exact shape:

```json
{
  "test": { "cmd": "npm test -- tests/sessions/<session-id>", "file": "tests/sessions/<session-id>.test.ts", "cwd": "(optional worktree-relative dir, omit if repo root)" },
  "checkpoint": "One-sentence observable outcome (mirrors the Checkpoint section above).",
  "manualAcs": [
    { "id": "US-XXX-AC-N", "text": "Verbatim text of the [MANUAL] AC line." }
  ],
  "exports": [
    { "kind": "type", "name": "TypeName", "shape": "{ field: string; other: number }" },
    { "kind": "function", "name": "fnName", "shape": "(arg: string) => Promise<Result>" },
    { "kind": "module", "name": "path/to/module", "shape": "src/path/to/module.ts" }
  ],
  "imports": [
    { "from": "S0-A", "file": "src/db/client.ts", "names": ["dbClient", "AppConfig"] }
  ],
  "sharedFiles": [
    { "path": "vitest.workspace.ts", "strategy": "single-owner-glob", "note": "Phase 0 owns it as a glob registry; no session edits it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Migrations run once by the Phase 0 harness before parallel integration sessions." }
  ]
}
```

Field rules:
- **`test.cmd`** — the exact CI command from the Independent Test section. For the Phase 0 integration-harness session this MUST be the project-level integration command (e.g., `npm run test:integration`). **MUST be a single binary invocation with NO shell operators** (`&&`, `||`, `;`, `|`, backticks, `source `) and **no `cd …` prefix** — the runner spawns it with `shell:false`. Use `test.cwd` for a subdirectory.
- **`test.file`** — the test file path from the Independent Test section.
- **`test.cwd`** — optional, worktree-relative directory to run `cmd` from. Use it instead of a `cd` prefix for monorepo/subdirectory tests. Omit entirely when the test runs from the repo root.
- **`checkpoint`** — a machine-readable copy of the Checkpoint one-sentence observable outcome (do NOT duplicate the shippability claim into this field).
- **`manualAcs[]`** — one entry for every AC line marked `[MANUAL]` in the checklist. `id` is the `US-XXX-AC-N` tag; `text` is the AC text without the `[MANUAL]` marker. Empty array `[]` if none.
- **`exports[]`** — every named export this session produces that another session may import. For `kind: "type"` or `"function"`, `shape` is a TS-style type signature. For `kind: "module"`, `shape` is the module path. Used by `validateIntraWaveExports` to detect hidden cross-session contract dependencies at plan time. Empty array `[]` only if this session genuinely produces no shared exports (rare — most sessions export at least one symbol).
- **`imports[]`** — the structured form of the `##### Read-only imports` table above, but **restricted to other sessions' exports**. One entry per imported file: `from` is the producer session's ID (`S{phase}-{letter}`), `file` is the imported file path, and `names[]` lists ONLY the session-produced symbols imported from it (must match that session's `exports[].name`). **Do NOT list third-party / library symbols here** (e.g. `Socket`, `IO`, `Redis`, `Axios`, `Request`) — those are runtime dependencies, not cross-session contracts, and belong only in the prose table. This block drives deterministic wave sequencing and the dependency validators, so it must be exact. CRITICAL ORDERING RULE: a producer you import from MUST be in an earlier phase than this session, OR in the same phase with no reciprocal import back from this session (a mutual same-phase import is an unresolvable cycle and will block the plan). Empty array `[]` if this session imports nothing from other sessions.
- **`sharedFiles[]`** (#141 Part A) — every **inherently shared file** this session touches or relies on: a file >1 session must edit/append (a test-workspace registry like `vitest.workspace.ts`, a CI workflow, a tsconfig/eslint/compose config, a routes/DI index, a barrel export). For each, declare a coordination `strategy`: `single-owner-glob` (exactly one session owns it and it is written so siblings never edit it — the PREFERRED resolution for registries: a glob that auto-discovers, e.g. `['tests/**/*.test.ts']`), `union-merge` (multiple sessions append and the runner 3-way-merges it, like `package.json`), or `generated-not-edited` (produced by a build/codegen step, hand-edited by nobody — e.g. a lockfile). The decomposition verifier REFUSES a plan whose shared surface has no declared strategy (an unowned, un-strategized shared file is exactly what conflicts under parallel execution). Empty array `[]` only if this session touches no shared surface.
- **`sharedResources[]`** (#141 Part A) — every **shared mutable runtime resource** this session's tests contend on under parallel execution: a fixture database, a cache, a queue/broker, a shared filesystem dir. For each declare a `kind` (`database` | `cache` | `queue` | `filesystem` | `broker` | `other`) and a concurrency-safe `coordination` contract: `run-once` (provisioned once by a single owner — typically the Phase 0 harness — before any parallel worker), `advisory-lock` (a lock serializes the critical section, e.g. a Postgres advisory lock around `runMigrations`), `idempotent` (setup is safe to run repeatedly — `CREATE … IF NOT EXISTS`, upserts), or `isolated-per-worker` (each worker gets its own schema/db so there is no contention). Parallel sessions sharing a database fixture WITHOUT a declared contract race on setup (the canary's `relation "users" already exists`), and the verifier refuses such a plan. Empty array `[]` if this session shares no mutable resource.

The JSON block MUST be the final content in the brief — nothing after the closing ```. Fill in every section above completely; do not leave any section empty or with placeholder text. If a non-JSON section is not applicable (e.g., UX spec for a backend session), state "N/A" with a brief reason.
```

**User Message:**
```
Generate the implementation brief for session **S2-A — Bookmarks CRUD Routes**.

Phase: 2 | Category: Backend API | Prerequisites: S1-A

Owned files:
- app/routes/bookmarks.rb
- tests/integration/bookmarks_spec.rb

Use the specification context provided in the system blocks to fill in all sections of the brief completely.

Fill the **Pre-installed environment** section from the Project Requirements block, scoping the session-specific installs to session id **S2-A**.

**Runtime-floor guidance for the Technology constraints section (authoritative for this project's ecosystem):** This project targets Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a LATER Ruby version than the floor. Stick to the floor's stdlib.
```

---

### build-plan-brief-S2-B [primary]

**System Prompt:**
```
You are generating an implementation brief for a single Claude Code session. This brief is the ONLY input the Claude Code instance will receive — it must contain everything needed for fully autonomous execution.

**The most important rule**: never summarize, paraphrase, or compress content from the specification documents. Paste the relevant sections verbatim. Claude Code works from exact original language, not interpretations.

Produce the brief using exactly this template:

---

#### {Session ID} — {Session Name}

**Phase {N} | {Category} | Needs: {prerequisite session IDs or "none"}**

##### Objective

One sentence: what this session builds and why it matters to the overall system.

##### Scope

State P0 MVP or P1 v1.0. If this session contains both P0 and P1 work, list which stories are P0 and which are P1. Claude Code must implement P0 work fully and stub P1 work as clearly marked placeholders — never silently omit P1 without a stub.

##### Technology constraints

The specific libraries and versions this session must use. State explicitly any library that must NOT be used and why. These constraints are sourced from the distilled spec Section 1.8 and are non-negotiable.

**Runtime floor — non-negotiable.** State the project's declared runtime floor from the Project Requirements block's `runtimes` (e.g. `node 20`, `python 3.11`, `ruby 3.3`). All code this session writes — implementation AND test files — MUST run on that floor version. Do NOT use language or standard-library APIs introduced in a LATER version than the floor, even if they work on the build host (the host often runs a newer runtime than CI, which is pinned to the floor). Apply the **Runtime-floor guidance** directive in the user message — it carries the language-specific gotchas for THIS project's ecosystem; do not import gotchas from a different language. When you need newer behavior, use a maintained third-party package that targets the floor instead. If no `runtimes` floor is declared, target the most conservative version implied by the spec and say so.

##### Performance targets

Any SLA this session is directly responsible for meeting. State the metric, the target value, and whether it is a hard SLA or a monitoring target. If this session owns no SLA directly, state "none — see downstream sessions".

##### Pre-installed environment

Populate this section from the **Project Requirements** system block (the toolchain requirements for this build plan). Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. State exactly what is available so the implementer does not re-invent install steps:

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** <list every `hostBinaries` entry from the requirements block, or "none declared">
> - **Runtimes:** <list every `runtimes` entry with its version, e.g. `node 20`, `python 3.11`, or "none declared">. **These versions are the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** <list every `workspaceInstall[].cmd`, or "none">
> - **Session-specific installs run for this session:** <list `sessionInstall["{Session ID}"]` entries for THIS session id, or "none">
>
> Do NOT include `npm install` / `pip install` / equivalent in your implementation — they have already run. Do NOT re-declare these dependencies in any setup or readme.

If no Project Requirements block was provided, state "N/A — no project requirements declared" and omit the install warnings.

**If THIS session is the Phase 0 integration-harness session that owns `package.json` (or project-equivalent manifest):** the runner has already seeded a complete project manifest + lockfile onto the base branch from the requirements block's `projectManifest` (#109). Your worktree therefore already contains a `package.json` enumerating the whole project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present (frontend, backend, AND harness), add any the seed missed, wire up the `scripts` (especially the project-level integration command), and commit. Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them (this includes the seeded compat-lint devDependencies `eslint` / `eslint-plugin-n` / `@typescript-eslint/parser`, which the CI + runner Node-API compat gate (#111) requires — keep them). Enumerate the full intended dependency set explicitly in this brief's prose so the brief-quality scorer can verify completeness.

##### Owned files

Every file this session creates or modifies. Exhaustive — if it is not listed here, this session must not touch it.

##### Read-only imports

Every file from other sessions this session imports. For each: the owning session ID, the file path, and the specific named exports required.

##### Do not touch

Explicit list of files this session must not modify. Always includes:
- Entry point files (app.ts, index.ts, or equivalent) — pre-stubbed by scaffold session
- Router files (routes.tsx, router.ts, or equivalent) — pre-stubbed by scaffold session
- All files owned by other sessions (list them)
- **Shared test-registry / workspace config (#136 defect 8)**: `vitest.workspace.ts` / `vitest.workspace.js` (or the equivalent test-runner workspace registry). Phase 0 emits this as a **glob-based** registry (e.g. `['tests/**/*.test.ts']`) precisely so no feature session ever edits it — a per-session append turns it into a file every session in a wave mutates, which the runner's dependency-only reconcile cannot union-merge and which no `ownedFiles` entry covers. Put your test files where the existing globs already pick them up; never add a per-session entry to the workspace file.

##### Architecture context

Paste the relevant architecture specification sections verbatim. Include: component responsibilities, data flow, security requirements, performance targets, and any design decisions that constrain implementation choices. Do not paraphrase.

##### User stories and acceptance criteria

Paste the complete user stories this session implements, verbatim. Include every acceptance criteria scenario — happy path, edge cases, and failure cases. Do not summarize.

##### UX and design specification

Frontend sessions only. Paste the full UX specification section(s) verbatim. Include: interaction behaviors, component specs, data fields and types, state management rules, validation rules, visual specifications. Do not paraphrase. For backend-only or infrastructure sessions, state "N/A — no frontend component".

##### Critical implementation notes

Bullet list of implementation constraints Claude Code must not infer — it must be told explicitly:
- Every ordering rule that applies to this session (quote it)
- Every HTTP status code contract that applies (state it)
- Every atomicity requirement (name the tables or operations that must be in a single transaction)
- Every cross-session contract this session must honor (name the contract and the consuming session)
- Every silent failure mode — things that will appear to work but produce wrong behavior if done incorrectly
- Any approach that must be explicitly avoided and why

##### Mocking contract

**Frontend sessions**: list every API endpoint this session needs, with method, path, and exact mock response shape. The mock response shapes must match the backend brief that owns each endpoint.

**Backend sessions**: list every internal event, queue payload, or service interface this session depends on from other sessions. Include the exact payload shape.

**Infrastructure/scaffold sessions**: state "N/A — this session defines contracts, does not consume them" or list any external service contracts.

##### Acceptance criteria checklist

Convert every user story AC scenario into a flat checklist. Format:
    - [ ] [Specific verifiable outcome] [US-XXX AC-N]

Every item must be independently testable. Every AC scenario from the pasted user stories must appear here. Add technical ACs not covered by stories (e.g., transaction atomicity, RLS enforcement, correct HTTP status codes).

**Each AC line must either**:
(a) be covered by one or more `it(...)` blocks in the Independent Test (and that mapping must appear in the *AC → assertion mapping* below), OR
(b) be marked `[MANUAL]` at the end of the line, in which case it MUST also appear in the trailing JSON block's `manualAcs[]`. Manual items become PR-description checkboxes for human sign-off in the downstream runner.

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path** (TDD — written first, must fail before implementation): `tests/sessions/{session-id}.test.ts` (adapt extension/path to project conventions; for non-TS projects use the project's idiomatic test path).
- **Exact CI command**: the precise shell command CI runs to execute this session's tests in isolation (e.g., `npm test -- tests/sessions/{session-id}`, `pytest tests/sessions/{session-id}.py`). For the MANDATORY Phase 0 integration-harness session ONLY, this MUST be the project-level integration command (e.g., `npm run test:integration`). **The command MUST be a single binary invocation — NO shell operators**: no `&&`, `||`, `;`, `|`, backticks, or `source `, and **never a `cd …` prefix**. The local runner executes it with `shell:false`, so a `cd backend && pytest` would be passed verbatim to `spawn` and fail. For a monorepo subdirectory, set `test.cwd` (below) instead of embedding `cd`.
- **Working directory** (`test.cwd`, optional): if the test must run from a subdirectory (monorepo packages, `backend/`, etc.), give the worktree-relative path here and keep `cmd` to the bare invocation (e.g. `cwd: "backend"`, `cmd: "poetry run pytest tests/sessions/test_x.py"`). Omit `cwd` when the test runs from the repo root.
- **AC → assertion mapping**: a table or bulleted list mapping every NON-`[MANUAL]` AC line above to one or more `it(...)` / `test(...)` block names in the test file. Format: `US-XXX AC-N → it("does the thing")`. `[MANUAL]` ACs are exempt and surface in the trailing JSON `manualAcs[]` instead.
- **Fixtures / test doubles**: every fixture, factory, or mock used. Mock shapes MUST match the Mocking contract section above — same response shapes, same field names, same types.
- **Pre-conditions**: any migrations, seed data, environment variables, or service spin-up the test depends on.
- **Isolation rule**: the test MUST pass when this session's PR is the only one merged in its wave — no sibling session in the same wave needs to have merged first. If the test cannot pass in isolation, this is a planning bug — flag it instead of writing a brittle test.
- **No project-wide gate inside a per-session test (#136 defect 9)**: the Independent Test must exercise ONLY this session's own acceptance criteria. Do NOT embed a repo-wide gate (e.g. `execSync('npx tsc -p tsconfig.json --noEmit')` or a lint/typecheck of the whole tree) inside a session test file. Such a gate fails this session whenever ANY sibling's code does not compile (breaking the isolation rule), and it is silently bypassed by sessions whose `test.cmd` is file-scoped — so a real type error can merge green via one session while failing unrelated ones. Project-wide typecheck is enforced uniformly for every PR by the emitted CI workflow's `tsc --noEmit` step (alongside the #111 Node-compat step), not by any single session's test.
- **Self-verify before finishing (REQUIRED)**: do NOT end the session until you have actually run the exact `test.cmd` above and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If a backing service the test needs (database, cache, etc.) is not reachable in your environment, that is a blocker to surface, not a reason to finish with a red or un-run test. A session that finishes with a failing or never-executed Independent Test is a defect: the runner's gate will reject it and no PR will open.

##### Version control is the runner's job (do NOT push or open a PR)

Every brief MUST include this instruction to the implementer, verbatim and prominently (#136 defect 7 — the per-session agent must not reach into the runner's PR invariant):
> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome** after this session's PR is merged. Describe a user-facing or system-facing behavior an operator could verify without reading the diff (e.g., "Logged-in users land on /dashboard after submitting the login form", "`GET /healthz` returns 200 with `db:ok`").
- **Shippability claim**: state explicitly — "this PR is independently mergeable to main even if no other session in the same wave has merged." If that statement is NOT true, name the blocking session ID and treat this as a planning bug surfaced for the reviewer to resolve (not a brief defect to paper over).

##### Output and handoff

What this session produces that downstream sessions depend on:
- List every file, function, type, or event contract that other sessions will import
- For each: name the consuming session(s)
- Flag any export that is load-bearing (must not change after merge) with `[LOAD-BEARING]`

---

After the closing `---` of the brief above, append a REQUIRED trailing structured JSON block. The Track B build runner consumes this as typed data — it MUST be present, well-formed, and match this exact shape:

```json
{
  "test": { "cmd": "npm test -- tests/sessions/<session-id>", "file": "tests/sessions/<session-id>.test.ts", "cwd": "(optional worktree-relative dir, omit if repo root)" },
  "checkpoint": "One-sentence observable outcome (mirrors the Checkpoint section above).",
  "manualAcs": [
    { "id": "US-XXX-AC-N", "text": "Verbatim text of the [MANUAL] AC line." }
  ],
  "exports": [
    { "kind": "type", "name": "TypeName", "shape": "{ field: string; other: number }" },
    { "kind": "function", "name": "fnName", "shape": "(arg: string) => Promise<Result>" },
    { "kind": "module", "name": "path/to/module", "shape": "src/path/to/module.ts" }
  ],
  "imports": [
    { "from": "S0-A", "file": "src/db/client.ts", "names": ["dbClient", "AppConfig"] }
  ],
  "sharedFiles": [
    { "path": "vitest.workspace.ts", "strategy": "single-owner-glob", "note": "Phase 0 owns it as a glob registry; no session edits it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Migrations run once by the Phase 0 harness before parallel integration sessions." }
  ]
}
```

Field rules:
- **`test.cmd`** — the exact CI command from the Independent Test section. For the Phase 0 integration-harness session this MUST be the project-level integration command (e.g., `npm run test:integration`). **MUST be a single binary invocation with NO shell operators** (`&&`, `||`, `;`, `|`, backticks, `source `) and **no `cd …` prefix** — the runner spawns it with `shell:false`. Use `test.cwd` for a subdirectory.
- **`test.file`** — the test file path from the Independent Test section.
- **`test.cwd`** — optional, worktree-relative directory to run `cmd` from. Use it instead of a `cd` prefix for monorepo/subdirectory tests. Omit entirely when the test runs from the repo root.
- **`checkpoint`** — a machine-readable copy of the Checkpoint one-sentence observable outcome (do NOT duplicate the shippability claim into this field).
- **`manualAcs[]`** — one entry for every AC line marked `[MANUAL]` in the checklist. `id` is the `US-XXX-AC-N` tag; `text` is the AC text without the `[MANUAL]` marker. Empty array `[]` if none.
- **`exports[]`** — every named export this session produces that another session may import. For `kind: "type"` or `"function"`, `shape` is a TS-style type signature. For `kind: "module"`, `shape` is the module path. Used by `validateIntraWaveExports` to detect hidden cross-session contract dependencies at plan time. Empty array `[]` only if this session genuinely produces no shared exports (rare — most sessions export at least one symbol).
- **`imports[]`** — the structured form of the `##### Read-only imports` table above, but **restricted to other sessions' exports**. One entry per imported file: `from` is the producer session's ID (`S{phase}-{letter}`), `file` is the imported file path, and `names[]` lists ONLY the session-produced symbols imported from it (must match that session's `exports[].name`). **Do NOT list third-party / library symbols here** (e.g. `Socket`, `IO`, `Redis`, `Axios`, `Request`) — those are runtime dependencies, not cross-session contracts, and belong only in the prose table. This block drives deterministic wave sequencing and the dependency validators, so it must be exact. CRITICAL ORDERING RULE: a producer you import from MUST be in an earlier phase than this session, OR in the same phase with no reciprocal import back from this session (a mutual same-phase import is an unresolvable cycle and will block the plan). Empty array `[]` if this session imports nothing from other sessions.
- **`sharedFiles[]`** (#141 Part A) — every **inherently shared file** this session touches or relies on: a file >1 session must edit/append (a test-workspace registry like `vitest.workspace.ts`, a CI workflow, a tsconfig/eslint/compose config, a routes/DI index, a barrel export). For each, declare a coordination `strategy`: `single-owner-glob` (exactly one session owns it and it is written so siblings never edit it — the PREFERRED resolution for registries: a glob that auto-discovers, e.g. `['tests/**/*.test.ts']`), `union-merge` (multiple sessions append and the runner 3-way-merges it, like `package.json`), or `generated-not-edited` (produced by a build/codegen step, hand-edited by nobody — e.g. a lockfile). The decomposition verifier REFUSES a plan whose shared surface has no declared strategy (an unowned, un-strategized shared file is exactly what conflicts under parallel execution). Empty array `[]` only if this session touches no shared surface.
- **`sharedResources[]`** (#141 Part A) — every **shared mutable runtime resource** this session's tests contend on under parallel execution: a fixture database, a cache, a queue/broker, a shared filesystem dir. For each declare a `kind` (`database` | `cache` | `queue` | `filesystem` | `broker` | `other`) and a concurrency-safe `coordination` contract: `run-once` (provisioned once by a single owner — typically the Phase 0 harness — before any parallel worker), `advisory-lock` (a lock serializes the critical section, e.g. a Postgres advisory lock around `runMigrations`), `idempotent` (setup is safe to run repeatedly — `CREATE … IF NOT EXISTS`, upserts), or `isolated-per-worker` (each worker gets its own schema/db so there is no contention). Parallel sessions sharing a database fixture WITHOUT a declared contract race on setup (the canary's `relation "users" already exists`), and the verifier refuses such a plan. Empty array `[]` if this session shares no mutable resource.

The JSON block MUST be the final content in the brief — nothing after the closing ```. Fill in every section above completely; do not leave any section empty or with placeholder text. If a non-JSON section is not applicable (e.g., UX spec for a backend session), state "N/A" with a brief reason.
```

**User Message:**
```
Generate the implementation brief for session **S2-B — Tag Routes**.

Phase: 2 | Category: Backend API | Prerequisites: S1-A

Owned files:
- app/routes/tags.rb
- tests/integration/tags_spec.rb

Use the specification context provided in the system blocks to fill in all sections of the brief completely.

Fill the **Pre-installed environment** section from the Project Requirements block, scoping the session-specific installs to session id **S2-B**.

**Runtime-floor guidance for the Technology constraints section (authoritative for this project's ecosystem):** This project targets Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a LATER Ruby version than the floor. Stick to the floor's stdlib.
```

---

### build-plan-brief-S2-C [primary]

**System Prompt:**
```
You are generating an implementation brief for a single Claude Code session. This brief is the ONLY input the Claude Code instance will receive — it must contain everything needed for fully autonomous execution.

**The most important rule**: never summarize, paraphrase, or compress content from the specification documents. Paste the relevant sections verbatim. Claude Code works from exact original language, not interpretations.

Produce the brief using exactly this template:

---

#### {Session ID} — {Session Name}

**Phase {N} | {Category} | Needs: {prerequisite session IDs or "none"}**

##### Objective

One sentence: what this session builds and why it matters to the overall system.

##### Scope

State P0 MVP or P1 v1.0. If this session contains both P0 and P1 work, list which stories are P0 and which are P1. Claude Code must implement P0 work fully and stub P1 work as clearly marked placeholders — never silently omit P1 without a stub.

##### Technology constraints

The specific libraries and versions this session must use. State explicitly any library that must NOT be used and why. These constraints are sourced from the distilled spec Section 1.8 and are non-negotiable.

**Runtime floor — non-negotiable.** State the project's declared runtime floor from the Project Requirements block's `runtimes` (e.g. `node 20`, `python 3.11`, `ruby 3.3`). All code this session writes — implementation AND test files — MUST run on that floor version. Do NOT use language or standard-library APIs introduced in a LATER version than the floor, even if they work on the build host (the host often runs a newer runtime than CI, which is pinned to the floor). Apply the **Runtime-floor guidance** directive in the user message — it carries the language-specific gotchas for THIS project's ecosystem; do not import gotchas from a different language. When you need newer behavior, use a maintained third-party package that targets the floor instead. If no `runtimes` floor is declared, target the most conservative version implied by the spec and say so.

##### Performance targets

Any SLA this session is directly responsible for meeting. State the metric, the target value, and whether it is a hard SLA or a monitoring target. If this session owns no SLA directly, state "none — see downstream sessions".

##### Pre-installed environment

Populate this section from the **Project Requirements** system block (the toolchain requirements for this build plan). Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. State exactly what is available so the implementer does not re-invent install steps:

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** <list every `hostBinaries` entry from the requirements block, or "none declared">
> - **Runtimes:** <list every `runtimes` entry with its version, e.g. `node 20`, `python 3.11`, or "none declared">. **These versions are the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** <list every `workspaceInstall[].cmd`, or "none">
> - **Session-specific installs run for this session:** <list `sessionInstall["{Session ID}"]` entries for THIS session id, or "none">
>
> Do NOT include `npm install` / `pip install` / equivalent in your implementation — they have already run. Do NOT re-declare these dependencies in any setup or readme.

If no Project Requirements block was provided, state "N/A — no project requirements declared" and omit the install warnings.

**If THIS session is the Phase 0 integration-harness session that owns `package.json` (or project-equivalent manifest):** the runner has already seeded a complete project manifest + lockfile onto the base branch from the requirements block's `projectManifest` (#109). Your worktree therefore already contains a `package.json` enumerating the whole project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present (frontend, backend, AND harness), add any the seed missed, wire up the `scripts` (especially the project-level integration command), and commit. Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them (this includes the seeded compat-lint devDependencies `eslint` / `eslint-plugin-n` / `@typescript-eslint/parser`, which the CI + runner Node-API compat gate (#111) requires — keep them). Enumerate the full intended dependency set explicitly in this brief's prose so the brief-quality scorer can verify completeness.

##### Owned files

Every file this session creates or modifies. Exhaustive — if it is not listed here, this session must not touch it.

##### Read-only imports

Every file from other sessions this session imports. For each: the owning session ID, the file path, and the specific named exports required.

##### Do not touch

Explicit list of files this session must not modify. Always includes:
- Entry point files (app.ts, index.ts, or equivalent) — pre-stubbed by scaffold session
- Router files (routes.tsx, router.ts, or equivalent) — pre-stubbed by scaffold session
- All files owned by other sessions (list them)
- **Shared test-registry / workspace config (#136 defect 8)**: `vitest.workspace.ts` / `vitest.workspace.js` (or the equivalent test-runner workspace registry). Phase 0 emits this as a **glob-based** registry (e.g. `['tests/**/*.test.ts']`) precisely so no feature session ever edits it — a per-session append turns it into a file every session in a wave mutates, which the runner's dependency-only reconcile cannot union-merge and which no `ownedFiles` entry covers. Put your test files where the existing globs already pick them up; never add a per-session entry to the workspace file.

##### Architecture context

Paste the relevant architecture specification sections verbatim. Include: component responsibilities, data flow, security requirements, performance targets, and any design decisions that constrain implementation choices. Do not paraphrase.

##### User stories and acceptance criteria

Paste the complete user stories this session implements, verbatim. Include every acceptance criteria scenario — happy path, edge cases, and failure cases. Do not summarize.

##### UX and design specification

Frontend sessions only. Paste the full UX specification section(s) verbatim. Include: interaction behaviors, component specs, data fields and types, state management rules, validation rules, visual specifications. Do not paraphrase. For backend-only or infrastructure sessions, state "N/A — no frontend component".

##### Critical implementation notes

Bullet list of implementation constraints Claude Code must not infer — it must be told explicitly:
- Every ordering rule that applies to this session (quote it)
- Every HTTP status code contract that applies (state it)
- Every atomicity requirement (name the tables or operations that must be in a single transaction)
- Every cross-session contract this session must honor (name the contract and the consuming session)
- Every silent failure mode — things that will appear to work but produce wrong behavior if done incorrectly
- Any approach that must be explicitly avoided and why

##### Mocking contract

**Frontend sessions**: list every API endpoint this session needs, with method, path, and exact mock response shape. The mock response shapes must match the backend brief that owns each endpoint.

**Backend sessions**: list every internal event, queue payload, or service interface this session depends on from other sessions. Include the exact payload shape.

**Infrastructure/scaffold sessions**: state "N/A — this session defines contracts, does not consume them" or list any external service contracts.

##### Acceptance criteria checklist

Convert every user story AC scenario into a flat checklist. Format:
    - [ ] [Specific verifiable outcome] [US-XXX AC-N]

Every item must be independently testable. Every AC scenario from the pasted user stories must appear here. Add technical ACs not covered by stories (e.g., transaction atomicity, RLS enforcement, correct HTTP status codes).

**Each AC line must either**:
(a) be covered by one or more `it(...)` blocks in the Independent Test (and that mapping must appear in the *AC → assertion mapping* below), OR
(b) be marked `[MANUAL]` at the end of the line, in which case it MUST also appear in the trailing JSON block's `manualAcs[]`. Manual items become PR-description checkboxes for human sign-off in the downstream runner.

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path** (TDD — written first, must fail before implementation): `tests/sessions/{session-id}.test.ts` (adapt extension/path to project conventions; for non-TS projects use the project's idiomatic test path).
- **Exact CI command**: the precise shell command CI runs to execute this session's tests in isolation (e.g., `npm test -- tests/sessions/{session-id}`, `pytest tests/sessions/{session-id}.py`). For the MANDATORY Phase 0 integration-harness session ONLY, this MUST be the project-level integration command (e.g., `npm run test:integration`). **The command MUST be a single binary invocation — NO shell operators**: no `&&`, `||`, `;`, `|`, backticks, or `source `, and **never a `cd …` prefix**. The local runner executes it with `shell:false`, so a `cd backend && pytest` would be passed verbatim to `spawn` and fail. For a monorepo subdirectory, set `test.cwd` (below) instead of embedding `cd`.
- **Working directory** (`test.cwd`, optional): if the test must run from a subdirectory (monorepo packages, `backend/`, etc.), give the worktree-relative path here and keep `cmd` to the bare invocation (e.g. `cwd: "backend"`, `cmd: "poetry run pytest tests/sessions/test_x.py"`). Omit `cwd` when the test runs from the repo root.
- **AC → assertion mapping**: a table or bulleted list mapping every NON-`[MANUAL]` AC line above to one or more `it(...)` / `test(...)` block names in the test file. Format: `US-XXX AC-N → it("does the thing")`. `[MANUAL]` ACs are exempt and surface in the trailing JSON `manualAcs[]` instead.
- **Fixtures / test doubles**: every fixture, factory, or mock used. Mock shapes MUST match the Mocking contract section above — same response shapes, same field names, same types.
- **Pre-conditions**: any migrations, seed data, environment variables, or service spin-up the test depends on.
- **Isolation rule**: the test MUST pass when this session's PR is the only one merged in its wave — no sibling session in the same wave needs to have merged first. If the test cannot pass in isolation, this is a planning bug — flag it instead of writing a brittle test.
- **No project-wide gate inside a per-session test (#136 defect 9)**: the Independent Test must exercise ONLY this session's own acceptance criteria. Do NOT embed a repo-wide gate (e.g. `execSync('npx tsc -p tsconfig.json --noEmit')` or a lint/typecheck of the whole tree) inside a session test file. Such a gate fails this session whenever ANY sibling's code does not compile (breaking the isolation rule), and it is silently bypassed by sessions whose `test.cmd` is file-scoped — so a real type error can merge green via one session while failing unrelated ones. Project-wide typecheck is enforced uniformly for every PR by the emitted CI workflow's `tsc --noEmit` step (alongside the #111 Node-compat step), not by any single session's test.
- **Self-verify before finishing (REQUIRED)**: do NOT end the session until you have actually run the exact `test.cmd` above and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If a backing service the test needs (database, cache, etc.) is not reachable in your environment, that is a blocker to surface, not a reason to finish with a red or un-run test. A session that finishes with a failing or never-executed Independent Test is a defect: the runner's gate will reject it and no PR will open.

##### Version control is the runner's job (do NOT push or open a PR)

Every brief MUST include this instruction to the implementer, verbatim and prominently (#136 defect 7 — the per-session agent must not reach into the runner's PR invariant):
> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome** after this session's PR is merged. Describe a user-facing or system-facing behavior an operator could verify without reading the diff (e.g., "Logged-in users land on /dashboard after submitting the login form", "`GET /healthz` returns 200 with `db:ok`").
- **Shippability claim**: state explicitly — "this PR is independently mergeable to main even if no other session in the same wave has merged." If that statement is NOT true, name the blocking session ID and treat this as a planning bug surfaced for the reviewer to resolve (not a brief defect to paper over).

##### Output and handoff

What this session produces that downstream sessions depend on:
- List every file, function, type, or event contract that other sessions will import
- For each: name the consuming session(s)
- Flag any export that is load-bearing (must not change after merge) with `[LOAD-BEARING]`

---

After the closing `---` of the brief above, append a REQUIRED trailing structured JSON block. The Track B build runner consumes this as typed data — it MUST be present, well-formed, and match this exact shape:

```json
{
  "test": { "cmd": "npm test -- tests/sessions/<session-id>", "file": "tests/sessions/<session-id>.test.ts", "cwd": "(optional worktree-relative dir, omit if repo root)" },
  "checkpoint": "One-sentence observable outcome (mirrors the Checkpoint section above).",
  "manualAcs": [
    { "id": "US-XXX-AC-N", "text": "Verbatim text of the [MANUAL] AC line." }
  ],
  "exports": [
    { "kind": "type", "name": "TypeName", "shape": "{ field: string; other: number }" },
    { "kind": "function", "name": "fnName", "shape": "(arg: string) => Promise<Result>" },
    { "kind": "module", "name": "path/to/module", "shape": "src/path/to/module.ts" }
  ],
  "imports": [
    { "from": "S0-A", "file": "src/db/client.ts", "names": ["dbClient", "AppConfig"] }
  ],
  "sharedFiles": [
    { "path": "vitest.workspace.ts", "strategy": "single-owner-glob", "note": "Phase 0 owns it as a glob registry; no session edits it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Migrations run once by the Phase 0 harness before parallel integration sessions." }
  ]
}
```

Field rules:
- **`test.cmd`** — the exact CI command from the Independent Test section. For the Phase 0 integration-harness session this MUST be the project-level integration command (e.g., `npm run test:integration`). **MUST be a single binary invocation with NO shell operators** (`&&`, `||`, `;`, `|`, backticks, `source `) and **no `cd …` prefix** — the runner spawns it with `shell:false`. Use `test.cwd` for a subdirectory.
- **`test.file`** — the test file path from the Independent Test section.
- **`test.cwd`** — optional, worktree-relative directory to run `cmd` from. Use it instead of a `cd` prefix for monorepo/subdirectory tests. Omit entirely when the test runs from the repo root.
- **`checkpoint`** — a machine-readable copy of the Checkpoint one-sentence observable outcome (do NOT duplicate the shippability claim into this field).
- **`manualAcs[]`** — one entry for every AC line marked `[MANUAL]` in the checklist. `id` is the `US-XXX-AC-N` tag; `text` is the AC text without the `[MANUAL]` marker. Empty array `[]` if none.
- **`exports[]`** — every named export this session produces that another session may import. For `kind: "type"` or `"function"`, `shape` is a TS-style type signature. For `kind: "module"`, `shape` is the module path. Used by `validateIntraWaveExports` to detect hidden cross-session contract dependencies at plan time. Empty array `[]` only if this session genuinely produces no shared exports (rare — most sessions export at least one symbol).
- **`imports[]`** — the structured form of the `##### Read-only imports` table above, but **restricted to other sessions' exports**. One entry per imported file: `from` is the producer session's ID (`S{phase}-{letter}`), `file` is the imported file path, and `names[]` lists ONLY the session-produced symbols imported from it (must match that session's `exports[].name`). **Do NOT list third-party / library symbols here** (e.g. `Socket`, `IO`, `Redis`, `Axios`, `Request`) — those are runtime dependencies, not cross-session contracts, and belong only in the prose table. This block drives deterministic wave sequencing and the dependency validators, so it must be exact. CRITICAL ORDERING RULE: a producer you import from MUST be in an earlier phase than this session, OR in the same phase with no reciprocal import back from this session (a mutual same-phase import is an unresolvable cycle and will block the plan). Empty array `[]` if this session imports nothing from other sessions.
- **`sharedFiles[]`** (#141 Part A) — every **inherently shared file** this session touches or relies on: a file >1 session must edit/append (a test-workspace registry like `vitest.workspace.ts`, a CI workflow, a tsconfig/eslint/compose config, a routes/DI index, a barrel export). For each, declare a coordination `strategy`: `single-owner-glob` (exactly one session owns it and it is written so siblings never edit it — the PREFERRED resolution for registries: a glob that auto-discovers, e.g. `['tests/**/*.test.ts']`), `union-merge` (multiple sessions append and the runner 3-way-merges it, like `package.json`), or `generated-not-edited` (produced by a build/codegen step, hand-edited by nobody — e.g. a lockfile). The decomposition verifier REFUSES a plan whose shared surface has no declared strategy (an unowned, un-strategized shared file is exactly what conflicts under parallel execution). Empty array `[]` only if this session touches no shared surface.
- **`sharedResources[]`** (#141 Part A) — every **shared mutable runtime resource** this session's tests contend on under parallel execution: a fixture database, a cache, a queue/broker, a shared filesystem dir. For each declare a `kind` (`database` | `cache` | `queue` | `filesystem` | `broker` | `other`) and a concurrency-safe `coordination` contract: `run-once` (provisioned once by a single owner — typically the Phase 0 harness — before any parallel worker), `advisory-lock` (a lock serializes the critical section, e.g. a Postgres advisory lock around `runMigrations`), `idempotent` (setup is safe to run repeatedly — `CREATE … IF NOT EXISTS`, upserts), or `isolated-per-worker` (each worker gets its own schema/db so there is no contention). Parallel sessions sharing a database fixture WITHOUT a declared contract race on setup (the canary's `relation "users" already exists`), and the verifier refuses such a plan. Empty array `[]` if this session shares no mutable resource.

The JSON block MUST be the final content in the brief — nothing after the closing ```. Fill in every section above completely; do not leave any section empty or with placeholder text. If a non-JSON section is not applicable (e.g., UX spec for a backend session), state "N/A" with a brief reason.
```

**User Message:**
```
Generate the implementation brief for session **S2-C — Health Route**.

Phase: 2 | Category: Backend API | Prerequisites: S1-A

Owned files:
- app/routes/health.rb
- tests/integration/health_spec.rb

Use the specification context provided in the system blocks to fill in all sections of the brief completely.

Fill the **Pre-installed environment** section from the Project Requirements block, scoping the session-specific installs to session id **S2-C**.

**Runtime-floor guidance for the Technology constraints section (authoritative for this project's ecosystem):** This project targets Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a LATER Ruby version than the floor. Stick to the floor's stdlib.
```

---

### build-plan-brief-S2-D [primary]

**System Prompt:**
```
You are generating an implementation brief for a single Claude Code session. This brief is the ONLY input the Claude Code instance will receive — it must contain everything needed for fully autonomous execution.

**The most important rule**: never summarize, paraphrase, or compress content from the specification documents. Paste the relevant sections verbatim. Claude Code works from exact original language, not interpretations.

Produce the brief using exactly this template:

---

#### {Session ID} — {Session Name}

**Phase {N} | {Category} | Needs: {prerequisite session IDs or "none"}**

##### Objective

One sentence: what this session builds and why it matters to the overall system.

##### Scope

State P0 MVP or P1 v1.0. If this session contains both P0 and P1 work, list which stories are P0 and which are P1. Claude Code must implement P0 work fully and stub P1 work as clearly marked placeholders — never silently omit P1 without a stub.

##### Technology constraints

The specific libraries and versions this session must use. State explicitly any library that must NOT be used and why. These constraints are sourced from the distilled spec Section 1.8 and are non-negotiable.

**Runtime floor — non-negotiable.** State the project's declared runtime floor from the Project Requirements block's `runtimes` (e.g. `node 20`, `python 3.11`, `ruby 3.3`). All code this session writes — implementation AND test files — MUST run on that floor version. Do NOT use language or standard-library APIs introduced in a LATER version than the floor, even if they work on the build host (the host often runs a newer runtime than CI, which is pinned to the floor). Apply the **Runtime-floor guidance** directive in the user message — it carries the language-specific gotchas for THIS project's ecosystem; do not import gotchas from a different language. When you need newer behavior, use a maintained third-party package that targets the floor instead. If no `runtimes` floor is declared, target the most conservative version implied by the spec and say so.

##### Performance targets

Any SLA this session is directly responsible for meeting. State the metric, the target value, and whether it is a hard SLA or a monitoring target. If this session owns no SLA directly, state "none — see downstream sessions".

##### Pre-installed environment

Populate this section from the **Project Requirements** system block (the toolchain requirements for this build plan). Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. State exactly what is available so the implementer does not re-invent install steps:

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** <list every `hostBinaries` entry from the requirements block, or "none declared">
> - **Runtimes:** <list every `runtimes` entry with its version, e.g. `node 20`, `python 3.11`, or "none declared">. **These versions are the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** <list every `workspaceInstall[].cmd`, or "none">
> - **Session-specific installs run for this session:** <list `sessionInstall["{Session ID}"]` entries for THIS session id, or "none">
>
> Do NOT include `npm install` / `pip install` / equivalent in your implementation — they have already run. Do NOT re-declare these dependencies in any setup or readme.

If no Project Requirements block was provided, state "N/A — no project requirements declared" and omit the install warnings.

**If THIS session is the Phase 0 integration-harness session that owns `package.json` (or project-equivalent manifest):** the runner has already seeded a complete project manifest + lockfile onto the base branch from the requirements block's `projectManifest` (#109). Your worktree therefore already contains a `package.json` enumerating the whole project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present (frontend, backend, AND harness), add any the seed missed, wire up the `scripts` (especially the project-level integration command), and commit. Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them (this includes the seeded compat-lint devDependencies `eslint` / `eslint-plugin-n` / `@typescript-eslint/parser`, which the CI + runner Node-API compat gate (#111) requires — keep them). Enumerate the full intended dependency set explicitly in this brief's prose so the brief-quality scorer can verify completeness.

##### Owned files

Every file this session creates or modifies. Exhaustive — if it is not listed here, this session must not touch it.

##### Read-only imports

Every file from other sessions this session imports. For each: the owning session ID, the file path, and the specific named exports required.

##### Do not touch

Explicit list of files this session must not modify. Always includes:
- Entry point files (app.ts, index.ts, or equivalent) — pre-stubbed by scaffold session
- Router files (routes.tsx, router.ts, or equivalent) — pre-stubbed by scaffold session
- All files owned by other sessions (list them)
- **Shared test-registry / workspace config (#136 defect 8)**: `vitest.workspace.ts` / `vitest.workspace.js` (or the equivalent test-runner workspace registry). Phase 0 emits this as a **glob-based** registry (e.g. `['tests/**/*.test.ts']`) precisely so no feature session ever edits it — a per-session append turns it into a file every session in a wave mutates, which the runner's dependency-only reconcile cannot union-merge and which no `ownedFiles` entry covers. Put your test files where the existing globs already pick them up; never add a per-session entry to the workspace file.

##### Architecture context

Paste the relevant architecture specification sections verbatim. Include: component responsibilities, data flow, security requirements, performance targets, and any design decisions that constrain implementation choices. Do not paraphrase.

##### User stories and acceptance criteria

Paste the complete user stories this session implements, verbatim. Include every acceptance criteria scenario — happy path, edge cases, and failure cases. Do not summarize.

##### UX and design specification

Frontend sessions only. Paste the full UX specification section(s) verbatim. Include: interaction behaviors, component specs, data fields and types, state management rules, validation rules, visual specifications. Do not paraphrase. For backend-only or infrastructure sessions, state "N/A — no frontend component".

##### Critical implementation notes

Bullet list of implementation constraints Claude Code must not infer — it must be told explicitly:
- Every ordering rule that applies to this session (quote it)
- Every HTTP status code contract that applies (state it)
- Every atomicity requirement (name the tables or operations that must be in a single transaction)
- Every cross-session contract this session must honor (name the contract and the consuming session)
- Every silent failure mode — things that will appear to work but produce wrong behavior if done incorrectly
- Any approach that must be explicitly avoided and why

##### Mocking contract

**Frontend sessions**: list every API endpoint this session needs, with method, path, and exact mock response shape. The mock response shapes must match the backend brief that owns each endpoint.

**Backend sessions**: list every internal event, queue payload, or service interface this session depends on from other sessions. Include the exact payload shape.

**Infrastructure/scaffold sessions**: state "N/A — this session defines contracts, does not consume them" or list any external service contracts.

##### Acceptance criteria checklist

Convert every user story AC scenario into a flat checklist. Format:
    - [ ] [Specific verifiable outcome] [US-XXX AC-N]

Every item must be independently testable. Every AC scenario from the pasted user stories must appear here. Add technical ACs not covered by stories (e.g., transaction atomicity, RLS enforcement, correct HTTP status codes).

**Each AC line must either**:
(a) be covered by one or more `it(...)` blocks in the Independent Test (and that mapping must appear in the *AC → assertion mapping* below), OR
(b) be marked `[MANUAL]` at the end of the line, in which case it MUST also appear in the trailing JSON block's `manualAcs[]`. Manual items become PR-description checkboxes for human sign-off in the downstream runner.

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path** (TDD — written first, must fail before implementation): `tests/sessions/{session-id}.test.ts` (adapt extension/path to project conventions; for non-TS projects use the project's idiomatic test path).
- **Exact CI command**: the precise shell command CI runs to execute this session's tests in isolation (e.g., `npm test -- tests/sessions/{session-id}`, `pytest tests/sessions/{session-id}.py`). For the MANDATORY Phase 0 integration-harness session ONLY, this MUST be the project-level integration command (e.g., `npm run test:integration`). **The command MUST be a single binary invocation — NO shell operators**: no `&&`, `||`, `;`, `|`, backticks, or `source `, and **never a `cd …` prefix**. The local runner executes it with `shell:false`, so a `cd backend && pytest` would be passed verbatim to `spawn` and fail. For a monorepo subdirectory, set `test.cwd` (below) instead of embedding `cd`.
- **Working directory** (`test.cwd`, optional): if the test must run from a subdirectory (monorepo packages, `backend/`, etc.), give the worktree-relative path here and keep `cmd` to the bare invocation (e.g. `cwd: "backend"`, `cmd: "poetry run pytest tests/sessions/test_x.py"`). Omit `cwd` when the test runs from the repo root.
- **AC → assertion mapping**: a table or bulleted list mapping every NON-`[MANUAL]` AC line above to one or more `it(...)` / `test(...)` block names in the test file. Format: `US-XXX AC-N → it("does the thing")`. `[MANUAL]` ACs are exempt and surface in the trailing JSON `manualAcs[]` instead.
- **Fixtures / test doubles**: every fixture, factory, or mock used. Mock shapes MUST match the Mocking contract section above — same response shapes, same field names, same types.
- **Pre-conditions**: any migrations, seed data, environment variables, or service spin-up the test depends on.
- **Isolation rule**: the test MUST pass when this session's PR is the only one merged in its wave — no sibling session in the same wave needs to have merged first. If the test cannot pass in isolation, this is a planning bug — flag it instead of writing a brittle test.
- **No project-wide gate inside a per-session test (#136 defect 9)**: the Independent Test must exercise ONLY this session's own acceptance criteria. Do NOT embed a repo-wide gate (e.g. `execSync('npx tsc -p tsconfig.json --noEmit')` or a lint/typecheck of the whole tree) inside a session test file. Such a gate fails this session whenever ANY sibling's code does not compile (breaking the isolation rule), and it is silently bypassed by sessions whose `test.cmd` is file-scoped — so a real type error can merge green via one session while failing unrelated ones. Project-wide typecheck is enforced uniformly for every PR by the emitted CI workflow's `tsc --noEmit` step (alongside the #111 Node-compat step), not by any single session's test.
- **Self-verify before finishing (REQUIRED)**: do NOT end the session until you have actually run the exact `test.cmd` above and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If a backing service the test needs (database, cache, etc.) is not reachable in your environment, that is a blocker to surface, not a reason to finish with a red or un-run test. A session that finishes with a failing or never-executed Independent Test is a defect: the runner's gate will reject it and no PR will open.

##### Version control is the runner's job (do NOT push or open a PR)

Every brief MUST include this instruction to the implementer, verbatim and prominently (#136 defect 7 — the per-session agent must not reach into the runner's PR invariant):
> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome** after this session's PR is merged. Describe a user-facing or system-facing behavior an operator could verify without reading the diff (e.g., "Logged-in users land on /dashboard after submitting the login form", "`GET /healthz` returns 200 with `db:ok`").
- **Shippability claim**: state explicitly — "this PR is independently mergeable to main even if no other session in the same wave has merged." If that statement is NOT true, name the blocking session ID and treat this as a planning bug surfaced for the reviewer to resolve (not a brief defect to paper over).

##### Output and handoff

What this session produces that downstream sessions depend on:
- List every file, function, type, or event contract that other sessions will import
- For each: name the consuming session(s)
- Flag any export that is load-bearing (must not change after merge) with `[LOAD-BEARING]`

---

After the closing `---` of the brief above, append a REQUIRED trailing structured JSON block. The Track B build runner consumes this as typed data — it MUST be present, well-formed, and match this exact shape:

```json
{
  "test": { "cmd": "npm test -- tests/sessions/<session-id>", "file": "tests/sessions/<session-id>.test.ts", "cwd": "(optional worktree-relative dir, omit if repo root)" },
  "checkpoint": "One-sentence observable outcome (mirrors the Checkpoint section above).",
  "manualAcs": [
    { "id": "US-XXX-AC-N", "text": "Verbatim text of the [MANUAL] AC line." }
  ],
  "exports": [
    { "kind": "type", "name": "TypeName", "shape": "{ field: string; other: number }" },
    { "kind": "function", "name": "fnName", "shape": "(arg: string) => Promise<Result>" },
    { "kind": "module", "name": "path/to/module", "shape": "src/path/to/module.ts" }
  ],
  "imports": [
    { "from": "S0-A", "file": "src/db/client.ts", "names": ["dbClient", "AppConfig"] }
  ],
  "sharedFiles": [
    { "path": "vitest.workspace.ts", "strategy": "single-owner-glob", "note": "Phase 0 owns it as a glob registry; no session edits it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Migrations run once by the Phase 0 harness before parallel integration sessions." }
  ]
}
```

Field rules:
- **`test.cmd`** — the exact CI command from the Independent Test section. For the Phase 0 integration-harness session this MUST be the project-level integration command (e.g., `npm run test:integration`). **MUST be a single binary invocation with NO shell operators** (`&&`, `||`, `;`, `|`, backticks, `source `) and **no `cd …` prefix** — the runner spawns it with `shell:false`. Use `test.cwd` for a subdirectory.
- **`test.file`** — the test file path from the Independent Test section.
- **`test.cwd`** — optional, worktree-relative directory to run `cmd` from. Use it instead of a `cd` prefix for monorepo/subdirectory tests. Omit entirely when the test runs from the repo root.
- **`checkpoint`** — a machine-readable copy of the Checkpoint one-sentence observable outcome (do NOT duplicate the shippability claim into this field).
- **`manualAcs[]`** — one entry for every AC line marked `[MANUAL]` in the checklist. `id` is the `US-XXX-AC-N` tag; `text` is the AC text without the `[MANUAL]` marker. Empty array `[]` if none.
- **`exports[]`** — every named export this session produces that another session may import. For `kind: "type"` or `"function"`, `shape` is a TS-style type signature. For `kind: "module"`, `shape` is the module path. Used by `validateIntraWaveExports` to detect hidden cross-session contract dependencies at plan time. Empty array `[]` only if this session genuinely produces no shared exports (rare — most sessions export at least one symbol).
- **`imports[]`** — the structured form of the `##### Read-only imports` table above, but **restricted to other sessions' exports**. One entry per imported file: `from` is the producer session's ID (`S{phase}-{letter}`), `file` is the imported file path, and `names[]` lists ONLY the session-produced symbols imported from it (must match that session's `exports[].name`). **Do NOT list third-party / library symbols here** (e.g. `Socket`, `IO`, `Redis`, `Axios`, `Request`) — those are runtime dependencies, not cross-session contracts, and belong only in the prose table. This block drives deterministic wave sequencing and the dependency validators, so it must be exact. CRITICAL ORDERING RULE: a producer you import from MUST be in an earlier phase than this session, OR in the same phase with no reciprocal import back from this session (a mutual same-phase import is an unresolvable cycle and will block the plan). Empty array `[]` if this session imports nothing from other sessions.
- **`sharedFiles[]`** (#141 Part A) — every **inherently shared file** this session touches or relies on: a file >1 session must edit/append (a test-workspace registry like `vitest.workspace.ts`, a CI workflow, a tsconfig/eslint/compose config, a routes/DI index, a barrel export). For each, declare a coordination `strategy`: `single-owner-glob` (exactly one session owns it and it is written so siblings never edit it — the PREFERRED resolution for registries: a glob that auto-discovers, e.g. `['tests/**/*.test.ts']`), `union-merge` (multiple sessions append and the runner 3-way-merges it, like `package.json`), or `generated-not-edited` (produced by a build/codegen step, hand-edited by nobody — e.g. a lockfile). The decomposition verifier REFUSES a plan whose shared surface has no declared strategy (an unowned, un-strategized shared file is exactly what conflicts under parallel execution). Empty array `[]` only if this session touches no shared surface.
- **`sharedResources[]`** (#141 Part A) — every **shared mutable runtime resource** this session's tests contend on under parallel execution: a fixture database, a cache, a queue/broker, a shared filesystem dir. For each declare a `kind` (`database` | `cache` | `queue` | `filesystem` | `broker` | `other`) and a concurrency-safe `coordination` contract: `run-once` (provisioned once by a single owner — typically the Phase 0 harness — before any parallel worker), `advisory-lock` (a lock serializes the critical section, e.g. a Postgres advisory lock around `runMigrations`), `idempotent` (setup is safe to run repeatedly — `CREATE … IF NOT EXISTS`, upserts), or `isolated-per-worker` (each worker gets its own schema/db so there is no contention). Parallel sessions sharing a database fixture WITHOUT a declared contract race on setup (the canary's `relation "users" already exists`), and the verifier refuses such a plan. Empty array `[]` if this session shares no mutable resource.

The JSON block MUST be the final content in the brief — nothing after the closing ```. Fill in every section above completely; do not leave any section empty or with placeholder text. If a non-JSON section is not applicable (e.g., UX spec for a backend session), state "N/A" with a brief reason.
```

**User Message:**
```
Generate the implementation brief for session **S2-D — Status Route (brand_color)**.

Phase: 2 | Category: Backend API | Prerequisites: S1-A

Owned files:
- app/routes/status.rb
- tests/integration/status_spec.rb

Use the specification context provided in the system blocks to fill in all sections of the brief completely.

Fill the **Pre-installed environment** section from the Project Requirements block, scoping the session-specific installs to session id **S2-D**.

**Runtime-floor guidance for the Technology constraints section (authoritative for this project's ecosystem):** This project targets Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a LATER Ruby version than the floor. Stick to the floor's stdlib.
```

---

### build-plan-ownership-commentary [primary]

**System Prompt:**
```
You are writing a brief commentary on a build plan's shared file ownership table. The table itself is already complete, authoritative, and rendered deterministically — you receive it as input. **Do not reproduce, re-list, or restate the table.**

Write 2–4 short paragraphs (≈250 words max) of prose that help a human reviewer act on the table:
- Which files are **load-bearing** (imported across sessions) and what that implies: changing one after its owning session merges requires updating every importing session and re-running the consistency check.
- Any **foundational** files (database schema, shared types, configuration, core interfaces) that warrant extra review even if only one session imports them.
- Any **ownership conflicts** (a file claimed by more than one session) and why they block parallel execution — call these out as must-fix.
- One concrete coordination/mutation recommendation for the highest-risk files.

Be specific to the table provided. Never invent files that are not in the table. Output prose only — no tables, no markdown headings, no bullet lists longer than the four themes above.
```

**User Message:**
```
## Shared File Ownership Table (authoritative — do not reproduce)

# Section 6 — Shared File Ownership Table

Deterministically rendered from each session's owned files and structured cross-session imports (#103). Every owned file appears exactly once.

| File path | Owner session | Importing sessions | Mutable after merge |
| --------- | ------------- | ------------------ | ------------------- |
| `.rspec` | S0-A | — | Yes |
| `app/app.rb` | S0-A | S2-A, S2-B, S2-C, S2-D | No — **LOAD-BEARING** |
| `app/routes/bookmarks.rb` | S2-A | — | Yes |
| `app/routes/health.rb` | S2-C | — | Yes |
| `app/routes/status.rb` | S2-D | — | Yes |
| `app/routes/tags.rb` | S2-B | — | Yes |
| `app/store.rb` | S1-A | S2-A, S2-B | No — **LOAD-BEARING** |
| `Gemfile` | S0-A | — | Yes |
| `spec/spec_helper.rb` | S0-A | S2-A, S2-C, S2-D | No — **LOAD-BEARING** |
| `tests/integration/bookmarks_spec.rb` | S2-A | — | Yes |
| `tests/integration/harness_spec.rb` | S0-A | — | Yes |
| `tests/integration/health_spec.rb` | S2-C | — | Yes |
| `tests/integration/status_spec.rb` | S2-D | — | Yes |
| `tests/integration/store_spec.rb` | S1-A | — | Yes |
| `tests/integration/tags_spec.rb` | S2-B | — | Yes |

**15** owned file(s) · **3** load-bearing (imported across sessions) · **0** ownership conflict(s).

```

---

### build-plan-consistency-check [primary]

**System Prompt:**
```
You are auditing an autonomous build plan for semantic consistency. You receive: brief summaries, the distilled specification, the session table, and results from automated programmatic checks.

The programmatic checks have already verified:
- File ownership (no file in >1 session)
- Dependency graph (no cycles, valid prereq IDs, phase consistency)
- Declared dependencies (imports from prior-phase sessions only)
- Route coverage (every route owned by exactly one session)

Focus your audit on semantic issues the code cannot catch. Run the following checks and report PASS or FAIL per check. For every FAIL: state the session ID, the field, and the specific violation.

**CHECK 1 — Mock/backend alignment** For every endpoint referenced in any frontend session: does the mock response shape match the response type defined in the owning backend session's brief? Pass: no shape mismatches.

**CHECK 2 — Ordering rule propagation** For every critical ordering rule in the distilled spec Section 1.4: does it appear in the Critical Implementation Notes of every session brief whose owned files touch the relevant code surface? Pass: every ordering rule covered in every applicable brief.

**CHECK 3 — Analytics event firing consistency** Does each analytics event from Section 1.10 appear as a firing point in exactly one session brief? Does any brief incorrectly instruct firing an analytics event from a prohibited surface? Pass: each event fires from exactly one place. If no analytics events exist, PASS.

**CHECK 4 — Technology stack compliance** Does every session brief that specifies a technology match the selected stack from Section 1.8? Pass: no alternative technology choices present in any brief.

**CHECK 5 — Cross-session runtime pattern consistency** Does every brief that reads or writes a cache key, message queue event, real-time event, or browser storage key use the exact pattern from Section 1.11? Pass: all runtime patterns consistent. If no cross-session patterns exist, PASS.

**CHECK 6 — Full story coverage** List every user story ID from the distilled spec. List every user story ID referenced in any brief checklist. Report any story ID present in the spec but absent from all briefs. Pass: no orphaned stories.

**CHECK 7 — Entry point exclusion** Do all non-scaffold session briefs list entry point and router files in "Do not touch"? Pass: yes for all non-scaffold sessions.

Report a summary: N/7 checks passed. List all failures with specific details.
```

**User Message:**
```
## Programmatic Check Results

File Ownership: PASS
Dependency Graph: PASS
Declared Dependencies: PASS
Route Coverage: FAIL — Route POST /bookmarks` may not be covered by any session's owned files; Route GET /bookmarks` may not be covered by any session's owned files; Route GET /tags` may not be covered by any session's owned files; Route GET /health` may not be covered by any session's owned files; Route GET /status` may not be covered by any session's owned files
undefined: PASS
undefined: PASS
undefined: PASS
undefined: PASS
undefined: PASS

---

## Session Table

## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases

---

## Brief Summaries

### S0-A — Scaffold + Integration Harness
Owned files: - `Gemfile` — reconcile seeded manifest; confirm all four gems present with the group structure above.
- `.rspec` — minimal config (`--require spec_helper`, `--format documentation`).
- `spec/spec_helper.rb` — shared test registry: load `app/app.rb`, configure `Rack::Test::Methods`, expose an `app` helper returning `Bookmarks::App`, set `ENV['RACK_ENV'] = 'test'`. **Frozen after this session — no other session may edit.**
- `app/app.rb` — defines `module Bookmarks; class App < Sinatra::Base; end; end`. Adds a 404 JSON error handler (`not_found`) returning `{ "error": "not found" }` with content-type `application/json`. Lazy-loads any route files present via `Dir[File.expand_path('routes/*.rb', __dir__)].sort.each { |f| require f }` so downstream sessions can drop in route files without editing this file.
- `tests/integration/harness_spec.rb` — smoke spec that boots `Bookmarks::App`, hits an unknown route, and asserts `404` + JSON error body. Proves the harness, the app, and the `rack-test` wiring all work end-to-end.
Imports: None. This session is the root of the dependency graph.

### S1-A — Bookmark Store (Postgres)
Owned files: - `app/store.rb` — defines `Bookmarks::Store` (or top-level `Store`; see Critical implementation notes) with `#create`, `#all`, `#find`, `#delete`, plus DDL bootstrap (`CREATE TABLE IF NOT EXISTS`).
- `tests/integration/store_spec.rb` — RSpec integration spec exercising all four methods against the real fixture Postgres.
Imports: - From **S0-A**: `spec/spec_helper.rb` (loaded automatically by `.rspec`'s `--require spec_helper`); `Gemfile` (already provides `pg`, `rspec`, `rack-test`); `app/app.rb` (NOT required by this session — `Store` is independent of the Sinatra app).

### S2-A — Bookmarks CRUD Routes
Owned files: - `app/routes/bookmarks.rb` — the route implementation
- `tests/integration/bookmarks_spec.rb` — the integration spec (TDD: written first, must fail before implementation)
Imports: | Session | File | Symbols / contracts consumed |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` — the Sinatra app class that glob-requires files under `app/routes/`; `spec/spec_helper.rb` — RSpec + rack-test helpers |
| S0-A | `spec/spec_helper.rb` | `app` helper (rack-test), RSpec configuration |
| S1-A | `app/store.rb` | `Store#create(attrs)`, `Store#all`, `Store#find(id)`, `Store#delete(id)` |

### S2-B — Tag Routes
Owned files: - `app/routes/tags.rb` — implements `POST /bookmarks/:id/tags` and `GET /tags`
- `tests/integration/tags_spec.rb` — RSpec integration spec for these routes
Imports: | Session | File | Symbols / contract used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra base class; `tags.rb` registers routes against it) |
| S0-A | `spec/spec_helper.rb` | RSpec + rack-test wiring (`app` helper, shared DB setup) |
| S1-A | `app/store.rb` | `Store#create`, `Store#all`, `Store#find`, `Store#delete` (full contract listed in §1.1) |

### S2-C — Health Route
Owned files: - `app/routes/health.rb` — implements `GET /health`
- `tests/integration/health_spec.rb` — RSpec integration spec for the health route
Imports: | Owning session | File | What is used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra application class; glob-requires route files including `health.rb`) |
| S0-A | `spec/spec_helper.rb` | `require 'spec_helper'` — sets up rack-test, loads the app |
| S1-A | `app/store.rb` | NOT imported — health route does not use `Store` |

### S2-D — Status Route (brand_color)
Owned files: - `app/routes/status.rb` — the `GET /status` route implementation
- `tests/integration/status_spec.rb` — the RSpec integration spec for this session
Imports: | Owning session | File | Used symbols / methods |
|---|---|---|
| S0-A | `spec/spec_helper.rb` | RSpec configuration, `app` helper, rack-test includes |
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra app that glob-requires route files) |
| S1-A | `app/store.rb` | `Store` (not directly needed by the route, but `app/app.rb` loads it; no direct Store call required) |
```

---

### build-plan-dry-run [primary]

**System Prompt:**
```
You are generating a dry-run verification procedure for an autonomous build plan. This procedure must pass before any Phase 1 session begins.

You receive extracted export/import tables from Phase 0 and Phase 1 briefs — not full briefs. Use these to produce a compact verification procedure.

## Step 1 — Run Phase 0

Run the Phase 0 scaffold session in isolation with only its brief. Capture its complete output. Extract an export manifest: one row per named export across all output files.

## Step 2 — Consolidated import table

Produce a single table of every import that any Phase 1 session expects from Phase 0:

| Session | File Path | Export Name | Expected Type/Shape |
|---------|-----------|-------------|---------------------|

Derive this from the import tables provided. Do not repeat the full brief content — one row per import.

## Step 3 — Mismatch report (failures only)

Cross-reference the Phase 0 output table against Step 2. Report **only mismatches and missing items** — do not list successful matches. For each issue, include the fix inline:

| Session | File | Expected Export | Issue | Fix (which brief section to update) |
|---------|------|-----------------|-------|--------------------------------------|

If zero mismatches: state "All imports verified — dry run PASS" and stop.

## Step 4 — Ambiguous items

List any imports whose shape cannot be verified from the brief text alone (e.g., the brief says "import X" but doesn't specify the type). These require Step 1 output inspection:

| # | Session | File | What to verify |
|---|---------|------|----------------|

**The dry run must achieve a full match before any Phase 1 session begins.** This is the lowest-cost moment to catch contract mismatches.
```

**User Message:**
```
## Phase 0 and Phase 1 — Export/Import Extracts

### S0-A — Scaffold + Integration Harness (Phase 0)
**Owned files:**
- `Gemfile` — reconcile seeded manifest; confirm all four gems present with the group structure above.
- `.rspec` — minimal config (`--require spec_helper`, `--format documentation`).
- `spec/spec_helper.rb` — shared test registry: load `app/app.rb`, configure `Rack::Test::Methods`, expose an `app` helper returning `Bookmarks::App`, set `ENV['RACK_ENV'] = 'test'`. **Frozen after this session — no other session may edit.**
- `app/app.rb` — defines `module Bookmarks; class App < Sinatra::Base; end; end`. Adds a 404 JSON error handler (`not_found`) returning `{ "error": "not found" }` with content-type `application/json`. Lazy-loads any route files present via `Dir[File.expand_path('routes/*.rb', __dir__)].sort.each { |f| require f }` so downstream sessions can drop in route files without editing this file.
- `tests/integration/harness_spec.rb` — smoke spec that boots `Bookmarks::App`, hits an unknown route, and asserts `404` + JSON error body. Proves the harness, the app, and the `rack-test` wiring all work end-to-end.

**Output/exports:**
N/A

**Read-only imports:**
None. This session is the root of the dependency graph.

---

### S1-A — Bookmark Store (Postgres) (Phase 1)
**Owned files:**
- `app/store.rb` — defines `Bookmarks::Store` (or top-level `Store`; see Critical implementation notes) with `#create`, `#all`, `#find`, `#delete`, plus DDL bootstrap (`CREATE TABLE IF NOT EXISTS`).
- `tests/integration/store_spec.rb` — RSpec integration spec exercising all four methods against the real fixture Postgres.

**Output/exports:**
N/A

**Read-only imports:**
- From **S0-A**: `spec/spec_helper.rb` (loaded automatically by `.rspec`'s `--require spec_helper`); `Gemfile` (already provides `pg`, `rspec`, `rack-test`); `app/app.rb` (NOT required by this session — `Store` is independent of the Sinatra app).
```

---

### build-plan-decomp-critic [primary]

**System Prompt:**
```
You are the decomposition critic for an autonomous build plan. The plan splits work into sessions that run in PARALLEL across waves. Deterministic validators already proved the structural invariants (exclusive file ownership, a conflict-free merge graph, declared dependency ordering, ownership completeness, shared-file coordination strategies). Your job is the layer those validators CANNOT enumerate: shared-surface hazards that only bite when multiple sessions run at once.

You receive the session table and per-session brief summaries (owned files, exports, imports, test command, declared shared files/resources). Hunt specifically for PARALLEL-SAFETY hazards, e.g.:
- Two sessions both registering into one shared surface that is not modeled as shared (a routes index, a DI container, a barrel/index export file, a migrations registry, an OpenAPI/schema document, an env-config loader).
- Two sessions both creating or mutating the same shared runtime resource (a database table/migration, a seed dataset, a message topic, a cache namespace) without a coordination contract.
- A global invariant (typecheck, lint, build, schema-migrate, format) that should be a uniform CI gate but appears tied to one session's work.
- A session whose "Independent Test" cannot actually pass in isolation because it depends on a sibling's not-yet-merged output.
- A shared config/manifest (tsconfig, eslint, CI workflow, compose file) that more than one session must touch without a declared single-owner-glob / union-merge / generated-not-edited strategy.

Do NOT re-report what the deterministic validators already cover (a file in two sessions' ownedFiles, a later-phase import). Only surface hazards a structural validator would miss. Be conservative: if a concern is fully coordinated (declared shared strategy or coordination contract), do not flag it.

Output ONLY a single trailing ```json``` block — no prose before or after — in this EXACT shape:

```json
{
  "hazards": [
    { "title": "Two sessions register routes in the shared app index", "detail": "S2-A and S2-B both add routes to src/app.ts, which is owned by S0-A. Concurrent edits will conflict at merge; route registration should be a single-owner-glob auto-discovery or each session owns its own router module.", "sessions": ["S2-A", "S2-B"], "severity": "high" }
  ]
}
```

`hazards` is an empty array if you find none. `severity` ∈ {high, medium, low}. Keep each `detail` specific and actionable (name the sessions + the shared surface + the fix). Report at most 10 hazards, highest-severity first.
```

**User Message:**
```
## Session Table

## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases

---

## Brief Summaries

### S0-A — Scaffold + Integration Harness
Owned files: - `Gemfile` — reconcile seeded manifest; confirm all four gems present with the group structure above.
- `.rspec` — minimal config (`--require spec_helper`, `--format documentation`).
- `spec/spec_helper.rb` — shared test registry: load `app/app.rb`, configure `Rack::Test::Methods`, expose an `app` helper returning `Bookmarks::App`, set `ENV['RACK_ENV'] = 'test'`. **Frozen after this session — no other session may edit.**
- `app/app.rb` — defines `module Bookmarks; class App < Sinatra::Base; end; end`. Adds a 404 JSON error handler (`not_found`) returning `{ "error": "not found" }` with content-type `application/json`. Lazy-loads any route files present via `Dir[File.expand_path('routes/*.rb', __dir__)].sort.each { |f| require f }` so downstream sessions can drop in route files without editing this file.
- `tests/integration/harness_spec.rb` — smoke spec that boots `Bookmarks::App`, hits an unknown route, and asserts `404` + JSON error body. Proves the harness, the app, and the `rack-test` wiring all work end-to-end.
Imports: None. This session is the root of the dependency graph.

### S1-A — Bookmark Store (Postgres)
Owned files: - `app/store.rb` — defines `Bookmarks::Store` (or top-level `Store`; see Critical implementation notes) with `#create`, `#all`, `#find`, `#delete`, plus DDL bootstrap (`CREATE TABLE IF NOT EXISTS`).
- `tests/integration/store_spec.rb` — RSpec integration spec exercising all four methods against the real fixture Postgres.
Imports: - From **S0-A**: `spec/spec_helper.rb` (loaded automatically by `.rspec`'s `--require spec_helper`); `Gemfile` (already provides `pg`, `rspec`, `rack-test`); `app/app.rb` (NOT required by this session — `Store` is independent of the Sinatra app).

### S2-A — Bookmarks CRUD Routes
Owned files: - `app/routes/bookmarks.rb` — the route implementation
- `tests/integration/bookmarks_spec.rb` — the integration spec (TDD: written first, must fail before implementation)
Imports: | Session | File | Symbols / contracts consumed |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` — the Sinatra app class that glob-requires files under `app/routes/`; `spec/spec_helper.rb` — RSpec + rack-test helpers |
| S0-A | `spec/spec_helper.rb` | `app` helper (rack-test), RSpec configuration |
| S1-A | `app/store.rb` | `Store#create(attrs)`, `Store#all`, `Store#find(id)`, `Store#delete(id)` |

### S2-B — Tag Routes
Owned files: - `app/routes/tags.rb` — implements `POST /bookmarks/:id/tags` and `GET /tags`
- `tests/integration/tags_spec.rb` — RSpec integration spec for these routes
Imports: | Session | File | Symbols / contract used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra base class; `tags.rb` registers routes against it) |
| S0-A | `spec/spec_helper.rb` | RSpec + rack-test wiring (`app` helper, shared DB setup) |
| S1-A | `app/store.rb` | `Store#create`, `Store#all`, `Store#find`, `Store#delete` (full contract listed in §1.1) |

### S2-C — Health Route
Owned files: - `app/routes/health.rb` — implements `GET /health`
- `tests/integration/health_spec.rb` — RSpec integration spec for the health route
Imports: | Owning session | File | What is used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra application class; glob-requires route files including `health.rb`) |
| S0-A | `spec/spec_helper.rb` | `require 'spec_helper'` — sets up rack-test, loads the app |
| S1-A | `app/store.rb` | NOT imported — health route does not use `Store` |

### S2-D — Status Route (brand_color)
Owned files: - `app/routes/status.rb` — the `GET /status` route implementation
- `tests/integration/status_spec.rb` — the RSpec integration spec for this session
Imports: | Owning session | File | Used symbols / methods |
|---|---|---|
| S0-A | `spec/spec_helper.rb` | RSpec configuration, `app` helper, rack-test includes |
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra app that glob-requires route files) |
| S1-A | `app/store.rb` | `Store` (not directly needed by the route, but `app/app.rb` loads it; no direct Store call required) |
```

---

## Token Usage

| Agent | # | Input | Output | Cache Read | Cache Write | Cost |
|-------|--:|------:|-------:|-----------:|------------:|------|
| build-plan-distilled-spec [primary] | 1 | 21 | 2,060 | 0 | 3,035 | $0.0492 |
| build-plan-session-table [primary] | 1 | 48 | 4,117 | 0 | 5,698 | $0.1601 |
| build-plan-requirements [primary] | 1 | 23 | 1,094 | 0 | 6,493 | $0.0554 |
| build-plan-build-order [primary] | 1 | 2,181 | 2,131 | 0 | 0 | $0.0385 |
| build-plan-mermaid-diagram [primary] | 1 | 2,418 | 470 | 0 | 0 | $0.0143 |
| build-plan-build-summary [primary] | 1 | 2,191 | 1,987 | 0 | 0 | $0.0364 |
| build-plan-out-of-band [primary] | 1 | 2,270 | 2,388 | 0 | 0 | $0.0426 |
| build-plan-gate-checklists [primary] | 1 | 2,208 | 1,604 | 0 | 0 | $0.0307 |
| build-plan-brief-S0-A [primary] | 1 | 297 | 5,770 | 0 | 13,226 | $0.2780 |
| build-plan-brief-S1-A [primary] | 1 | 272 | 6,678 | 0 | 13,226 | $0.3006 |
| build-plan-brief-S2-A [primary] | 1 | 181 | 6,573 | 0 | 9,510 | $0.1562 |
| build-plan-brief-S2-B [primary] | 1 | 175 | 5,752 | 0 | 9,510 | $0.1439 |
| build-plan-brief-S2-C [primary] | 1 | 175 | 4,926 | 0 | 9,510 | $0.1315 |
| build-plan-brief-S2-D [primary] | 1 | 180 | 5,140 | 9,510 | 0 | $0.0805 |
| build-plan-ownership-commentary [primary] | 1 | 752 | 572 | 0 | 0 | $0.0108 |
| build-plan-consistency-check [primary] | 1 | 4,044 | 4,815 | 0 | 0 | $0.0844 |
| build-plan-dry-run [primary] | 1 | 1,016 | 1,520 | 0 | 0 | $0.0258 |
| build-plan-decomp-critic [primary] | 1 | 3,956 | 945 | 0 | 0 | $0.0260 |
| **TOTAL** | **18** | **22,408** | **58,542** | **9,510** | **70,208** | **$1.6649** |

---

## Warnings

*(none)*

---

## Errors

*(none)*

---

## Next Steps

*(not captured)*

---

## Debug: API Call Details

### build-plan-distilled-spec [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 41.4s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 21 (— used)
- Output — budget: — | actual: 2,060 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (3,035 tokens written to cache)

---

### build-plan-session-table [primary]

**Request Parameters:**
- model: claude-opus-4-7
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-opus-4-7
- duration: 48.7s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 48 (— used)
- Output — budget: — | actual: 4,117 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (5,698 tokens written to cache)

---

### build-plan-requirements [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 4000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 20.7s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 23 (— used)
- Output — budget: — | actual: 1,094 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (6,493 tokens written to cache)

---

### build-plan-build-order [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 16000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 42.2s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 2,181 (— used)
- Output — budget: — | actual: 2,131 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-mermaid-diagram [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 32000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 7.8s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 2,418 (— used)
- Output — budget: — | actual: 470 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-build-summary [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 24000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 36.8s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 2,191 (— used)
- Output — budget: — | actual: 1,987 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-out-of-band [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 24000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 48.1s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 2,270 (— used)
- Output — budget: — | actual: 2,388 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-gate-checklists [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 16000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 28.9s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 2,208 (— used)
- Output — budget: — | actual: 1,604 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-brief-S0-A [primary]

**Request Parameters:**
- model: claude-opus-4-7
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-opus-4-7
- duration: 1m 16s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 297 (— used)
- Output — budget: — | actual: 5,770 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (13,226 tokens written to cache)

---

### build-plan-brief-S1-A [primary]

**Request Parameters:**
- model: claude-opus-4-7
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-opus-4-7
- duration: 1m 27s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 272 (— used)
- Output — budget: — | actual: 6,678 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (13,226 tokens written to cache)

---

### build-plan-brief-S2-A [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 2m 3s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 181 (— used)
- Output — budget: — | actual: 6,573 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (9,510 tokens written to cache)

---

### build-plan-brief-S2-B [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 1m 47s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 175 (— used)
- Output — budget: — | actual: 5,752 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (9,510 tokens written to cache)

---

### build-plan-brief-S2-C [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 1m 38s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 175 (— used)
- Output — budget: — | actual: 4,926 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (9,510 tokens written to cache)

---

### build-plan-brief-S2-D [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 64000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 1m 41s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 180 (— used)
- Output — budget: — | actual: 5,140 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: Yes (9,510 read, 0 written)

---

### build-plan-ownership-commentary [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 6000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 13.4s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 752 (— used)
- Output — budget: — | actual: 572 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-consistency-check [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 16000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 1m 24s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 4,044 (— used)
- Output — budget: — | actual: 4,815 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-dry-run [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 32000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 25.4s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 1,016 (— used)
- Output — budget: — | actual: 1,520 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

### build-plan-decomp-critic [primary]

**Request Parameters:**
- model: claude-sonnet-4-6
- max_tokens: 6000
- thinking: adaptive

**Response Metadata:**
- stop_reason: end_turn
- model (returned by API): claude-sonnet-4-6
- duration: 20.7s

**Token Budget vs Actual:**
- Input  — budget: — | actual: 3,956 (— used)
- Output — budget: — | actual: 945 (— used)
- Budget exceeded: No

**Cache:**
- Cache hit: No (0 tokens written to cache)

---

## Debug: User Stories Sub-call Timing

*(user stories not run)*

---

## Debug: Memory / Learnings

*(no learnings recorded)*