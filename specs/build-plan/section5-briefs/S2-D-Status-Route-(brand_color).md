#### S2-D — Status Route (brand_color)

**Phase 2 | Backend API | Needs: S1-A**

##### Objective

Implement the `GET /status` route that returns a JSON payload containing the application version, uptime in seconds, and the canary brand color `"#ff5d8f"`, satisfying the load-bearing status response shape contract.

##### Scope

P0 MVP — all work in this session is P0. No P1 stubs required.

- `GET /status` → `200` with `{ version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }` — **P0**

##### Technology constraints

- **Ruby 3.3** (floor — non-negotiable). Do NOT use syntax or standard-library APIs introduced after Ruby 3.3.
- **Sinatra** (`Sinatra::Base` subclass) — required HTTP framework. Must register the route as a Sinatra module loaded into `Bookmarks::App` via the glob require in `app/app.rb`.
- **`pg` gem** — available but this route does not require database access.
- **`rspec`** and **`rack-test`** — test framework and HTTP test adapter.
- Do NOT use Rails, Hanami, or any other HTTP framework.
- Do NOT use `Sinatra::Application` (the top-level DSL); always use `Sinatra::Base` subclasses.
- Do NOT use APIs introduced after Ruby 3.3 (e.g., no Ruby 3.4+ stdlib additions).

**Runtime floor — non-negotiable.** The declared runtime floor is **Ruby 3.3**. All code this session writes — implementation AND test files — MUST run on Ruby 3.3. Do not use language or standard-library APIs introduced in a later Ruby version. When in doubt, prefer the most conservative compatible approach.

##### Performance targets

None — see downstream sessions. No SLA assigned to this route in the specification.

##### Pre-installed environment

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
> - **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than Ruby 3.3 in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** `bundle install --path vendor/bundle`
> - **Session-specific installs run for this session:** none

Do NOT run `bundle install` or equivalent — it has already run. Do NOT re-declare dependencies in any setup or readme.

##### Performance targets

None — see downstream sessions. No SLA is directly assigned to this session.

##### Owned files

- `app/routes/status.rb` — the `GET /status` route implementation
- `tests/integration/status_spec.rb` — the RSpec integration spec for this session

##### Read-only imports

| Owning session | File | Used symbols / methods |
|---|---|---|
| S0-A | `spec/spec_helper.rb` | RSpec configuration, `app` helper, rack-test includes |
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra app that glob-requires route files) |
| S1-A | `app/store.rb` | `Store` (not directly needed by the route, but `app/app.rb` loads it; no direct Store call required) |

##### Do not touch

- `app/app.rb` — pre-stubbed by S0-A; route files are discovered via glob require
- `Gemfile` — owned by S0-A
- `spec/spec_helper.rb` — owned by S0-A; single-owner, never edited after Phase 0
- `app/store.rb` — owned by S1-A
- `app/routes/bookmarks.rb` — owned by S2-A
- `app/routes/tags.rb` — owned by S2-B
- `app/routes/health.rb` — owned by S2-C
- `tests/integration/harness_spec.rb` — owned by S0-A
- `tests/integration/store_spec.rb` — owned by S1-A
- `tests/integration/bookmarks_spec.rb` — owned by S2-A
- `tests/integration/tags_spec.rb` — owned by S2-B
- `tests/integration/health_spec.rb` — owned by S2-C
- **`vitest.workspace.ts` / `vitest.workspace.js`** — N/A (Ruby project; analogously, `spec/spec_helper.rb` is the single-owner test registry; never edit it)

##### Architecture context

Verbatim from the distilled specification:

> **1.1 Shared contracts**
>
> **Status response shape** (load-bearing — exact fields required):
> ```ruby
> { version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }
> ```
>
> **Error response shape** (all routes):
> ```ruby
> { "error" => String }
> ```

> **1.5 HTTP status code contracts**
>
> | Condition | Required code | Must never return |
> |---|---|---|
> | `GET /status` — success | `200` | — |
> | Unknown route | `404` with `{ "error": string }` body | `200` |

> **1.6 Route manifest**
>
> - `GET /status`

> **1.8 Technology stack — selected choices only**
>
> | Layer | Choice | Architecturally irreversible reason |
> |---|---|---|
> | Runtime | Ruby 3.3 | Declared in spec; fixture targets Ruby ecosystem proof for #144 |
> | HTTP framework | Sinatra (`Sinatra::Base`) | Specified; `Bookmarks::App` subclasses `Sinatra::Base` |
> | Test framework | RSpec | Specified; integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration` |
> | HTTP test adapter | rack-test | Specified as dev dependency |

> **1.11 Cross-session runtime patterns**
>
> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | `spec/spec_helper.rb` | Phase 0 | All RSpec sessions | Shared test registry; frozen after Phase 0 |

> **1.13 Feature scope — P0 vs P1**
>
> All features are P0 (single release). Full feature list:
>
> - Phase 3: Status route (`app/routes/status.rb`) — `GET /status` → `{ version, uptime_seconds, brand_color: "#ff5d8f" }`
>
> **Manual sign-off gate (AC-2 of US-006):** Status JSON must include `brand_color: "#ff5d8f"` (exact hex, canary pink). Human verification required that the hex renders in the response and matches brand guidelines. WCAG AA pairing: `#ff5d8f` background with `#3a0a1c` text.

> **1.4 Critical ordering rules**
>
> 1. **Phase 0 before all feature phases:** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
> 2. **Phase 1 before Phase 2/3:** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."

##### User stories and acceptance criteria

> **US-006 — Status endpoint**
>
> _As an operator, I want `GET /status` to return version, uptime, and brand color so I can verify the running instance's identity and branding._
>
> **AC-1:** `GET /status` returns HTTP `200`.
>
> **AC-2:** Response body is JSON with fields `version` (string), `uptime_seconds` (numeric, ≥ 0), and `brand_color` equal to the string `"#ff5d8f"` (exact value, canary pink). `[MANUAL]` — human verifier must confirm hex renders correctly and matches brand guidelines.
>
> **AC-3:** `uptime_seconds` is a non-negative number that increases with time (i.e., reflects actual elapsed seconds since the app started, not a hardcoded zero).
>
> **AC-4:** `version` is a non-empty string.

_(Note: US-006 is derived from the feature scope and shared contract specification. The exact user story text above is reconstructed faithfully from the spec's AC descriptions.)_

##### UX and design specification

N/A — backend-only route session; no frontend component.

##### Critical implementation notes

- **Status response shape is load-bearing.** The exact field names and types from the spec must be used verbatim:
  ```ruby
  { version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }
  ```
  When serializing to JSON, symbol keys (`version:`, `uptime_seconds:`, `brand_color:`) must serialize as string keys in the JSON output — use `to_json` on a hash with string keys, or rely on Sinatra's `json` helper with a hash that produces `"version"`, `"uptime_seconds"`, `"brand_color"` in the output.

- **`brand_color` must be exactly `"#ff5d8f"`** — do not alter casing, omit the `#`, abbreviate, or substitute any other value. This is the canary pink brand color and is subject to manual sign-off.

- **`uptime_seconds` must reflect elapsed time since app start**, not a hardcoded zero. Capture the boot timestamp at class load time (e.g., `STARTED_AT = Time.now` as a constant in the route file or in `app/app.rb`) and compute `(Time.now - STARTED_AT).to_i` or `.round` on each request.

- **`version`** — no version string is specified in the spec. Use a reasonable static string (e.g., `"1.0.0"`) or read from an environment variable `APP_VERSION` with a fallback. A hardcoded non-empty string is acceptable.

- **Route registration via glob require.** `app/app.rb` glob-requires all files under `app/routes/`. Your route file must register itself against `Bookmarks::App` (the already-defined Sinatra app class). Pattern:
  ```ruby
  # app/routes/status.rb
  Bookmarks::App.get '/status' do
    # ...
  end
  ```
  Do NOT subclass `Sinatra::Base` again in this file; just reopen/register against `Bookmarks::App`.

- **Content-Type must be `application/json`.** Use Sinatra's `content_type :json` and `JSON.generate(...)` or the `json(...)` helper if available, to ensure the response is parseable JSON with the correct content type header.

- **HTTP 200 is required.** Sinatra defaults to 200 for `get` routes; do not override with a different status unless there is an error condition (which this route does not have).

- **No database access.** This route does not touch Postgres. Do not require or call `Store`.

- **Test isolation.** The spec must pass when this session's PR is the only one merged. It depends only on `spec/spec_helper.rb` (S0-A) and `app/app.rb` (S0-A), both of which are Phase 0 outputs. No sibling Phase 2 sessions need to have merged.

- **TDD workflow required.** Write `tests/integration/status_spec.rb` first and confirm it fails before writing `app/routes/status.rb`. Then implement and iterate to green.

- **`require_relative` path.** If `spec/spec_helper.rb` sets up the load path so that `require 'spec_helper'` works via `.rspec` configuration (`--require spec_helper`), do not add a redundant require. Follow the convention established by S0-A's `spec/spec_helper.rb`.

##### Mocking contract

**Backend session — no mock HTTP responses.** This session uses rack-test to exercise the real Sinatra app in-process. No external HTTP mocking is needed. The only external dependency is Postgres, but this route does not query the database, so no DB fixture state is required.

No internal events, queues, or service interfaces are consumed from other sessions beyond the `Bookmarks::App` class and `spec/spec_helper.rb`, both from S0-A.

##### Acceptance criteria checklist

- [ ] `GET /status` returns HTTP status `200` [US-006 AC-1]
- [ ] Response `Content-Type` header is `application/json` [US-006 AC-1]
- [ ] Response body parses as valid JSON [US-006 AC-2]
- [ ] Parsed JSON contains key `"version"` with a non-empty string value [US-006 AC-4]
- [ ] Parsed JSON contains key `"uptime_seconds"` with a numeric (integer or float) value ≥ 0 [US-006 AC-3]
- [ ] Parsed JSON contains key `"brand_color"` with value exactly `"#ff5d8f"` [US-006 AC-2] `[MANUAL]`
- [ ] `uptime_seconds` reflects elapsed time (is not always zero; increases over the lifetime of a process) [US-006 AC-3]
- [ ] No extra error or unexpected fields break the response contract [US-006 AC-2]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/status_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration/status_spec.rb`
- **Working directory** (`test.cwd`): repo root (no subdirectory needed)

**AC → assertion mapping:**

| AC | `it(...)` block name |
|---|---|
| US-006 AC-1 — HTTP 200 | `it "returns HTTP 200"` |
| US-006 AC-1 — Content-Type JSON | `it "returns Content-Type application/json"` |
| US-006 AC-2 — parseable JSON body | `it "returns parseable JSON"` |
| US-006 AC-4 — version non-empty string | `it "includes a non-empty version string"` |
| US-006 AC-3 — uptime_seconds numeric ≥ 0 | `it "includes uptime_seconds as a non-negative number"` |
| US-006 AC-2 — brand_color exact value | `[MANUAL]` — exempt from automated assertion mapping |
| US-006 AC-3 — uptime increases | `it "uptime_seconds increases over time"` |
| US-006 AC-2 — no unexpected structural breakage | `it "response body contains expected keys"` |

**Fixtures / test doubles:**

- `spec/spec_helper.rb` (S0-A) — provides rack-test includes, the `app` helper returning `Bookmarks::App`, and RSpec configuration.
- No database fixtures required (route has no DB access).
- No external HTTP stubs required.

**Pre-conditions:**

- `spec/spec_helper.rb` must be on the RSpec load path (via `.rspec` `--require spec_helper` or explicit require in spec file — follow S0-A's established convention).
- `app/app.rb` must be loaded and `Bookmarks::App` defined (glob-requires `app/routes/status.rb` automatically).
- No `DATABASE_URL` is required by this route, but if `app/app.rb` or `spec_helper.rb` establishes a DB connection at load time, the Postgres service must be reachable. Per the project requirements, the Postgres service is provisioned as part of the environment.

**Isolation rule:**

This test passes when only S0-A (Phase 0) and S1-A (Phase 1) have merged — no sibling Phase 2 sessions (S2-A, S2-B, S2-C) need to be present. The spec loads `app/app.rb` which glob-requires whichever route files exist; missing sibling routes do not affect `GET /status` behavior.

**No project-wide gate inside per-session test:** This spec exercises only `GET /status`. Do NOT embed `system('bundle exec rspec tests/integration')` (the full suite) or a lint/typecheck of the whole tree inside this spec file.

**Self-verify before finishing (REQUIRED):** Do NOT end the session until you have actually run `bundle exec rspec tests/integration/status_spec.rb` and seen it pass with all examples green. Implement → run → read failure → fix → repeat until green on the real command.

##### Version control is the runner's job (do NOT push or open a PR)

> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome:** `GET /status` returns `200 application/json` with a body containing `"version"` (non-empty string), `"uptime_seconds"` (non-negative number), and `"brand_color": "#ff5d8f"`, verified green by `bundle exec rspec tests/integration/status_spec.rb`.
- **Shippability claim:** This PR is independently mergeable to main even if no other session in the same wave (S2-A, S2-B, S2-C) has merged — it depends only on S0-A (Phase 0) and S1-A (Phase 1), both of which are prerequisite gates.

##### Output and handoff

| Export | Consuming sessions | Load-bearing? |
|---|---|---|
| `GET /status` route registered on `Bookmarks::App` (via `app/routes/status.rb`) | None downstream — terminal route | No (terminal) |
| `tests/integration/status_spec.rb` — contributes to full `bundle exec rspec tests/integration` suite | Phase 2 final gate (all S2 sessions merged) | No |

No named Ruby symbols exported for other sessions to import. This is a terminal route session.

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/status_spec.rb",
    "file": "tests/integration/status_spec.rb"
  },
  "checkpoint": "GET /status returns 200 application/json with body containing version (non-empty string), uptime_seconds (non-negative number), and brand_color: \"#ff5d8f\", verified green by bundle exec rspec tests/integration/status_spec.rb.",
  "manualAcs": [
    {
      "id": "US-006-AC-2",
      "text": "Parsed JSON contains key \"brand_color\" with value exactly \"#ff5d8f\" (canary pink). Human verifier must confirm the hex renders correctly in the response and matches brand guidelines. WCAG AA pairing: #ff5d8f background with #3a0a1c text."
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
      "names": []
    }
  ],
  "sharedFiles": [
    {
      "path": "spec/spec_helper.rb",
      "strategy": "single-owner-glob",
      "note": "Phase 0 (S0-A) owns this file as the single test registry; no feature session ever edits it."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Postgres provisioned once by the Phase 0 harness before any parallel session runs. This route does not access the database, but the shared service is declared for coordination completeness."
    }
  ]
}
```