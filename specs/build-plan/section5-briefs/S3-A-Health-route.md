#### S3-A — Health route

**Phase 3 | Backend API | Needs: S0-A**

##### Objective

Implement the `GET /health` endpoint that returns `200 { "status": "ok" }`, providing operators and load balancers a reliable liveness check for the Canary Bookmarks API.

##### Scope

P0 MVP — all work in this session is P0. No P1 stubs required.

##### Technology constraints

- **Ruby 3.3** (declared floor — see runtime floor guidance below)
- **Sinatra** (`Sinatra::Base`) — route file reopens `Bookmarks::App`; do NOT create a new Sinatra application
- **`pg` gem** — database driver (runtime dep; not directly used by health route but available)
- **RSpec** — test framework; test file lives at `tests/integration/health_spec.rb`
- **`rack-test`** — HTTP test adapter for RSpec integration specs
- Do NOT use `Sinatra::Application` (classic style) — the project uses modular style (`Sinatra::Base` subclass `Bookmarks::App`)
- Do NOT use any Ruby stdlib API introduced after Ruby 3.3
- Do NOT use any gems not already declared in the `Gemfile` owned by S0-A

**Runtime floor — non-negotiable.** The declared runtime floor is **Ruby 3.3**. All code this session writes — implementation AND test files — MUST run on Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a later Ruby version (e.g., `Data.define` features, `it` as a numbered block parameter, or any method added after 3.3). CI is pinned to Ruby 3.3.

##### Performance targets

None — see downstream sessions. No SLA is specified for the health endpoint.

##### Pre-installed environment

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
> - **Runtimes:** `ruby 3.3` — **this version is the FLOOR, not just what is installed — CI runs on Ruby 3.3. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** `bundle install --path vendor/bundle`
> - **Session-specific installs run for S3-A:** none

Do NOT run `bundle install` in your implementation — it has already run. Do NOT re-declare dependencies in any setup or readme.

##### Owned files

- `app/routes/health.rb` — implementation of `GET /health`
- `tests/integration/health_spec.rb` — RSpec integration spec

##### Read-only imports

| Session | File | Symbols / contracts used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (reopened to register the route) |
| S0-A | `spec/spec_helper.rb` | Required at top of spec via `require_relative`; provides `Rack::Test` mixin, DB provisioning, `before(:each)` truncation |

##### Do not touch

- `app/app.rb` — owned by S0-A; route files reopen `Bookmarks::App` but never modify this file
- `Gemfile` — owned by S0-A
- `spec/spec_helper.rb` — owned by S0-A; single owner, never edited by feature sessions
- `config.ru` — owned by S0-A
- `.rspec` — owned by S0-A
- `Rakefile` — owned by S0-A
- `app/store.rb` — owned by S1-A
- `app/routes/bookmarks.rb` — owned by S2-A
- `tests/integration/bookmarks_spec.rb` — owned by S2-A
- `app/routes/tags.rb` — owned by S2-B
- `tests/integration/tags_spec.rb` — owned by S2-B
- `app/routes/status.rb` — owned by S3-B
- `tests/integration/status_spec.rb` — owned by S3-B
- `tests/integration/harness_spec.rb` — owned by S0-A
- `tests/integration/store_spec.rb` — owned by S1-A
- **`spec/spec_helper.rb`** (shared test registry / spec helper): single-owner-glob pattern — S0-A owns it; no feature session edits it. Put your spec file where the existing glob `tests/integration/**/*_spec.rb` already picks it up.

##### Architecture context

From the distilled specification, verbatim:

> **1.1 Shared contracts**
>
> Health response shape (`GET /health`):
> ```
> { "status": "ok" }
> ```
>
> Error response shape (all routes):
> ```
> { "error": String }
> ```

> **1.5 HTTP status code contracts**
>
> | Condition | Required code | Must never return |
> |---|---|---|
> | `GET /health` success | `200` | — |
> | Unknown route | `404` with `{ "error": String }` JSON body | — |

> **1.6 Route manifest**
>
> Backend API endpoints:
> - `GET /health`

> **1.8 Technology stack — selected choices only**
>
> | Layer | Choice | Architecturally irreversible reason |
> |---|---|---|
> | Runtime | Ruby 3.3 | Declared explicitly |
> | HTTP framework | Sinatra (`Sinatra::Base`) | Named in spec; `Bookmarks::App < Sinatra::Base` |
> | Test framework | RSpec | Integration specs under `tests/integration/`; CI gate is `bundle exec rspec tests/integration` |
> | HTTP test adapter | `rack-test` | Named explicitly as dev dependency |

> **1.11 Cross-session runtime patterns**
>
> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | `spec/spec_helper.rb` | Phase 0 | All RSpec specs across all phases | Analog of `vitest.workspace.ts`; must not be modified by feature sessions |

> **Session table notes on shared infrastructure:**
> Route files reopen `Bookmarks::App` to register endpoints — they never modify `app/app.rb`.
>
> `spec/spec_helper.rb` (S0-A) sets `ENV['DATABASE_URL'] ||= 'postgres://postgres:postgres@localhost:5432/canary_test'` BEFORE requiring `app/app.rb`, provisions schema once (`CREATE TABLE IF NOT EXISTS bookmarks ...; CREATE TABLE IF NOT EXISTS bookmark_tags ...`), and configures `Rack::Test` mixin. Per-spec isolation is row-level via `TRUNCATE` in `before(:each)`.

> **1.13 Feature scope — P0 vs P1**
>
> - **Phase 3 — US-005:** `GET /health` → `200 { "status": "ok" }` (`app/routes/health.rb`)

##### User stories and acceptance criteria

From the distilled specification, verbatim:

> **US-005 — Health endpoint**
>
> *As an operator or load balancer, I want to call `GET /health` and receive `200 { "status": "ok" }` so I can confirm the API process is alive.*
>
> **AC-1:** `GET /health` returns HTTP status `200`.
> **AC-2:** The response body is valid JSON with exactly the key `"status"` set to the string `"ok"`.
> **AC-3:** The `Content-Type` response header contains `application/json`.

*(User story AC text reconstructed from spec sections 1.1, 1.5, 1.13 which collectively define the full contract for US-005.)*

##### UX and design specification

N/A — no frontend component. This is a backend-only JSON API endpoint.

##### Critical implementation notes

- **Reopen `Bookmarks::App`, never define a new app.** `app/routes/health.rb` must begin with `require_relative '../app'` (or equivalent path) and then `class Bookmarks::App` … `end` to reopen the existing class. Creating a new `Sinatra::Base` subclass will cause the route to be unreachable via `config.ru`.
- **JSON Content-Type.** `app/app.rb` (S0-A) sets the default JSON content-type for all responses at the base class level. The health route MUST NOT override `content_type` — it must rely on the base class setting. If for any reason the base class does not set it globally, the health route must call `content_type :json` explicitly. The AC requires `application/json` in the response header.
- **Response body must be exact JSON.** Return `{ "status": "ok" }` — use `JSON.generate({ status: "ok" })` or equivalent. Do not return a Ruby symbol value or non-string; the JSON key and value must both be strings.
- **HTTP status 200 must be explicit or default.** Sinatra returns 200 by default; no special `status 200` declaration is required, but do not accidentally set a different status.
- **No database interaction.** The health route is a pure liveness check — it must NOT query Postgres. Do not `require` or call `Store` in this route file.
- **Test file loads spec_helper.rb, not app directly.** The spec must begin with `require 'spec_helper'` (RSpec load path convention with `.rspec` setting `--require spec_helper`) or `require_relative '../../spec/spec_helper'`. It must NOT `require` `app/app.rb` directly — spec_helper sets `DATABASE_URL` before loading the app, and bypassing it will cause connection failures.
- **TDD workflow required.** Write `tests/integration/health_spec.rb` FIRST. Run it and confirm it fails (because `app/routes/health.rb` does not exist yet). Then implement. Re-run until green.
- **CI command is scoped to the full integration suite.** `bundle exec rspec tests/integration` runs ALL integration specs. The health spec must not break any other spec that was already green. However, since sibling Phase 2/3 sessions may not have merged, it is acceptable for this session's run to skip or fail specs for routes not yet implemented — the health spec itself must be green.
- **Isolation:** The test must pass when this session's PR is the only one merged. Since `GET /health` has no database dependency, it is fully isolated from Store and route files owned by other sessions. The spec must not call any other route or depend on any bookmark/tag data.

##### Mocking contract

Backend session — this session defines a real endpoint, not a mock. No inbound mocks required.

**Endpoint produced by this session:**

| Method | Path | Success status | Response body |
|---|---|---|---|
| `GET` | `/health` | `200` | `{ "status": "ok" }` |

**No external service contracts consumed** — the health route makes no database calls and depends on no other session's runtime output.

##### Acceptance criteria checklist

- [ ] `GET /health` returns HTTP status `200` [US-005 AC-1]
- [ ] Response body is valid JSON with key `"status"` set to string `"ok"` [US-005 AC-2]
- [ ] Response `Content-Type` header contains `application/json` [US-005 AC-3]
- [ ] The route is registered on the `Bookmarks::App` Sinatra application (not a separate app) [technical AC]
- [ ] The health route makes no database queries [technical AC]
- [ ] An unknown route (e.g. `GET /nonexistent`) still returns `404` with a JSON error body (base class behavior is not broken by this route file) [technical AC]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/health_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration/health_spec.rb`
- **Working directory** (`test.cwd`): repo root (omit; runs from repo root)
- **AC → assertion mapping**:
  - US-005 AC-1 → `it("returns HTTP status 200")`
  - US-005 AC-2 → `it("returns JSON body with status ok")`
  - US-005 AC-3 → `it("returns Content-Type application/json")`
  - Technical AC (no DB query) → `it("does not require a database connection")` — verified structurally (no Store require in route file) and by the test passing even without any seeded data
  - Technical AC (unknown route 404) → `it("returns 404 JSON for unknown routes")` — guards against accidentally breaking base class behavior

- **Fixtures / test doubles**: none — `GET /health` is stateless. The `spec_helper.rb` (S0-A) provides `Rack::Test` mixin and TRUNCATE isolation; no seed data needed for this spec.

- **Pre-conditions**:
  - `spec/spec_helper.rb` must exist (owned by S0-A, pre-merged)
  - `app/app.rb` must exist and define `Bookmarks::App` (owned by S0-A, pre-merged)
  - `DATABASE_URL` environment variable available (set by spec_helper default: `postgres://postgres:postgres@localhost:5432/canary_test`)
  - Postgres service running on port 5432 (provisioned by CI native service)
  - `vendor/bundle` populated by `bundle install --path vendor/bundle` (done by runner pre-spawn)

- **Isolation rule**: `GET /health` has no database dependency and no dependency on any Phase 1 or Phase 2 routes. The test passes with only S0-A merged. It does not reference `Store`, `bookmarks`, or `tags`. ✓ Fully isolated.

- **No project-wide gate inside this test**: This spec file exercises only `GET /health` acceptance criteria. It does NOT run `bundle exec rubocop`, a full typecheck, or any project-wide gate. Project-wide concerns are enforced by CI separately.

- **Self-verify before finishing (REQUIRED)**: Do NOT end the session until you have run `bundle exec rspec tests/integration/health_spec.rb` and seen it pass (all examples green, 0 failures). Write the spec first, confirm it fails, implement, re-run until green.

**Example spec structure** (for implementer reference — adapt as needed):

```ruby
# tests/integration/health_spec.rb
require 'spec_helper'

RSpec.describe 'GET /health' do
  include Rack::Test::Methods

  def app
    Bookmarks::App
  end

  it 'returns HTTP status 200' do
    get '/health'
    expect(last_response.status).to eq(200)
  end

  it 'returns JSON body with status ok' do
    get '/health'
    body = JSON.parse(last_response.body)
    expect(body['status']).to eq('ok')
  end

  it 'returns Content-Type application/json' do
    get '/health'
    expect(last_response.content_type).to include('application/json')
  end

  it 'does not require a database connection' do
    # Health route is stateless; passing with no seeded data proves no DB dependency
    get '/health'
    expect(last_response.status).to eq(200)
  end

  it 'returns 404 JSON for unknown routes' do
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

- **One-sentence observable outcome**: `GET /health` returns `200` with body `{"status":"ok"}` and `Content-Type: application/json` on the running Canary Bookmarks API server.
- **Shippability claim**: This PR is independently mergeable to main even if no other session in the same wave (S2-A, S2-B, S3-B) has merged. S3-A depends only on S0-A (pre-merged gate) and makes no database calls, so it is fully self-contained.

##### Output and handoff

This session produces no exports consumed by other sessions. The health route is a leaf endpoint.

| Artifact | Consuming sessions | Notes |
|---|---|---|
| `app/routes/health.rb` | None | Leaf endpoint; no downstream session imports it |
| `tests/integration/health_spec.rb` | None | Spec is self-contained |

No load-bearing exports.

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/health_spec.rb",
    "file": "tests/integration/health_spec.rb"
  },
  "checkpoint": "GET /health returns 200 with body {\"status\":\"ok\"} and Content-Type: application/json on the running Canary Bookmarks API server.",
  "manualAcs": [],
  "exports": [],
  "imports": [
    {
      "from": "S0-A",
      "file": "app/app.rb",
      "names": ["Bookmarks::App"]
    },
    {
      "from": "S0-A",
      "file": "spec/spec_helper.rb",
      "names": ["spec_helper"]
    }
  ],
  "sharedFiles": [
    {
      "path": "spec/spec_helper.rb",
      "strategy": "single-owner-glob",
      "note": "Phase 0 (S0-A) owns spec_helper.rb exclusively; feature sessions require it but never edit it."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Schema provisioned once by the Phase 0 harness (spec_helper.rb) before any parallel integration session runs; GET /health makes no DB calls but the Rack app still boots against the fixture DB."
    }
  ]
}
```