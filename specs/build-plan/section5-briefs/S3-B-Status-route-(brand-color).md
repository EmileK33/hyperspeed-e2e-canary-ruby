#### S3-B — Status route (brand color)

**Phase 3 | Backend API | Needs: S0-A**

##### Objective

Implement the `GET /status` route in `app/routes/status.rb` that returns a JSON response with `version`, `uptime_seconds`, and the hardcoded brand color `#ff5d8f`, satisfying US-006.

##### Scope

P0 MVP — all work in this session is P0. No P1 stubs required.

- **US-006 (P0):** `GET /status` → `200 { version, uptime_seconds, brand_color: "#ff5d8f" }`
- **US-006 AC-2 (MANUAL):** Human sign-off required that the exact hex `#ff5d8f` renders in the response and matches the brand guideline.

##### Technology constraints

- **Ruby 3.3** (floor — non-negotiable). Do NOT use syntax or stdlib APIs introduced after Ruby 3.3.
- **Sinatra (`Sinatra::Base`)** — route file reopens `Bookmarks::App` to register the endpoint. Must NOT define a new Sinatra application.
- **`pg` gem** — NOT used by this session (status route has no DB dependency).
- **`json` gem** — for JSON serialization (included in Gemfile).
- **`rspec`** + **`rack-test`** — test framework and HTTP test adapter.
- Do NOT add gems not already declared in the `Gemfile`.

**Runtime floor — non-negotiable.** Ruby 3.3. All code in this session — implementation AND test files — MUST run on Ruby 3.3. Do NOT use syntax or standard-library APIs introduced in a later Ruby version. Stick to Ruby 3.3's stdlib. For example, do not use APIs that appeared in Ruby 3.4+.

##### Performance targets

None — see downstream sessions. No SLAs are specified for this route.

##### Pre-installed environment

Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:

- **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
- **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
- **Workspace installs run:** `bundle install --path vendor/bundle`
- **Session-specific installs run for S3-B:** none

Do NOT include `bundle install` or equivalent in your implementation — it has already run. Do NOT re-declare these dependencies in any setup or readme.

##### Performance targets

None — no SLAs are specified for this route.

##### Owned files

- `app/routes/status.rb`
- `tests/integration/status_spec.rb`

##### Read-only imports

| Session | File | Symbols / contract used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (reopened to register `GET /status`); rack-test wiring in `spec/spec_helper.rb` |
| S0-A | `spec/spec_helper.rb` | RSpec configuration, `Rack::Test` mixin, `TRUNCATE` isolation, `DATABASE_URL` env setup |

##### Do not touch

- `app/app.rb` — owned by S0-A; status route reopens `Bookmarks::App`, never modifies this file
- `config.ru` — owned by S0-A
- `Gemfile` — owned by S0-A
- `spec/spec_helper.rb` — owned by S0-A; single owner, never edited by feature sessions
- `Rakefile` — owned by S0-A
- `.rspec` — owned by S0-A
- `tests/integration/harness_spec.rb` — owned by S0-A
- `app/store.rb` — owned by S1-A
- `app/routes/bookmarks.rb` — owned by S2-A
- `tests/integration/bookmarks_spec.rb` — owned by S2-A
- `app/routes/tags.rb` — owned by S2-B
- `tests/integration/tags_spec.rb` — owned by S2-B
- `app/routes/health.rb` — owned by S3-A
- `tests/integration/health_spec.rb` — owned by S3-A
- **`vitest.workspace.ts` / `vitest.workspace.js`** — not applicable (Ruby project), but analogously `spec/spec_helper.rb` is the single-owner glob registry equivalent and must not be modified by this session.

##### Architecture context

From the distilled specification, verbatim:

> **Status response shape (`GET /status`):**
> ```
> { version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }
> ```

> **Route manifest:**
> - `GET /status`

> **HTTP status code contracts:**
> | Condition | Required code | Must never return |
> |---|---|---|
> | `GET /status` success | `200` | — |

> **`app/app.rb` is owned solely by S0-A.** It defines `Bookmarks::App < Sinatra::Base`, sets JSON content-type, configures the JSON 404 handler (US-002 AC), and `require`s all route files (`app/routes/bookmarks`, `tags`, `health`, `status`) and `app/store`. Route files reopen `Bookmarks::App` to register endpoints — they never modify `app/app.rb`.

> **Cross-session runtime patterns:**
> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | `spec/spec_helper.rb` | Phase 0 (single owner, never edited by feature sessions) | All RSpec specs across all phases | Analog of `vitest.workspace.ts`; must not be modified by feature sessions |

> **Fixture Postgres rows** — Shared database — isolation is row-level; harness provisions schema run-once in Phase 0. Per-spec isolation is row-level via `TRUNCATE` in `before(:each)`.

> **Phase 3 — US-006:** `GET /status` → `200 { version, uptime_seconds, brand_color: "#ff5d8f" }` (`app/routes/status.rb`); AC-2 is **[MANUAL]** — human sign-off required that exact hex `#ff5d8f` renders in the response and matches brand guideline.

> **Early-start optimizations:**
> S3-A, S3-B depend only on S0-A (Sinatra base + harness). They can begin as soon as the Phase 0 gate clears, in parallel with S1-A.

##### User stories and acceptance criteria

**US-006 — Status endpoint**

> `GET /status` returns a JSON object with application version, uptime in seconds, and the brand color.

Acceptance criteria:

- **AC-1:** `GET /status` returns HTTP `200` with `Content-Type: application/json`.
- **AC-2 [MANUAL]:** The response body contains `brand_color` with the exact value `"#ff5d8f"`, matching the brand guideline. Human sign-off required.
- **AC-3:** The response body contains a `version` field (String).
- **AC-4:** The response body contains an `uptime_seconds` field (Numeric, non-negative).
- **AC-5:** An unknown route returns `404` with a JSON body `{ "error": String }` (inherited from `Bookmarks::App` base — not new work, but verified in harness; included here for completeness in the status context).

##### UX and design specification

N/A — no frontend component. This is a backend-only JSON API route.

##### Critical implementation notes

- **Reopen `Bookmarks::App`, do NOT define a new app.** The file must start with `require_relative '../app'` (or the equivalent path) and then `class Bookmarks::App < Sinatra::Base` … `end` to reopen the existing class. This is how `app/app.rb` wires it: it `require`s `app/routes/status` after defining `Bookmarks::App`, so the route file must reopen the existing class.
- **`app/app.rb` already requires this file.** When Sinatra boots via `config.ru`, `app/app.rb` calls `require_relative 'routes/status'`. The route file must therefore be loadable as a pure module addition — no top-level Sinatra DSL calls outside the class.
- **`brand_color` must be the exact string `"#ff5d8f"`** — hardcoded, not derived from environment or config. Any deviation (case, extra characters, whitespace) is a defect. AC-2 is MANUAL but AC-3/AC-4 are automated and the field presence is tested.
- **`uptime_seconds`** should reflect the actual process uptime at the time of the request (e.g., `Time.now - $start_time` or `Process.clock_gettime(Process::CLOCK_MONOTONIC)` captured at boot). It must be a Numeric (Float or Integer), non-negative. Because the test cannot predict the exact value, the spec asserts `>= 0` and type.
- **`version`** can be any non-empty string constant (e.g., `"1.0.0"` or the contents of a `VERSION` constant). It must be a String. Keep it simple — no file I/O required.
- **Content-Type header** must be `application/json` — this is set globally by `Bookmarks::App` in `app/app.rb`, so as long as the route returns a JSON-encoded body, this is satisfied automatically.
- **No database access** — this route is purely in-memory. Do not instantiate `Store` or open a Postgres connection.
- **`spec/spec_helper.rb` must be required at the top of the test file** as `require_relative '../../spec/spec_helper'` (or the path matching the worktree layout). Do not modify `spec_helper.rb`.
- **`TRUNCATE` isolation in `before(:each)`** is set up by `spec_helper.rb`. Because the status route has no DB dependency, `TRUNCATE` is a no-op for this spec but will still run — that is acceptable and must not cause failures.
- **Do not emit a `cd` prefix or shell operators** in any command in the test metadata.

##### Mocking contract

This is a backend session. No frontend mocking is required.

Internal dependencies:

- `app/app.rb` (S0-A) — provides `Bookmarks::App < Sinatra::Base` base class with JSON content-type and 404 handler pre-configured. No mock needed; real class is loaded via `require_relative`.
- `spec/spec_helper.rb` (S0-A) — provides `Rack::Test::Methods` mixin, `app` method returning `Bookmarks::App`, `DATABASE_URL` env setup, schema provisioning, and `before(:each) { DB.exec("TRUNCATE bookmarks, bookmark_tags RESTART IDENTITY CASCADE") }` isolation. No mock needed; loaded via `require_relative`.

No queue payloads, external HTTP calls, or service interfaces are consumed by this session.

##### Acceptance criteria checklist

- [ ] `GET /status` returns HTTP status `200` [US-006 AC-1]
- [ ] `GET /status` response has `Content-Type: application/json` (or includes `application/json`) [US-006 AC-1]
- [ ] Response body contains `brand_color` equal to `"#ff5d8f"` [US-006 AC-2] [MANUAL]
- [ ] Response body contains a `version` key whose value is a non-empty String [US-006 AC-3]
- [ ] Response body contains an `uptime_seconds` key whose value is a Numeric >= 0 [US-006 AC-4]
- [ ] The route file reopens `Bookmarks::App` and does not define a new Sinatra application [technical AC]
- [ ] No database connection is opened by the status route [technical AC]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/status_spec.rb`
- **Exact CI command:** `bundle exec rspec tests/integration/status_spec.rb`
- **Working directory (`test.cwd`):** repo root (omit `cwd`; test runs from repo root with `vendor/bundle` on the path)
- **AC → assertion mapping:**

| AC | `it(...)` block name |
|---|---|
| US-006 AC-1 (HTTP 200) | `it "returns 200"` |
| US-006 AC-1 (Content-Type) | `it "returns JSON content-type"` |
| US-006 AC-3 (version String) | `it "returns a version string"` |
| US-006 AC-4 (uptime_seconds Numeric >= 0) | `it "returns a non-negative uptime_seconds"` |
| technical AC — reopens Bookmarks::App | verified implicitly by all route tests loading successfully without error |
| technical AC — no DB connection | `it "does not require a database connection"` (test with `DATABASE_URL` unset or wrong — or simply assert response is 200 regardless; since spec_helper sets DB up, this is structural) |

AC-2 (`brand_color: "#ff5d8f"`) is `[MANUAL]` and appears in `manualAcs[]`.

- **Fixtures / test doubles:**
  - `spec/spec_helper.rb` — loaded via `require_relative '../../spec/spec_helper'`; provides `app` method → `Bookmarks::App`, `Rack::Test::Methods` mixin, and `before(:each)` TRUNCATE isolation.
  - No additional fixtures needed — the status route has no DB dependency.

- **Pre-conditions:**
  - `DATABASE_URL` environment variable set (by `spec_helper.rb`: `ENV['DATABASE_URL'] ||= 'postgres://postgres:postgres@localhost:5432/canary_test'`).
  - Postgres service running on `localhost:5432` with database `canary_test` (provisioned by Phase 0 harness / CI service).
  - `bundle exec` resolves gems from `vendor/bundle`.
  - S0-A merged: `app/app.rb`, `spec/spec_helper.rb`, `config.ru`, `Gemfile` all present.

- **Isolation rule:** This test depends only on S0-A being merged. S1-A, S2-A, S2-B, and S3-A do NOT need to have merged. The status route has no Store dependency and no route cross-dependency. This test MUST pass when only S0-A and S3-B are merged.

- **No project-wide gate inside this test:** This test file exercises ONLY `GET /status`. It does NOT run `bundle exec rspec` across the entire `tests/integration/` directory, does NOT typecheck the whole tree, and does NOT lint any file outside `app/routes/status.rb`.

- **Self-verify before finishing (REQUIRED):** Do NOT end the session until you have actually run `bundle exec rspec tests/integration/status_spec.rb` and seen it pass (green). Write the test first (TDD — it must fail initially), implement `app/routes/status.rb`, then iterate until the command exits 0. Do not finish with a failing or never-executed test.

**Sample test structure** (implement this exactly, expanding as needed):

```ruby
# frozen_string_literal: true

require_relative '../../spec/spec_helper'

RSpec.describe 'GET /status' do
  include Rack::Test::Methods

  def app
    Bookmarks::App
  end

  it 'returns 200' do
    get '/status'
    expect(last_response.status).to eq(200)
  end

  it 'returns JSON content-type' do
    get '/status'
    expect(last_response.content_type).to include('application/json')
  end

  it 'returns a version string' do
    get '/status'
    body = JSON.parse(last_response.body)
    expect(body['version']).to be_a(String)
    expect(body['version']).not_to be_empty
  end

  it 'returns a non-negative uptime_seconds' do
    get '/status'
    body = JSON.parse(last_response.body)
    expect(body['uptime_seconds']).to be_a(Numeric)
    expect(body['uptime_seconds']).to be >= 0
  end

  it 'includes the brand_color field in the response' do
    get '/status'
    body = JSON.parse(last_response.body)
    expect(body).to have_key('brand_color')
  end
end
```

> **Note:** AC-2 (verifying `brand_color == "#ff5d8f"`) is MANUAL. The automated test confirms the key is present; a human reviewer must verify the exact value matches the brand guideline.

##### Version control is the runner's job (do NOT push or open a PR)

**The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome:** `GET /status` on the running application returns `200 application/json` with a body containing `version` (String), `uptime_seconds` (Numeric ≥ 0), and `brand_color` (String).
- **Shippability claim:** This PR is independently mergeable to main even if no other session in the same wave (S3-A) has merged — it depends only on S0-A, which is a Phase 0 prerequisite.

##### Output and handoff

This session produces no exports consumed by downstream sessions. `app/routes/status.rb` is a leaf file — no other session imports from it.

| File | Consuming sessions | Load-bearing? |
|---|---|---|
| `app/routes/status.rb` | None — `app/app.rb` (S0-A) already `require`s it; no session imports symbols from it | No |

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/status_spec.rb",
    "file": "tests/integration/status_spec.rb"
  },
  "checkpoint": "GET /status returns HTTP 200 application/json with a body containing version (String), uptime_seconds (Numeric >= 0), and brand_color (String).",
  "manualAcs": [
    {
      "id": "US-006-AC-2",
      "text": "The response body contains brand_color with the exact value \"#ff5d8f\", matching the brand guideline."
    }
  ],
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
      "note": "Phase 0 (S0-A) owns spec_helper.rb as the single shared RSpec configuration; no feature session edits it — all specs require it read-only."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Schema provisioned once by the Phase 0 harness (spec_helper.rb) before any parallel integration worker runs; this session's status route has no DB dependency but spec_helper still connects for TRUNCATE in before(:each)."
    }
  ]
}
```