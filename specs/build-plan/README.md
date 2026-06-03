# HyperSpeed Autonomous Build — Runner

> **30 sessions ≈ $50–$300 in API spend, 1–3 days wall clock.**
> Best Option: Open this folder in Claude Code and ask it to open the README.md file and run through setup with you.

This directory is the executable artifact emitted from a HyperSpeed Team `--generate-build-plan` run. The runner turns per-session implementation briefs into one PR per session, wave by wave. The numbers above are a rule of thumb — your plan's [`autonomous-build-plan.md`](./autonomous-build-plan.md) carries a per-project **Estimated cost** line; trust that over the rule of thumb.

## Start here

0. **Greenfield repos only (no committed `package.json`/`pyproject.toml`/…):** seed the project manifest onto the base branch *before* anything else, so every Wave 0 worktree can install:
   ```bash
   git checkout main          # the base branch worktrees branch from
   node build-plan/run-build.mjs --seed-base
   ```
   This drops the complete manifest stub (emitted at `bootstrap/<manifest>`), runs the install to generate the lockfile, and commits + pushes both to the base branch. It is idempotent — if the manifest already exists on the base branch it does nothing, so brownfield repos can skip this step (and `--check-env` will tell you if you needed it). Do this **before** enabling branch protection, since it pushes directly to the base branch. See [Greenfield bootstrap](#greenfield-bootstrap-109) below.
1. `node build-plan/run-build.mjs --check-env` — verifies every prerequisite (including that the project manifest is present on the base branch). Fix red ✗s before moving on.
2. Copy the emitted CI workflow + branch-protection script into your repo:
   ```bash
   cp specs/build-plan/.github/workflows/session-tests.yml .github/workflows/
   bash specs/build-plan/setup-branch-protection.sh
   ```
   Then enable **Settings → General → "Allow auto-merge"** on the repo (#115). The
   runner enables GitHub auto-merge on every session with no manual ACs, so those
   PRs self-merge the moment CI is green — no operator click. `--check-env` warns
   if the setting is off and the plan has any auto-mergeable session.

   > ⚠ **What to commit — and what NOT to (especially for public repos).** CI needs
   > only **two data files** committed from the build-plan directory:
   > `run-manifest.json` (the `test` job looks up each session's `test.cmd`) and
   > `node-compat.eslint.config.mjs` (the compat step), plus the workflow above.
   > **Do not commit the rest of `build-plan/`** — `run-build.mjs` (the proprietary
   > runner), `run-build.md`, `setup-branch-protection.sh`, `lib/`, and especially
   > `section5-briefs/` (every implementation brief) and `autonomous-build-plan.md`.
   > The emitted `.gitignore` (step below) already excludes them. If your target
   > repo is — or might become — **public**, committing those would publish the
   > runner internals and all your briefs. Either commit only the two data files +
   > the workflow, **or** run the runner from its source dir with
   > `HS_REPO_ROOT=/path/to/target-repo` so no runner code ever lands in the repo.
3. `node build-plan/run-build.mjs --wave 0` — runs the first wave to test the full loop on a small batch.
4. Sessions with **no** manual ACs auto-merge themselves once their CI passes — you do nothing. Sessions **with** `[MANUAL]` acceptance criteria are left open: the runner prints the checklist, and you tick the boxes and merge those PRs by hand.
5. Once wave 0's PRs are merged, continue the build. We strongly recommend running one wave at a time and addressing any issues before continuing:
   ```bash
   # Recommended — one wave at a time, review PRs between each:
   node build-plan/run-build.mjs --wave 1
   node build-plan/run-build.mjs --wave 2
   # ...and so on

   # Full unattended — only once several waves have gone end-to-end clean:
   node build-plan/run-build.mjs --auto-advance always
   ```

For unattended overnight runs, set `--max-cost N` to cap spend.

## Two ways to run

**Default — supervised in Claude Code.** Load [`run-build.md`](./run-build.md) into Claude Code; it drives the runner wave-by-wave, surfaces failures, and asks for manual sign-offs. Best for first builds and any time you want eyeballs on the loop. It shells out to `run-build.mjs --wave N` via the Bash tool — it does **not** spawn sub-agents.

**Power user — headless.** Run `node run-build.mjs` directly in a terminal. Best for CI integration and unattended overnight runs.

Both consume the same `run-manifest.json` and produce the same PRs.

## Three modes

| Mode | Command | When |
| --- | --- | --- |
| Dry preview | `node build-plan/run-build.mjs --dry-run` | Before firing anything — see the wave plan |
| One wave at a time | `node build-plan/run-build.mjs --wave N` | Recommended default. Supervised loop — review each wave's PRs before advancing. |
| Full unattended | `node build-plan/run-build.mjs --auto-advance always --max-cost <cap>` | This is not recommended until you have done a few projects and found the per wave runs successful. |

Most first-time users want the middle row - run one wave, review its PRs, then advance. Jump to full-unattended only once at least 2 waves have gone end-to-end clean.

## What you'll see / what you won't see

While the runner is working:
- **Wave-start line** with a typical-duration estimate (e.g. `▶ Feature wave (phase 2) — 13 session(s) — typical 30–90 min`).
- **Heartbeat lines** every 5 minutes per in-flight session (e.g. `· S2-J 18m elapsed — log: 14s ago — 7 file(s) touched`). These prove the runner is alive during long sessions.
- **Immediate failure lines** if a session fails — printed the moment it happens, not buffered to end-of-wave.
- **Wave-end mini-summary** with succeeded/failed counts, wall clock, and spend.

What you won't see:
- Per-tool-call output from `claude` (it would flood the terminal). That goes into `.bp-worktrees/<run-id>/<id>/session.log`. Tail any session log in another terminal:
  ```bash
  tail -f .bp-worktrees/<run-id>/<id>/session.log
  ```
- Mid-session progress narration. Sessions take 15–60 min each; the heartbeat is your "alive" signal between start and end.

If you go more than 10 minutes without **any** output, something is genuinely stuck — Ctrl-C, check the worktree state, and re-run.

## Human sign-off — `[MANUAL]` ACs

Some acceptance criteria can't be auto-verified (screenshots, accessibility, vibe). The runner emits these in each PR's body as a `## Manual sign-off required` task list:

```markdown
## Manual sign-off required

The following acceptance criteria cannot be automatically verified. The reviewer must tick each box before merging.

- [ ] [US-001 AC-3] Login page screenshot matches design system.
- [ ] [US-002 AC-1] Accessibility audit clean.
```

GitHub renders these as interactive task lists. **Tick every box before clicking Merge.** This is a load-bearing part of the workflow — a `done` session is mergeable but not necessarily merge-*worthy*; only a human can sign off on `[MANUAL]` items, and no automation will catch a regression in them.

**The runner never auto-merges a session that has manual ACs** (#115) — it leaves the PR open and prints the checklist to its output so you know exactly what to verify. Only sessions with *no* manual ACs get `gh pr merge --auto --squash`, self-merging on green CI. In an unattended full run (`--auto-advance always`), a wave that contains manual-AC sessions will still need you to merge those PRs before the integration gate can pass — so prefer `--auto-advance never`/`on-green`, or per-wave runs, whenever a wave has manual ACs.

## Staying current with the base (#120)

Sessions don't drift from a stale snapshot of `main`:

- **Branch from latest.** Each session's worktree is created from the freshly-fetched `origin/<base>` (not a frozen wave-start commit), so a session that starts after a sibling already merged picks up that sibling's changes.
- **Reconcile before the PR.** After a session's test passes and before its PR opens, the runner merges the latest `origin/<base>` into the worktree. If `package.json` conflicts (two sessions each adding dependencies — the one file multiple sessions legitimately touch), it **merges both dependency sets** (union; the session's version wins a genuine version clash) and regenerates the lockfile with an `install`, rather than a blind `--ours` that would silently drop a sibling's packages. It then re-runs the session's own test against the integrated tree. A conflict in any *other* file is a real ownership clash and fails the session. Non-node manifests aren't auto-merged — a conflict there fails the session with a clear message.
- **Auto-recover a conflicting PR.** Sessions that finish *simultaneously* both open PRs before either merges, so the pre-PR reconcile is a no-op and the conflict only appears after a sibling merges (GitHub marks the PR `DIRTY`). The runner detects this while waiting for auto-merges and **automatically recovers** it: re-checks-out the pushed branch, runs the same union reconcile, re-pushes, and re-arms auto-merge (CI re-runs, then it self-merges). Recovery is bounded (3 rounds) and opt-out via `HS_NO_AUTOMERGE_RECOVERY=1`. Only a *true* ownership conflict (or a `CLOSED` PR) is unrecoverable — that fails the wave with a report naming the PR.

This is what keeps `gh pr merge --auto` from stalling on a `package.json` conflict, and is why a multi-session wave where several sessions add dependencies lands cleanly **without operator intervention** — even when they finish at the same instant.

## When something fails

### A session's independent test failed
The runner halts the wave, prints the failure line + log path.
1. Read the log: `cat .bp-worktrees/<run-id>/<id>/session.log`
2. If the brief was wrong, regenerate that brief and re-run the wave. The runner skips `done` sessions and force-cleans the failed worktree.
3. If the test was wrong, manually fix it in the worktree branch and push.

### A session's PR has red CI
The runner already opened the PR; the test failed at GitHub.
1. Push the fix to the same branch: `bp/<run-id>/<session-id>`
2. Wait for CI to go green.
3. Mark the session done and resume:
   ```bash
   node build-plan/run-build.mjs --resume-from-pr <session-id>
   ```
   This verifies the PR's checks are green before marking it `done`; if they're not, it tells you which check is still failing and exits non-zero.
4. Continue with the next wave (`--wave N+1`, or re-run the full build — the now-`done` session is skipped).

### The integration gate failed
Phase 0's harness is broken, or a feature wave silently broke something the harness catches.
1. Read `wave-N-failure-report.json` for the exit code and stdout.
2. Fix the underlying issue. Often the harness itself needs an update.
3. Re-run the whole wave.

### A session got stuck (no output for a long time)
The runner has a **per-session watchdog** (#137). If a session's `claude` produces no log output **and** changes no files for `HS_SESSION_STALL_MS` (default **15 minutes**), the runner kills that session's `claude` process tree (only that one — never a blanket `claude` kill), marks it `failed` (error class `stalled`), writes the wave failure report, and lets the wave continue / the session retry on the next run. You no longer have to babysit with Ctrl-C.
- Tune the threshold with `HS_SESSION_STALL_MS=<ms>`; disable entirely with `HS_DISABLE_WATCHDOG=1`.
- A stall (like any unrecoverable halt) writes an `escalation-<n>.json` next to the failure report. Set `HS_ESCALATE_CMD="<command>"` to have the runner invoke a supervising agent with that file on a halt (it diagnoses + resumes — the runner hands off, it doesn't improvise the loop).

### The runner crashed mid-wave (SIGINT, OOM, etc.)
Resume is automatic.
1. Re-run the same command. `done` sessions are skipped; `failed`/`interrupted` sessions get worktree-cleaned and retried.

## Supported runtime contract (#137)

A build is only reproducible if the host meets a small contract. Preflight (`--check-env`) asserts it; this is the canonical list:

- **Native-OS Node** — on Windows, the native Windows Node, **not** WSL or git-bash Node (those have been observed unable to egress to `api.anthropic.com`, which hangs every spawned `claude`). Preflight warns if it detects a non-native Node.
- **`docker` on PATH and its daemon running** — required whenever the plan declares `requirements.services[]`. Preflight fails fast (not mid-wave) if the daemon is unreachable.
- **Free fixture host ports** — nothing else may be bound to a declared service's host port (e.g. 5432/6379). A leftover `bp-fixtures*` container is auto-reconciled; a foreign holder must be freed.
- **`gh` authenticated** + **`ANTHROPIC_API_KEY`/`claude` auth** present in the environment the runner launches from.
- **A non-shallow git store** — a shallow clone is auto-deepened; if that fails, fix it with `git fetch --unshallow`.
- **Concurrency** defaults to `2` on Windows (the `.git/config` worktree-add lock race) and `4` elsewhere; raise with `--max-concurrent-sessions N` / `HS_MAX_CONCURRENT_SESSIONS`.

## Hello-world — your first build

Before committing days to a full build, try a single wave on a real plan:

1. Generate a build plan for a small project (one with ~5–10 sessions).
2. `node build-plan/run-build.mjs --check-env` — should be green.
3. `node build-plan/run-build.mjs --dry-run` — verify the wave plan looks right.
4. `node build-plan/run-build.mjs --wave 0` — runs Phase 0 only. Typical: 10–20 minutes, 1–2 PRs opened, ~$2 spent.
5. No-manual-AC PRs auto-merge on green CI. For any PR with `[MANUAL]` boxes, tick them and merge by hand.
6. The runner waits for the auto-merged PRs to land and fast-forwards your local base branch before advancing — so the next wave and the integration gate run against the merged code.
7. If wave 0 worked end-to-end, advance one wave at a time, reviewing each wave's PRs before continuing:
   ```bash
   node build-plan/run-build.mjs --wave 1
   node build-plan/run-build.mjs --wave 2
   # ...and so on
   ```
   Only switch to unattended (`--auto-advance always`) once several waves have gone end-to-end clean.

## Glossary

- **Wave** — A barrier point in the build. Feature waves run multiple sessions in parallel; integration waves run a single project-level test gate that gates the next feature wave.
- **Session** — A single autonomous unit of work; one Claude Code child process opens one PR. Each session reads only its own brief.
- **Phase** — The R2 grouping number. Phase 0 is scaffold + integration harness. Higher phases depend on lower phases completing.
- **Integration gate** — A project-level test command that runs between feature waves to catch regressions the per-session tests miss.
- **Checkpoint** — A one-sentence observable behavior that proves a session's PR works. Goes into the PR description.
- **Independent Test** — A per-session test file written BEFORE the implementation (TDD). Must pass in isolation — no sibling session in the same wave needs to have merged first.
- **Manual AC** — An acceptance criterion that can't be automated (screenshot match, accessibility, vibe). Surfaces as a checkbox in the PR description for human sign-off.
- **Brief** — The per-session implementation prompt loaded into the `claude` child. Contains everything the session needs to build autonomously.

---

# Reference

Everything below is reference detail — the runbook above is enough to get a first build going.

## Files in this directory

| File | What it is |
| --- | --- |
| `run-manifest.json` | The wave-by-wave plan: feature waves (parallel sessions) interleaved with integration waves (project-level test gates). Don't edit by hand. |
| `run-build.mjs` | Node runner. Single execution engine. Runs all OS-level fan-out, worktree lifecycle, PR creation, gh backoff, resumability. Two entry surfaces: direct (`node run-build.mjs`) or supervised via `run-build.md`. |
| `run-build.md` | Claude Code-loaded prompt. Drives the runner wave-by-wave for supervised execution. Shells out to `run-build.mjs --wave N` per wave via the Bash tool. |
| `setup-branch-protection.sh` | One-shot script that configures required-status-check branch protection on `main` (visibility- and plan-aware). See the per-repo setup section below. |
| `.github/workflows/session-tests.yml` | Emitted CI workflow that runs each session's Independent Test on its PR. Copy into your repo's `.github/workflows/`. |
| `.gitignore` | Snippet excluding runtime artifacts. Merge into your repo's top-level `.gitignore`. |
| `section5-briefs/` | Per-session implementation briefs. Each spawned `claude` child reads only its own brief (no PRD, no architecture, no siblings). |
| `autonomous-build-plan.md` | Top-level summary doc for humans. Not consumed by the runner. Carries the per-project cost estimate. |
| `run-state.json` *(created at runtime)* | Per-session status — enables resumability across restarts. |
| `wave-N-failure-report.json` *(created on halt)* | Structured failure context for the wave that failed. |
| `.bp-worktrees/` *(in your repo root, created at runtime)* | Isolated git worktrees, one per session. Cleaned automatically on session success or SIGINT. |
| `.bp-worktrees/<run-id>/<id>/session.log` *(in your repo root, created at runtime)* | Per-session log: claude + bootstrap + test output. Created when the session starts; removed with the worktree on success; preserved for inspection on failure. |

## One-time per-repo setup (required for PR gating)

The runner opens a PR per session. Those PRs do **not** enforce their Independent Test by themselves — that's a GitHub-side concern. Each item below is labeled **hard** (the build breaks or the gate is defeated without it) or **soft** (optional / situational).

### `gh` CLI authed — **hard**

The runner uses the `gh` CLI for PR creation and halts if it isn't authenticated. Either:

- `gh auth login` once, interactively, on the machine that runs the build, OR
- Export `GH_TOKEN=<personal-access-token>` with `repo` scope.

The runner wraps `gh` mutations in exponential backoff (3 attempts, 5s/15s/45s) on 403/429, so transient rate limiting won't fail a build — but **persistent auth failures will halt the wave**.

### CI workflow committed — **hard**

PR gating is the whole point; without the workflow, PRs merge with no test enforcement. The generator emits a working `.github/workflows/session-tests.yml` tailored to your project's toolchain. Copy it in and commit it alongside the manifest:

```bash
cp specs/build-plan/.github/workflows/session-tests.yml .github/workflows/
git add .github/workflows/session-tests.yml
git commit -m "ci: add HyperSpeed session-tests workflow"
```

The workflow detects which runtimes your project needs (Node, Python, Go, Ruby) from `run-manifest.json`'s `requirements.runtimes[]` and emits the appropriate `actions/setup-*` step for each. It also renders your `requirements.workspaceInstall[]` commands as shell `run:` steps so CI matches what the runner bootstraps. Each session's PR branch is `bp/<run-id>/<session-id>`; the workflow parses the session id from the branch name and looks up `test.cmd` from the checked-in manifest. It triggers on **both** `pull_request` and `push` to `bp/**` (#114): the `push` trigger guarantees CI fires for every session even when `pull_request` webhooks are dropped during a burst of parallel-wave PRs, while `pull_request` still gates merges.

**Node API compat gate (#111).** For Node projects, a *Node API compat check* step runs **in CI**, inside the required `test` job (no extra branch-protection config), keyed off the seeded `package.json` `engines.node` floor (kept in lockstep with `requirements.runtimes` node major — the generator hard-fails if they drift) via the emitted `node-compat.eslint.config.mjs`. It lints the files each PR changed for Node built-in / ES APIs newer than the floor — so a too-new built-in (e.g. `fs.globSync`, added in Node 22, on an `engines.node: ">=20"` project) fails the required check and blocks merge. Only a genuine lint violation (eslint exit 1) fails it; a tooling/config error (exit 2+) is logged and skipped. It runs with `--no-inline-config` (it runs *only* the `n/*` builtin-floor rules, so it ignores any inline `@typescript-eslint/*` disable directives in your code) and installs a flat-config-capable eslint ad hoc (peer-safe) when absent.

> The runner used to *also* run this lint in-loop inside each worktree. That in-loop duplicate was removed (#136, charter #138 tenet 2): CI already lints in a clean container, so re-deriving it in the runner only added a heuristic surface (it carried the shallow `--depth=1` fetch that broke base reconciliation, an unbounded arg list, and a false "unknown rule" failure on inline directives). CI is now the single owner of this gate.

The CI step runs only the emitted `node-compat.eslint.config.mjs` (it is *not* your project's own lint config) and locates it under the committed build-plan directory the same way it locates `run-manifest.json` — so as long as you commit those **two data files** (`run-manifest.json` + `node-compat.eslint.config.mjs`) no extra copy is needed. You do **not** need to (and should not) commit the rest of `build-plan/` — see the "What to commit" callout in [Start here](#start-here).

A `.gitignore` snippet is also emitted at `specs/build-plan/.gitignore`. Merge it into your repo's top-level `.gitignore`: it excludes the runtime artifacts (`.bp-worktrees/`, `run-state.json`, the runtime `.bp-services.compose.yml`, etc.) **and** the build-plan files that must never be published (the runner, `setup-branch-protection.sh`, and every brief under `section5-briefs/`) — so a `git add .` can't accidentally publish the runner internals or your briefs into a public repo (#132 G).

The integration-wave gate is the project-level `integrationCmd` (see `run-manifest.json`). The runner invokes it directly on the host before advancing to the next feature wave; CI doesn't need a separate integration job unless you want a second layer.

### Branch protection — **hard for unattended runs, soft if you'll watch CI manually**

Without required-status-check protection, a PR can be merged before its CI job finishes — defeating the test gate. If you're babysitting every merge by hand you can skip this; for unattended runs it's required.

The generator emits **`setup-branch-protection.sh`** next to this README. It's visibility- and plan-aware — it uses classic branch protection on public repos (and private repos on a paid plan) and falls back to repository rulesets on private repos under the Free plan (where classic protection 403s). It also validates that the required check context (`test`, matching the `jobs.test:` key in `session-tests.yml`) exists, and verifies it after applying:

```bash
bash specs/build-plan/setup-branch-protection.sh
```

Run it once with admin permissions on the repo. A mismatched context name silently passes setup and lets PRs merge without the gate firing, so prefer the generated script over a hand-rolled `gh api` call — it keeps the context name in lockstep with the emitted workflow.

### `ANTHROPIC_API_KEY` — **soft**

Only `hyperspeed --score-briefs` needs it directly; the spawned `claude` CLI uses its own auth. Preflight reports its absence as informational, not a failure.

## Toolchain prerequisites & worktree bootstrap (A1)

Plans emitted with HyperSpeed v0.10.42+ include a `requirements` block in `run-manifest.json` declaring what the project actually needs to install. The runner uses it two ways:

**Host binaries — detect-only.** Anything listed in `requirements.hostBinaries[]` (e.g., `git`, `gh`, `claude`, `docker`, `poetry`) must already be on PATH. The runner checks this at startup, before any worktree is created, and halts with a per-tool install hint if any are missing. The runner will **never** install host binaries automatically — they touch the user's machine in ways that need consent.

Example halt output:
```
✗ Host binary check failed — required tools missing from PATH:
  ✗ docker — install from https://docs.docker.com/get-docker/
  ✗ poetry — install from https://python-poetry.org/docs/#installation

Install the missing tool(s) and retry. The runner does not install host binaries automatically.
```

**Workspace installs — auto-run, marker-gated.** `requirements.workspaceInstall[]` lists commands the runner executes inside every fresh worktree before spawning Claude Code. Each entry has a `marker` path — if the marker already exists (e.g., `node_modules/.package-lock.json`), the install is skipped. Side effects are contained to `.bp-worktrees/<id>/`, so re-runs and retries don't repeat work.

`requirements.sessionInstall[<session-id>][]` adds per-session extras (e.g., building a fixture Docker image needed by one integration session only).

Bootstrap failures mark the session `failed` with an error prefixed `bootstrap_failed:` — distinct from `test_failed` so failure reports point at the right gap (a broken `pyproject.toml` vs an actually-failing test).

If the manifest has no `requirements` block (legacy plans), bootstrap is a no-op and the host check is skipped.

## Greenfield bootstrap (#109)

On a **greenfield** repo — one with no committed project manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`) on the base branch — there is a chicken-and-egg problem. Every Wave 0 worktree branches off the (empty) base branch and runs its workspace install (`npm ci`, …) *before* Claude spawns. But the session that *creates* the manifest hasn't run yet, and its sibling sessions in the same wave can't see it across worktree isolation. Result: `npm ci` fails instantly, every Phase 0 session is `bootstrap_failed`, and Wave 0 exits in seconds without ever spawning Claude.

The fix is to put a complete manifest + lockfile on the base branch *before* Wave 0:

- The generator emits a **complete dependency stub** at `bootstrap/<manifest>` (every dependency the whole project needs — frontend, backend, and harness — not just the harness session's own) and records it in `run-manifest.json` as `projectManifestStub`.
- `node build-plan/run-build.mjs --seed-base` (run on the base branch) drops that stub at its path, runs `seedInstallCmd` (e.g. `npm install`) to resolve dependencies and generate the lockfile, then commits + pushes both to the base branch. It is **idempotent** — if the manifest already exists on the base branch it does nothing.
- `--check-env` checks for this: on a greenfield base branch it fails with `Greenfield repo: "main" has no package.json … run --seed-base`. After seeding it passes with `Project manifest present on "main"`.

Phase 0's manifest-owning session still runs and reconciles/completes the manifest in its PR — the seed is just the starting point that lets every Wave 0 worktree install. Run `--seed-base` **before** enabling branch protection, since it pushes directly to the base branch.

## Fixture services for integration tests (#132)

If `run-manifest.json` declares `requirements.services[]` (databases, caches, etc.
that integration tests need — emitted by the generator when the plan has any
`tests/integration` session), the runner brings that stack up **locally** before
the wave(s) and tears it down after, so a session's `test.cmd` (e.g. `npm run
test:integration`) has its backing stores without you hand-propping a stack:

- It writes a runtime `.bp-services.compose.yml` in your repo root (gitignored)
  from the declared services, **reconciles any leftover stack first** (`docker
  compose -p bp-fixtures down -v` + a name-filtered `docker rm -f` sweep — so the
  DB starts empty every run and a crashed prior run can't squat the port), runs
  `docker compose up -d --wait` (waiting on built-in health checks for
  Postgres/Redis/MySQL/Mongo), and `down -v` on every exit path — including Ctrl-C.
- **Connection env contract (#137):** the runner exports the resolved connection
  strings (`DATABASE_URL`, `REDIS_URL`, and `PGHOST`/`PGPORT`/… per service) into
  the environment your `claude` child + every `test.cmd` see, derived from the
  declared image + `env` + `ports`. Code that reads `process.env.DATABASE_URL`
  connects to the fixtures **without needing its own fallback**. The export is
  non-clobbering — if you already exported your own value (or run a stack on a
  different port), yours wins. CI mirrors the same contract as a job-level `env:`
  block. Declare `ServiceRequirement.connectionEnv` to override the derivation.
- **Fail-closed (#137):** if services are declared and the stack does **not** come
  up, the runner refuses to start (a service-dependent test must not run against a
  stack that never started). `--check-env` diagnoses the cause first (docker
  daemon down, a bound port, leftover containers). Override with
  `HS_FIXTURES_BEST_EFFORT=1` to restore the old warn-and-continue behavior.
- `HS_SKIP_FIXTURE_SERVICES=1` bypasses bring-up — set this if you run your own
  stack (e.g. a shared Postgres/Redis already up on the host). The connection-env
  contract is still exported (non-clobbering) so your tests connect.
- The same services are provisioned in CI via the emitted workflow (native
  GitHub Actions `services:` + a compose fixtures file + the `env:` block).

> Note: the local stack is **shared** across the wave's parallel sessions. If a
> wave runs several service-dependent sessions at once against one database, lower
> `--max-concurrent-sessions` (or split them across waves) to avoid cross-test
> interference. Per-session unit tests are unaffected.

## Preflight environment check (`--check-env`)

`node build-plan/run-build.mjs --check-env` walks every prerequisite a build needs and prints one green ✓ or red ✗ line per check, exiting 0 only if all pass. It is **also auto-invoked at the start of every run** (use `--skip-env-check` to bypass) so a missing tool can't quietly take down session 1 of wave 0.

The same checks back both surfaces. What gets verified:

| Class | Checks |
| --- | --- |
| Repo / git state | `HS_REPO_ROOT` is a git repo · current branch matches `HS_BASE_BRANCH` (default `main`) · `origin` remote configured · **shallow repo auto-deepened** (`git fetch --unshallow`; only a *failed* unshallow is fatal — #137) |
| Host runtime (#137) | **Native-OS Node** (warns if launched under WSL/git-bash on Windows — that Node has been seen unable to reach `api.anthropic.com`, which hangs every `claude`) |
| Fixture host hazards (#137, only when `requirements.services[]` is declared) | **docker daemon reachable** (`docker info`, not just `docker` on PATH) · every fixture **host port is free** (a foreign container / process is fatal with its PID; a leftover `bp-fixtures*` container warns — it's auto-reconciled at bring-up) · leftover fixture containers surfaced |
| Tooling auth | `gh` on PATH and `gh auth status` succeeds · `claude` (or `HS_CLAUDE_CLI`) on PATH and `--version` runs · `ANTHROPIC_API_KEY` present (informational — required only for `hyperspeed --score-briefs`) |
| Manifest integrity | `run-manifest.json` parses · every session's `brief` path exists on disk · every `ownedFiles` entry is a legal repo-relative path (no `..`, no absolute) |
| Requirements (A1) | every `requirements.hostBinaries[]` resolves on PATH (with the install hint declared in `HOST_BIN_HINTS`) · every `requirements.runtimes[]` satisfies its declared version (parsed from `node --version` / `python --version` / etc., compared as `major[.minor]` floor — see `checkRuntimeVersion` in `run-build.mjs` for the exact rule) · `workspaceInstall[]` / `sessionInstall[]` are **not** executed (that's the runner's job during bootstrap) |
| Integration cmd (C1) | the leading binary of `manifest.integrationCmd` (e.g. `pytest` in `pytest tests/integration`) resolves on PATH. Skipped for the empty string, inline shell scripts (`bash -c …`), and path commands (`./scripts/integration.sh`); npm-family commands defer to the runtime check above to avoid a double-report. |
| Phase 0 harness (C1) | structural re-check of the loaded manifest: exactly one Phase 0 session owns a project manifest (`package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `Gemfile`) · at least one Phase 0 session owns a `tests/integration`-style path · `manifest.integrationCmd` is non-empty. Duplicates the generator-side validator so a hand-edited manifest is still caught (skipped when the manifest has no feature waves). |
| Runner config | `intendedBuildModel` from manifest (warn if `HS_CLAUDE_CLI_ARGS` sets `--model` explicitly) · resolved concurrency · resolved cost cap · resolved auto-advance policy |

Example failure output:
```
✓ Repo root is a git repo (/home/me/project)
✓ Current branch is "main"
✓ origin remote configured (git@github.com:foo/bar.git)
✓ gh CLI authenticated
✓ claude CLI present (claude-cli 1.2.3)
✓ run-manifest.json parses (7 waves)
✓ All session brief files exist on disk
✓ All ownedFiles are legal repo-relative paths
✗ Missing host binary: poetry — install from https://python-poetry.org/docs/#installation
→ Concurrency: 4 sessions in parallel (set via HS_MAX_CONCURRENT_SESSIONS)
```

`--dry-run` skips preflight (the dry-run preview should work without any tooling installed). Every other entry point (`--wave N`, no-flag full run) runs preflight first unless `--skip-env-check` is passed.

## Resumability

`run-state.json` is rewritten after every session transition. If the runner exits cleanly (success or `gh halt`), you can re-run the same command — `done` sessions are skipped, `failed` / `interrupted` sessions get their worktrees force-removed before retry. SIGINT / SIGTERM cleans up worktrees of in-progress sessions before exit (exit code 130).

If `run-state.json` survives across `git pull`s or branch switches, that's fine — the runner reconciles against the current manifest.

To mark a single session `done` after you fixed its PR's CI out-of-band, use `--resume-from-pr <session-id>` (see [When something fails](#when-something-fails)).

## Cost cap (`--max-cost`)

The runner parses the per-session cost printed by the `claude` CLI and accumulates it into `run-state.json` (`costUsd` per session, `totalCostUsd` for the run). Every success/failure line shows `$X.XX (run total $Y.YY)`.

```bash
node build-plan/run-build.mjs --max-cost 50      # halt before any wave that would exceed $50
node build-plan/run-build.mjs --max-cost 0       # unlimited (default; same as omitting)
```

Before each feature wave the runner estimates the wave's cost (`wave size × mean cost of completed sessions`, or a `$5`/session default before any have completed) and refuses to start the wave if the projected total would exceed the cap — **before opening any worktree**. Already-completed sessions are never re-run; raise the cap and re-run to resume.

**Fail-open caveat:** if the `claude` CLI stops printing a parseable cost line, the runner prints a one-time `⚠ could not parse cost` warning and the cap falls back to the `$5`/session estimate. Cost tracking degrades gracefully rather than halting a build, so treat `--max-cost` as a guard rail, not a hard billing limit.

## Supervised wave pausing (`--auto-advance`)

```bash
node build-plan/run-build.mjs --auto-advance always     # default — never pause (unattended)
node build-plan/run-build.mjs --auto-advance on-green    # pause only after a wave with failures
node build-plan/run-build.mjs --auto-advance never       # pause at every wave boundary
```

In a TTY the runner prompts `Continue to wave N? [y/N]` between waves. In a non-TTY context (CI, pipe) a pause-worthy boundary exits 0 with a message telling you to use `--auto-advance always` for unattended runs, rather than hanging on a prompt. Pausing only applies to full runs — under `--wave N` (the supervised `run-build.md` driver) the runner never pauses, since the driver sequences waves itself.

## Brief Quality Scoring (optional pre-flight)

A separate command, `hyperspeed --score-briefs <build-plan-dir>`, runs a Haiku judge over every brief in `section5-briefs/` and grades it against the source specs on a six-dimension rubric. Use it as a pre-flight before you fire the runner — `[MANUAL]` vagueness, hand-waved Independent Tests, and under-specified `exports[]` blocks are the failure modes structural validators miss.

### How to run it

```bash
hyperspeed --score-briefs ./Projects/MyProject/specs/build-plan/
# Options:
#   --spec-dir <path>   default: parent dir of <build-plan-dir>
#   --threshold N       default: 20 — minimum total to count as "ship"
#   --output <path>     default: <build-plan-dir>/brief-quality-report.md
```

Cost is negligible (~$0.06 for a 15-session plan, single Haiku call per brief). Outputs:
- `brief-quality-report.md` — per-brief score table, dimension-level commentary, ship/borderline/regenerate roll-up.
- `brief-quality-report.json` — machine-readable sidecar consumed by the runner gate below. Each report records `scoredWithModel` (top-level and per brief) and, per dimension, a `{ score, comments }` object so downstream tools can act on *why* a brief scored low. The runner gate refuses a report whose `scoredWithModel` is present but empty.

### The six dimensions

| Dimension | Catches |
| --- | --- |
| Checkpoint specificity | Boilerplate "feature works" sentences that name no observable behavior. |
| Independent Test traceability | `test.cmd` that doesn't actually exercise the ACs listed. |
| Exports completeness | Missing exports the prose section names; vague shapes (`function`) that defeat `validateIntraWaveExports`. |
| Mocking contract realism | Shapes that contradict the architecture spec or are obviously placeholder. |
| AC fidelity | Silent paraphrasing or omission of source-story AC text. |
| Phase 0 harness usefulness *(S0 only)* | Smoke tests that don't touch real services; missing fixture exports. |

Each dimension is scored 0–5. Max total: 25 for normal briefs, 30 for Phase 0 (which adds the 6th).

### Threshold tuning

- **20** (default) — strict but achievable. Use for production builds where you want a real pre-merge bar.
- **18** — relaxed. Use early in a project when prompts are still being tuned and you want signal without blocking.
- **23+** — only realistic if you're iterating on the brief generator itself. A typical Haiku judge run hovers around 20–23 for well-formed briefs; pushing higher will flag too much.

A brief in the "borderline" band (threshold − 4 ≤ total < threshold) is salvageable — read the dimension comments to decide whether to regenerate or accept. Anything below that should be regenerated.

### Gating the runner (`--require-quality-score`)

Once a `brief-quality-report.json` exists, you can force the runner to refuse to fire on a low-quality plan:

```bash
node build-plan/run-build.mjs --require-quality-score         # threshold 20 (default)
node build-plan/run-build.mjs --require-quality-score 22      # custom threshold
```

If the JSON sidecar is **missing**, the runner first tries to generate it for you (`hyperspeed --score-briefs <dir>`, then `npx hyperspeed --score-briefs <dir>`); only if neither is reachable does it fail with the exact commands it tried. If any brief is below threshold (or errored at scoring time), the runner exits non-zero before opening any worktree. The gate runs once at startup, before reconcileState and before the first wave.

This flag is **opt-in** — without it the runner behaves exactly as before. It's intended as a power-user safety rail for unattended runs.

## Watching a running session (A4)

Each session writes a live log to `.bp-worktrees/<run-id>/<session-id>/session.log` in your repo root. It captures bootstrap installs, the full `claude` session, and the independent test — everything the session does, in order.

While the runner is executing a wave, open a second terminal and tail any session:

```bash
tail -f .bp-worktrees/<run-id>/<session-id>/session.log
```

Replace `<run-id>` and `<session-id>` with the values shown in the runner's output (e.g. `20260531143000` and `S2-J`).

**Failure lines print immediately.** When a session fails, the runner prints:

```
  ✗ S2-J failed at 0m45s (bootstrap_failed: "poetry install" exited 1 — ...) — log: .bp-worktrees/20260531143000/S2-J/session.log
```

This line appears at the moment the session fails — other sessions in the same wave keep running. The wave-level summary still prints at the end as before.

**Log cleanup.** On success, `session.log` is removed together with the worktree. On failure, the worktree (and its log) is preserved for inspection.

### Wave-level progress (C1)

Each feature wave brackets its session output with a start estimate and an end summary:

```
▶ Feature wave (phase 2) — 13 session(s) — typical 30–90 min
  ... per-session lines ...
✓ Feature wave 2 complete — 13/13 succeeded — 47m wall clock — $18.40 spent (run total $34.21)
```

The start estimate is derived from each session's R2 complexity bucket (S≈30 min, M≈60 min, L≈120 min): lower bound = the longest single session, upper bound = that × the number of serialized batches at the resolved concurrency. It is omitted for legacy manifests that don't carry per-session complexity. The end line reports succeeded/total (and `· K failed` on failure), wall-clock minutes, this wave's spend, and the run total — spend is snapshotted at wave start so resumed waves don't re-count already-done sessions.

### Heartbeat (C1)

Between wave start and wave end a session can run silently for 15–60 minutes. To prove the runner is alive, a heartbeat prints one line per in-flight session every 5 minutes (override with `HS_HEARTBEAT_INTERVAL_MS`):

```
  · S2-J 18m elapsed — log: 14s ago — 7 file(s) touched
```

It is **strictly filesystem + git**: `fs.stat` on the session's `session.log` for the last-write age and `git status --short` for a touched-file count — never a `claude`/heavy probe. Sessions younger than 5 minutes are skipped (no signal yet). The single timer is `unref`'d and cleared cleanly on wave end and on SIGINT/SIGTERM.

## Intended build model (`intendedBuildModel`)

Every manifest generated by HyperSpeed v0.10.42+ includes an `intendedBuildModel` field (default: `claude-sonnet-4-6`). The runner automatically appends `--model <id>` to every `claude` spawn so builds are reproducible regardless of the user's local `ANTHROPIC_MODEL` env or `~/.claude/settings.json`.

**Override at generation time:**
```bash
node dist/hyperspeed.js --generate-build-plan ./specs/ --intended-build-model claude-opus-4-7
```

**Override at run time** (highest precedence — completely replaces the manifest value):
```bash
HS_CLAUDE_CLI_ARGS="--dangerously-skip-permissions -p --model claude-opus-4-7" node build-plan/run-build.mjs
```

`--check-env` shows the resolved model and warns if `HS_CLAUDE_CLI_ARGS` overrides the manifest value.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `gh: command not found` | gh CLI not installed on the runner host | Install `gh` and `gh auth login` (or set `GH_TOKEN`). |
| `error: no such ref: main` during worktree add | Default branch isn't `main` | Set `HS_BASE_BRANCH=master` (or your default) in env before running. |
| Persistent 403 from gh | Token missing `repo` scope, or org SSO not authorized | Re-issue token with `repo`; authorize SSO in token settings. |
| Branch-protection setup 403s on a private repo | Free-plan repos can't use classic branch protection | Run the emitted `setup-branch-protection.sh` — it auto-falls back to rulesets. |
| Sessions failing with "claude: command not found" | Claude Code CLI not in PATH | Install Claude Code CLI; or set `HS_CLAUDE_CLI=/path/to/claude` in env. |
| Want to point at a non-cwd repo | Default is `process.cwd()` | Set `HS_REPO_ROOT=/path/to/repo` in env. |
| ENOSPC / "no space left on device" mid-wave | `.bp-worktrees/` accumulates per-worktree `node_modules`, `.venv`, Playwright browsers, etc. A 13-session wave can consume 30–80 GB. | Free disk before starting; or run with `--max-concurrent-sessions 2` to limit concurrent worktrees; or set `HS_REPO_ROOT` to a path on a larger volume. |

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `HS_CLAUDE_CLI` | `claude` | Override the Claude Code CLI binary. |
| `HS_CLAUDE_CLI_ARGS` | `--dangerously-skip-permissions -p` | Override the args passed to the CLI. The brief is piped via stdin. If this includes `--model`, it takes precedence over `intendedBuildModel` in the manifest. |
| `HS_REPO_ROOT` | `process.cwd()` | The repo into which worktrees and PRs are created. |
| `HS_BASE_BRANCH` | `main` | Expected base branch — preflight refuses to start on any other branch. |
| `HS_MAX_CONCURRENT_SESSIONS` | `4` | Cap parallel sessions per feature wave (`0` = unlimited). Superseded by `--max-concurrent-sessions`. |
| `HS_MAX_COST` | `0` (unlimited) | Halt before any wave whose projected total cost would exceed this many USD. Superseded by `--max-cost`. |
| `HS_AUTO_ADVANCE` | `always` | Wave-advance policy: `always` \| `on-green` \| `never`. Superseded by `--auto-advance`. |
| `HS_HEARTBEAT_INTERVAL_MS` | `300000` (5 min) | Interval between per-session heartbeat lines printed during a feature wave. |
| `HS_SKIP_FIXTURE_SERVICES` | — | When set, the runner does NOT start `requirements.services[]` locally (#132) — use it if you run your own Postgres/Redis/etc. stack. |
| `GH_TOKEN` | — | Used by `gh` if `gh auth login` isn't set up. |

## Need to bail mid-build?

`Ctrl-C` once. The runner's SIGINT handler will:
1. Mark every in-progress session `interrupted` in `run-state.json`.
2. Force-remove their worktrees.
3. Exit 130.

On the next run, those sessions are retried from a clean worktree. `done` sessions are skipped.
