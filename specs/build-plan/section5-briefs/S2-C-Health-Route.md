#### S2-C — Health Route

**Phase 2 | Backend API | Needs: S1-A**

##### Objective

Implement the `GET /health` liveness endpoint in `app/routes/health.rb`, returning `{ "status": "ok" }` with HTTP 200, so operators can confirm the application is alive.

##### Scope

P0 MVP — all work in this session is P0. No P1 stubs required.

- **P0:** `GET /health` → `200 { "status": "ok" }` (US-005)

##### Technology constraints

- **Ruby 3.3** (floor) — do NOT use syntax or standard-library APIs introduced after Ruby 3.3.
- **Sinatra (`Sinatra::Base`)** — health route must be defined as a Sinatra route module/class, registered into `Bookmarks::App` via `app/app.rb`'s glob require. Do NOT subclass `Sinatra::Base` directly in the route file; register as a helper module or use `register`/`helpers` pattern compatible with the Phase 0 scaffold's glob `require` loader.
- **rack-test** — use `rack-test` (`include Rack::Test::Methods`) for integration specs; no other HTTP testing library.
- **rspec** — test framework; spec files must be runnable via `bundle exec rspec`.
- **`pg` gem** — runtime dep, but the health route does NOT call Postgres. Do not add a DB query.
- Do NOT use `Net::HTTP`, `Faraday`, `HTTParty`, or any other HTTP client in specs — use rack-test exclusively.
- Do NOT use Ruby APIs introduced after 3.3 (e.g., no `it` block shorthand for procs if not present in 3.3 — use explicit `do…end` or `{ }` blocks in RSpec).

**Runtime floor — non-negotiable.** Ruby 3.3. All implementation and test code must run on Ruby 3.3. Do not use standard-library APIs or syntax introduced in Ruby 3.4 or later.

##### Performance targets

None — see downstream sessions. No SLA is owned by this session directly.

##### Pre-installed environment

Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:

- **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
- **Runtimes:** `ruby 3.3` — **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than Ruby 3.3 in implementation OR test code (see Technology constraints).**
- **Workspace installs run:** `bundle install --path vendor/bundle`
- **Session-specific installs run for this session (S2-C):** none

Do NOT run `bundle install` or any gem installation command — it has already run. Do NOT re-declare dependencies in any setup or readme.

##### Performance targets

none — see downstream sessions.

##### Owned files

- `app/routes/health.rb` — implements `GET /health`
- `tests/integration/health_spec.rb` — RSpec integration spec for the health route

##### Read-only imports

| Owning session | File | What is used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra application class; glob-requires route files including `health.rb`) |
| S0-A | `spec/spec_helper.rb` | `require 'spec_helper'` — sets up rack-test, loads the app |
| S1-A | `app/store.rb` | NOT imported — health route does not use `Store` |

##### Do not touch

- `Gemfile` — owned by S0-A
- `spec/spec_helper.rb` — owned by S0-A; single owner, never edited after Phase 0
- `tests/integration/harness_spec.rb` — owned by S0-A
- `app/app.rb` — owned by S0-A; the glob require in `app/app.rb` auto-loads `app/routes/health.rb` — do not modify `app/app.rb`
- `app/store.rb` — owned by S1-A
- `tests/integration/store_spec.rb` — owned by S1-A
- `app/routes/bookmarks.rb` — owned by S2-A
- `tests/integration/bookmarks_spec.rb` — owned by S2-A
- `app/routes/tags.rb` — owned by S2-B
- `tests/integration/tags_spec.rb` — owned by S2-B
- `app/routes/status.rb` — owned by S2-D
- `tests/integration/status_spec.rb` — owned by S2-D
- **`vitest.workspace.ts` / `vitest.workspace.js`** — N/A (Ruby project; equivalent shared registry is `spec/spec_helper.rb`, owned by S0-A, never edited by feature sessions)

##### Architecture context

Verbatim from distilled spec:

> **Phase 3: Health route (`app/routes/health.rb`) — `GET /health` → `{ "status": "ok" }`**
>
> *(Note: the session table labels this Phase 2 for scheduling purposes; the feature scope document calls it "Phase 3" in the feature list. The owned file is `app/routes/health.rb` and session ID is S2-C.)*

From **1.5 HTTP status code contracts**:

> | Condition | Required code | Must never return |
> |---|---|---|
> | `GET /health` — liveness | `200` | — |

From **1.6 Route manifest**:

> - `GET /health`

From **1.1 Shared contracts**:

> **Error response shape** (all routes):
> ```ruby
> { "error" => String }
> ```

From **1.8 Technology stack — selected choices only**:

> | Layer | Choice | Architecturally irreversible reason |
> |---|---|---|
> | Runtime | Ruby 3.3 | Declared in spec; fixture targets Ruby ecosystem proof for #144 |
> | HTTP framework | Sinatra (`Sinatra::Base`) | Specified; `Bookmarks::App` subclasses `Sinatra::Base` |
> | Test framework | RSpec | Specified; integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration` |
> | HTTP test adapter | rack-test | Specified as dev dependency |

From **1.11 Cross-session runtime patterns**:

> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | `spec/spec_helper.rb` | Phase 0 (single owner, never edited after) | All RSpec sessions | Shared test registry; frozen after Phase 0 |

From **1.4 Critical ordering rules**:

> 1. **Phase 0 before all feature phases:** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
> 2. **Phase 1 before Phase 2/3:** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."

From the **Session Decomposition** (S2-C row):

> **Early-start optimizations:** S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold.

From **Phase-0 gate definition**:

> `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.

From **Intra-phase dependencies**:

> None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

##### User stories and acceptance criteria

**US-005 — Health liveness check**

> As an operator, I want `GET /health` to return `{ "status": "ok" }` with HTTP 200 so I can verify the application is alive.

Acceptance criteria:

- **US-005 AC-1:** `GET /health` returns HTTP status `200`.
- **US-005 AC-2:** Response `Content-Type` header includes `application/json`.
- **US-005 AC-3:** Response body, parsed as JSON, equals `{ "status": "ok" }` (exactly these fields, no extras required, but `status` key with value `"ok"` must be present).
- **US-005 AC-4:** The route is registered within the `Bookmarks::App` Sinatra application (i.e., it is reachable via the rack-test `app` helper that mounts `Bookmarks::App`).
- **US-005 AC-5:** An unknown route (e.g., `GET /nonexistent`) returns HTTP `404` with a JSON body containing an `"error"` key (this is enforced by `app/app.rb`'s 404 handler; the health spec must not break it).

*(US-005 AC-5 is a regression guard — the 404 handler is owned by S0-A's `app/app.rb`; this spec merely confirms health.rb does not accidentally shadow or override it.)*

##### UX and design specification

N/A — no frontend component. This is a backend-only route session.

##### Critical implementation notes

- **Route file structure:** `app/routes/health.rb` must be loadable via the glob `require` in `app/app.rb`. The file must define its route(s) in a way that registers them into `Bookmarks::App`. The idiomatic approach for a Sinatra glob-require scaffold is to define a module (e.g., `module HealthRoutes`) and register it, OR to reopen/extend `Bookmarks::App` directly inside the route file (e.g., `Bookmarks::App.get('/health') { ... }`), OR to define a Sinatra helpers/extensions block. **Do not define a new top-level `Sinatra::Base` subclass** — that would create a separate, unmounted app. Follow whatever pattern `app/app.rb` (Phase 0) establishes for glob-loaded route files.
- **JSON response:** Return `content_type :json` and `{ status: 'ok' }.to_json`. Do not use any external JSON library — Ruby's `json` stdlib (available in Ruby 3.3) is sufficient and is already loaded by Sinatra.
- **No database call:** The health route must not instantiate `Store` or touch Postgres. It is a pure liveness probe.
- **HTTP status code contract:** Must return exactly `200`. Never return `204`, `201`, or any non-`200` code on success.
- **spec_helper dependency:** `tests/integration/health_spec.rb` must begin with `require 'spec_helper'` (not a relative path like `require_relative`). The `spec/spec_helper.rb` file (owned by S0-A) configures the load path so `require 'spec_helper'` resolves. Do not attempt to load the app or configure rack-test yourself in the spec file.
- **Isolation:** This spec must pass when S2-A, S2-B, and S2-D have NOT yet merged. Do not call `/bookmarks`, `/tags`, or `/status` in `health_spec.rb`.
- **`bundle exec` prefix:** All RSpec invocations must use `bundle exec rspec` to resolve gems from `vendor/bundle`.
- **`.rspec` file:** Owned by S0-A; do not create or modify it.

##### Mocking contract

**Backend session** — this session depends on no internal events, queues, or external service interfaces beyond the already-provisioned Postgres instance (which the health route does not use). The rack-test adapter mounts `Bookmarks::App` in-process; no network mock is needed.

No mocking contract to declare. The health route makes no outbound calls and holds no external dependencies.

##### Acceptance criteria checklist

- [ ] `GET /health` returns HTTP status `200` [US-005 AC-1]
- [ ] `GET /health` response `Content-Type` header includes `application/json` [US-005 AC-2]
- [ ] `GET /health` response body parses as JSON and contains `{ "status" => "ok" }` [US-005 AC-3]
- [ ] Health route is reachable via the rack-test `app` helper mounting `Bookmarks::App` [US-005 AC-4]
- [ ] An unknown route (`GET /nonexistent`) still returns HTTP `404` with a JSON body containing an `"error"` key — health.rb does not shadow the 404 handler [US-005 AC-5]

##### Independent Test

**TDD workflow:** Write `tests/integration/health_spec.rb` first. Run it and confirm it fails (route not yet defined). Then implement `app/routes/health.rb`. Re-run until green.

- **Test file path:** `tests/integration/health_spec.rb`
- **Exact CI command:** `bundle exec rspec tests/integration/health_spec.rb`
- **Working directory (`test.cwd`):** repo root (no subdirectory needed)

**AC → assertion mapping:**

| AC | `it(...)` block |
|---|---|
| US-005 AC-1 | `it "returns HTTP 200"` |
| US-005 AC-2 | `it "returns Content-Type application/json"` |
| US-005 AC-3 | `it "returns body { status: ok }"` |
| US-005 AC-4 | `it "is reachable via Bookmarks::App"` (same as AC-1/AC-2/AC-3 — verified implicitly by all rack-test `get '/health'` calls going through `Bookmarks::App`) |
| US-005 AC-5 | `it "does not shadow the 404 handler for unknown routes"` |

**Fixtures / test doubles:**

- `spec/spec_helper.rb` (S0-A) — provides `app` helper returning `Bookmarks::App`, includes `Rack::Test::Methods`, sets `DATABASE_URL` if needed.
- No factories or row fixtures required — health route is stateless.
- No mocks or stubs — the route is pure Ruby, no external calls.

**Pre-conditions:**

- `bundle install --path vendor/bundle` must have run (already done by workspace install).
- `spec/spec_helper.rb` must exist and define the `app` method returning `Bookmarks::App` (provided by S0-A).
- `app/app.rb` must exist and define `Bookmarks::App < Sinatra::Base` with a glob require of `app/routes/**/*.rb` (provided by S0-A).
- No database migration required — health route is stateless.
- `DATABASE_URL` environment variable: not required by this route, but `spec_helper` may set it; spec must not fail if it is set or unset.

**Isolation rule:** This test must pass with ONLY S2-C merged (after S0-A and S1-A, which are prerequisites). It must not depend on S2-A, S2-B, or S2-D having merged.

**No project-wide gate:** Do not embed `system('bundle exec rubocop')`, `system('bundle exec rspec tests/integration')` (full suite), or any whole-tree check inside `health_spec.rb`. This spec covers only `GET /health`.

**Self-verify before finishing (REQUIRED):** Run `bundle exec rspec tests/integration/health_spec.rb` and confirm it exits 0 with all examples passing before ending the session. Do not finish with a red or never-executed test.

**Sample spec skeleton** (for reference — implement with real assertions):

```ruby
require 'spec_helper'

RSpec.describe 'GET /health', type: :request do
  include Rack::Test::Methods

  def app
    Bookmarks::App
  end

  it 'returns HTTP 200' do
    get '/health'
    expect(last_response.status).to eq(200)
  end

  it 'returns Content-Type application/json' do
    get '/health'
    expect(last_response.content_type).to include('application/json')
  end

  it 'returns body { status: ok }' do
    get '/health'
    body = JSON.parse(last_response.body)
    expect(body).to eq({ 'status' => 'ok' })
  end

  it 'does not shadow the 404 handler for unknown routes' do
    get '/nonexistent_route_xyz'
    expect(last_response.status).to eq(404)
    body = JSON.parse(last_response.body)
    expect(body).to have_key('error')
  end
end
```

##### Version control is the runner's job (do NOT push or open a PR)

**The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome:** After this session's PR is merged, `GET /health` on the running application returns `HTTP 200` with JSON body `{"status":"ok"}`, confirming application liveness.
- **Shippability claim:** This PR is independently mergeable to main even if no other session in Phase 2 (S2-A, S2-B, S2-D) has merged, provided S0-A and S1-A have merged.

##### Output and handoff

This session produces no shared exports that other sessions import directly. The health route file is loaded by `app/app.rb` (S0-A) via glob require at runtime, but no session imports symbols from `app/routes/health.rb`.

| Produced artifact | Consuming session(s) | Load-bearing? |
|---|---|---|
| `app/routes/health.rb` (file on disk, glob-required by `app/app.rb`) | S0-A (glob loader at runtime) | No — no symbol import; route is self-contained |
| `tests/integration/health_spec.rb` | CI only | No |

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/health_spec.rb",
    "file": "tests/integration/health_spec.rb"
  },
  "checkpoint": "GET /health returns HTTP 200 with JSON body {\"status\":\"ok\"}, confirming application liveness.",
  "manualAcs": [],
  "exports": [],
  "imports": [
    {
      "from": "S0-A",
      "file": "spec/spec_helper.rb",
      "names": []
    },
    {
      "from": "S0-A",
      "file": "app/app.rb",
      "names": ["Bookmarks::App"]
    }
  ],
  "sharedFiles": [
    {
      "path": "spec/spec_helper.rb",
      "strategy": "single-owner-glob",
      "note": "Phase 0 (S0-A) owns spec_helper.rb as a single-owner shared test registry; no feature session edits it — all specs require it read-only."
    }
  ],
  "sharedResources": []
}
```