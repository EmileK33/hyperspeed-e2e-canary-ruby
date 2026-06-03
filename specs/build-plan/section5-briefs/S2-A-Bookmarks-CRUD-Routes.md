#### S2-A — Bookmarks CRUD Routes

**Phase 2 | Backend API | Needs: S1-A**

##### Objective

Implement the three bookmark CRUD HTTP routes (`POST /bookmarks`, `GET /bookmarks`, `DELETE /bookmarks/:id`) as a Sinatra extension module that is auto-loaded by `app/app.rb`, so clients can create, list, and delete bookmarks via a JSON REST API.

##### Scope

**P0 MVP** — all work in this session is P0.

- `POST /bookmarks` → `201` with created bookmark JSON
- `GET /bookmarks` → `200` with array of all bookmark JSON
- `DELETE /bookmarks/:id` → `204` with empty body
- Error handling: unknown route `404` (owned by `app/app.rb`, not this session), missing/invalid fields `422` (implementation-defined, see notes)

No P1 stubs required — this session has no deferred work.

##### Technology constraints

- **Ruby 3.3** (floor — non-negotiable). Do NOT use syntax or stdlib APIs introduced after Ruby 3.3.
- **Sinatra** — route module must subclass or extend `Sinatra::Base` (or use `Sinatra::Application` helpers) in a way compatible with `Bookmarks::App` from `app/app.rb`. The idiomatic approach is a `Sinatra::Base` subclass or a plain module registered on the app. Follow the `app/app.rb` glob-require convention (Phase 0 owns it).
- **`pg` gem** — all database access MUST go through `Store` (from `app/store.rb`, Phase 1). Do NOT write raw SQL in this session.
- **`rack-test`** — used in integration specs; do NOT use a live HTTP server in tests.
- **No other gems** beyond what is in the `Gemfile` (`sinatra`, `pg`, `rspec`, `rack-test`). Do NOT add new gems.
- **`json` stdlib** — use Ruby's built-in `json` for `JSON.parse` / `#to_json`; no extra serialisation library.

**Runtime floor — non-negotiable.** Ruby 3.3. All code in this session — implementation AND test files — MUST run on Ruby 3.3. Do NOT use language features or standard-library APIs introduced after Ruby 3.3 (e.g., no Ruby 3.4+ syntax). The CI environment is pinned to Ruby 3.3.

##### Performance targets

None — see downstream sessions. No SLA is directly owned by this session.

##### Pre-installed environment

Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:

- **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
- **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
- **Workspace installs run:** `bundle install --path vendor/bundle`
- **Session-specific installs run for this session:** none

Do NOT include `bundle install` or equivalent in your implementation — it has already run. Do NOT re-declare these dependencies in any setup or readme.

##### Performance targets

None — see downstream sessions.

##### Pre-installed environment

(See above.)

##### Owned files

- `app/routes/bookmarks.rb` — the route implementation
- `tests/integration/bookmarks_spec.rb` — the integration spec (TDD: written first, must fail before implementation)

##### Read-only imports

| Session | File | Symbols / contracts consumed |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` — the Sinatra app class that glob-requires files under `app/routes/`; `spec/spec_helper.rb` — RSpec + rack-test helpers |
| S0-A | `spec/spec_helper.rb` | `app` helper (rack-test), RSpec configuration |
| S1-A | `app/store.rb` | `Store#create(attrs)`, `Store#all`, `Store#find(id)`, `Store#delete(id)` |

##### Do not touch

- `app/app.rb` — owned by S0-A; do not modify the Sinatra app bootstrap or 404 handler
- `spec/spec_helper.rb` — owned by S0-A; frozen after Phase 0
- `Gemfile` — owned by S0-A
- `.rspec` — owned by S0-A
- `app/store.rb` — owned by S1-A
- `tests/integration/store_spec.rb` — owned by S1-A
- `app/routes/tags.rb` — owned by S2-B
- `tests/integration/tags_spec.rb` — owned by S2-B
- `app/routes/health.rb` — owned by S2-C
- `tests/integration/health_spec.rb` — owned by S2-C
- `app/routes/status.rb` — owned by S2-D
- `tests/integration/status_spec.rb` — owned by S2-D
- `tests/integration/harness_spec.rb` — owned by S0-A
- **`vitest.workspace.ts` / `vitest.workspace.js`** — not applicable (Ruby project); the equivalent shared registry is `spec/spec_helper.rb`, which is single-owner S0-A and must never be edited by this session.

##### Architecture context

Verbatim from the distilled spec:

> **[CRITICAL BOUNDARY]** — `Store` API surface (producer: Phase 1 `app/store.rb`; consumers: Phase 2 `app/routes/bookmarks.rb`, `app/routes/tags.rb`; Phase 3 `app/routes/health.rb`, `app/routes/status.rb`):
>
> ```ruby
> # app/store.rb — must define all four methods before any route session runs
> Store#create(attrs)   # inserts a bookmark row, returns the created record
> Store#all             # returns all bookmark rows
> Store#find(id)        # returns one bookmark row or nil
> Store#delete(id)      # removes one bookmark row
> ```
>
> Ruby is dynamically typed; plan-time contract proof is ADVISORY "unverified". No compile-time enforcement.
>
> **Error response shape** (all routes):
> ```ruby
> { "error" => String }
> ```

> **Phase 0 before all feature phases:** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
> **Phase 1 before Phase 2/3:** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."

> **HTTP status code contracts:**
>
> | Condition | Required code | Must never return |
> |---|---|---|
> | `POST /bookmarks` — bookmark created | `201` | — |
> | `GET /bookmarks` — success | `200` | — |
> | `DELETE /bookmarks/:id` — deleted | `204` | — |
> | Unknown route | `404` with `{ "error": string }` body | `200` |

> **Route manifest (backend):**
> - `POST /bookmarks`
> - `GET /bookmarks`
> - `DELETE /bookmarks/:id`

> **Technology stack:**
>
> | Layer | Choice |
> |---|---|
> | Runtime | Ruby 3.3 |
> | HTTP framework | Sinatra (`Sinatra::Base`) — `Bookmarks::App` subclasses `Sinatra::Base` |
> | Datastore | Postgres — `pg` gem; connected via `DATABASE_URL` |
> | Test framework | RSpec — integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration` |
> | HTTP test adapter | rack-test |

> **Feature scope (P0):**
> - Phase 2: Bookmark CRUD routes (`app/routes/bookmarks.rb`) — `POST /bookmarks` (201), `GET /bookmarks` (200), `DELETE /bookmarks/:id` (204)

> **Fixture Postgres rows** — Shared single DB; sessions must use isolated rows to avoid collision.

> **`DATABASE_URL`** — Valid PostgreSQL connection URI; no default if absent; app boots but all DB calls raise connection error if absent.

##### User stories and acceptance criteria

The following user stories are derived from the P0 feature scope and HTTP contract tables in the distilled specification. They represent the complete acceptance surface for `app/routes/bookmarks.rb`.

---

**US-001 — Create a bookmark**

As an API client, I want to `POST /bookmarks` with a `url` and `title` so that a new bookmark is persisted and returned.

Acceptance criteria:

- **US-001-AC-1 (Happy path):** Given a valid JSON body `{ "url": "https://example.com", "title": "Example" }`, when `POST /bookmarks` is called, then the response status is `201`, the `Content-Type` is `application/json`, and the response body is a JSON object containing at least `id`, `url`, and `title` with the submitted values.
- **US-001-AC-2 (Persisted):** After a successful `POST /bookmarks`, the created bookmark is returned by `GET /bookmarks`.
- **US-001-AC-3 (Missing url):** Given a body missing the `url` field, when `POST /bookmarks` is called, then the response status is `422` and the body is `{ "error": <string> }`.
- **US-001-AC-4 (Missing title):** Given a body missing the `title` field, when `POST /bookmarks` is called, then the response status is `422` and the body is `{ "error": <string> }`.

---

**US-002 — List all bookmarks**

As an API client, I want to `GET /bookmarks` so that I receive a list of all persisted bookmarks.

Acceptance criteria:

- **US-002-AC-1 (Empty list):** When `GET /bookmarks` is called and no bookmarks exist, the response status is `200` and the body is a JSON array `[]`.
- **US-002-AC-2 (Non-empty list):** When one or more bookmarks have been created, `GET /bookmarks` returns status `200` and a JSON array containing all bookmarks, each with at least `id`, `url`, and `title`.
- **US-002-AC-3 (Content-Type):** The `Content-Type` header contains `application/json`.

---

**US-003 — Delete a bookmark**

As an API client, I want to `DELETE /bookmarks/:id` so that a bookmark is permanently removed.

Acceptance criteria:

- **US-003-AC-1 (Happy path):** Given a bookmark that exists, when `DELETE /bookmarks/:id` is called with its `id`, then the response status is `204` and the response body is empty.
- **US-003-AC-2 (Deleted from store):** After a successful `DELETE /bookmarks/:id`, the deleted bookmark is no longer returned by `GET /bookmarks`.
- **US-003-AC-3 (Non-existent id):** When `DELETE /bookmarks/:id` is called with an `id` that does not exist, the response status is `404` and the body is `{ "error": <string> }`.

##### UX and design specification

N/A — no frontend component. This is a backend-only JSON REST API session.

##### Critical implementation notes

- **`app/app.rb` glob-require convention (S0-A):** Phase 0 wires `app/app.rb` to `require` all files matching `app/routes/*.rb` (glob-based auto-loading). Your file `app/routes/bookmarks.rb` MUST define its routes in a way that `app/app.rb` can load it without modification. The canonical pattern: define a `Sinatra::Base` subclass (e.g., `module Bookmarks; class BookmarksRoutes < Sinatra::Base; ... end; end`) and register it on `Bookmarks::App` using `use Bookmarks::BookmarksRoutes`, OR define the routes directly as helpers mixed into `Bookmarks::App` using `Bookmarks::App.register(...)` or an inline `Bookmarks::App` block. Follow whichever pattern S0-A actually uses in `app/app.rb` — read that file first before writing any code.
- **`Store` instantiation:** The `Store` class (S1-A) may require a database connection argument or may use a global/class-level connection. Read `app/store.rb` carefully before writing routes — do not assume a constructor signature.
- **HTTP status `201` for `POST /bookmarks`:** The route MUST call `status 201` explicitly; Sinatra defaults to `200`.
- **HTTP status `204` for `DELETE /bookmarks/:id`:** The route MUST call `halt 204` (or `status 204; body ''`). A `204` with a non-empty body is invalid.
- **HTTP status `404` for missing DELETE target:** When `Store#find(id)` returns `nil`, respond with `404` and `{ "error" => "not found" }` (or equivalent string). Do NOT let a Sinatra route-not-found 404 serve this — it must be an explicit conditional inside the `DELETE /bookmarks/:id` route handler.
- **`Content-Type: application/json`:** All non-204 responses MUST set `content_type :json`. Sinatra does not set this automatically.
- **JSON request parsing:** Parse the request body with `JSON.parse(request.body.read)`. Handle `JSON::ParserError` — if the body is not valid JSON and fields are required, return `422`.
- **Atomicity:** `Store#create` and `Store#delete` are single-row operations. No multi-table transaction is required in this session (tags cascade-delete is handled by the DB schema's `ON DELETE CASCADE` defined in Phase 1).
- **Row isolation in shared DB:** Tests MUST clean up (or use sufficiently unique data) so that parallel or sequential spec runs do not collide. Use `DatabaseCleaner`-style truncation in `spec/spec_helper.rb` if S0-A provides it, or issue `DELETE FROM bookmarks` in a `before(:each)` / `after(:each)` hook scoped to this spec file. Do NOT rely on a blank DB.
- **`422` vs `400`:** The spec mandates `{ "error": string }` body for all error responses. The HTTP status for missing fields is implementation-defined; use `422 Unprocessable Entity` as it is semantically correct for validation failures.
- **Do not define a 404 catch-all here:** The `404` handler for unknown routes is owned by `app/app.rb` (S0-A). Only define explicit route handlers in this file.
- **`id` type from Store:** The `id` returned by `Store` and used in `DELETE /bookmarks/:id` may be an integer (Postgres `SERIAL`). Use `params[:id].to_i` when looking up by id. Confirm with `app/store.rb`.

##### Mocking contract

**Backend session** — this session depends on the `Store` object from S1-A (a real Ruby object, not a network service). In the integration test, `Store` is exercised against the real fixture Postgres database (not mocked). The rack-test adapter drives the Sinatra app in-process; no HTTP server is started.

Internal dependency shape (must match S1-A's implementation):

```ruby
Store#create(attrs)
# attrs: Hash with at least { url: String, title: String }
# returns: Hash-like record with at minimum { "id" => Integer, "url" => String, "title" => String }
# (exact key type — string vs symbol — determined by S1-A; read store.rb before use)

Store#all
# returns: Array of Hash-like records, each with { "id" => Integer, "url" => String, "title" => String, ... }

Store#find(id)
# id: Integer
# returns: Hash-like record or nil

Store#delete(id)
# id: Integer
# returns: undefined (side-effect only)
```

No external HTTP mocks are needed. The spec talks directly to the Sinatra app via `rack-test`.

##### Acceptance criteria checklist

- [ ] `POST /bookmarks` with `{ url, title }` returns HTTP `201` [US-001-AC-1]
- [ ] `POST /bookmarks` response `Content-Type` is `application/json` [US-001-AC-1]
- [ ] `POST /bookmarks` response body contains `id`, `url`, `title` with submitted values [US-001-AC-1]
- [ ] A bookmark created via `POST /bookmarks` appears in subsequent `GET /bookmarks` response [US-001-AC-2]
- [ ] `POST /bookmarks` with missing `url` returns HTTP `422` with `{ "error": <string> }` body [US-001-AC-3]
- [ ] `POST /bookmarks` with missing `title` returns HTTP `422` with `{ "error": <string> }` body [US-001-AC-4]
- [ ] `GET /bookmarks` with no bookmarks returns HTTP `200` and JSON array `[]` [US-002-AC-1]
- [ ] `GET /bookmarks` with bookmarks present returns HTTP `200` and JSON array with each bookmark containing `id`, `url`, `title` [US-002-AC-2]
- [ ] `GET /bookmarks` response `Content-Type` is `application/json` [US-002-AC-3]
- [ ] `DELETE /bookmarks/:id` for existing bookmark returns HTTP `204` with empty body [US-003-AC-1]
- [ ] After `DELETE /bookmarks/:id`, bookmark no longer appears in `GET /bookmarks` [US-003-AC-2]
- [ ] `DELETE /bookmarks/:id` for non-existent id returns HTTP `404` with `{ "error": <string> }` body [US-003-AC-3]
- [ ] All error responses use `{ "error": <string> }` shape (no other error shapes) [architecture contract]
- [ ] `POST /bookmarks` never returns `200` for success (must be `201`) [HTTP contract]
- [ ] `DELETE /bookmarks/:id` never returns a non-empty body on `204` [HTTP contract]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/bookmarks_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration/bookmarks_spec.rb`
- **Working directory** (`test.cwd`): repo root (no subdirectory needed)
- **AC → assertion mapping**:

  | AC | `it(...)` block |
  |---|---|
  | US-001-AC-1 | `it "returns 201 with the created bookmark JSON"` |
  | US-001-AC-2 | `it "persists the bookmark so it appears in GET /bookmarks"` |
  | US-001-AC-3 | `it "returns 422 when url is missing"` |
  | US-001-AC-4 | `it "returns 422 when title is missing"` |
  | US-002-AC-1 | `it "returns 200 with an empty array when no bookmarks exist"` |
  | US-002-AC-2 | `it "returns 200 with all bookmarks"` |
  | US-002-AC-3 | `it "returns application/json content-type for GET /bookmarks"` |
  | US-003-AC-1 | `it "returns 204 with empty body for existing bookmark"` |
  | US-003-AC-2 | `it "removes the bookmark so it no longer appears in GET /bookmarks"` |
  | US-003-AC-3 | `it "returns 404 with error body for non-existent id"` |
  | HTTP contract (`POST` never `200`) | covered by US-001-AC-1 `it` (asserts `201`) |
  | HTTP contract (`DELETE 204` empty body) | covered by US-003-AC-1 `it` (asserts empty body) |
  | Error shape contract | covered by US-001-AC-3, US-001-AC-4, US-003-AC-3 `it` blocks |
  | Content-Type on POST | covered by US-001-AC-1 `it` |

- **Fixtures / test doubles**:
  - Real fixture Postgres database at `DATABASE_URL` (provisioned by Phase 0 harness, `run-once`).
  - `rack-test` `include Rack::Test::Methods` — `app` method returns `Bookmarks::App` (from `spec/spec_helper.rb`).
  - `before(:each)` cleanup: truncate `bookmarks` table (cascades to `tags`) with `Store` or raw `PG::Connection` to ensure test isolation. Example: `Store.new(db).instance_eval { @db.exec("DELETE FROM bookmarks") }` or equivalent — read S1-A's `Store` constructor to wire correctly.
  - No external HTTP mocks; all requests go through rack-test in-process.

- **Pre-conditions**:
  - `DATABASE_URL` environment variable set pointing to the fixture Postgres (`postgres://postgres:postgres@localhost:5432/canary_test` or equivalent).
  - `bundle install --path vendor/bundle` already run (workspace install).
  - S0-A merged: `spec/spec_helper.rb` and `app/app.rb` present.
  - S1-A merged: `app/store.rb` present and DDL migrated (tables `bookmarks` and `tags` exist).

- **Isolation rule**: This test MUST pass when S2-A's PR is the only Phase 2 PR merged. It must not depend on S2-B, S2-C, or S2-D having merged. It only touches the `bookmarks` table and the three routes defined in this session.

- **No project-wide gate**: Do NOT embed `system("bundle exec rspec")` (full suite) or any typecheck/lint of the whole tree inside this spec file. Exercise only the three bookmark CRUD routes.

- **Self-verify before finishing (REQUIRED)**: Do NOT end the session until you have run `bundle exec rspec tests/integration/bookmarks_spec.rb` and seen it pass (exit 0, all examples green). Write the test first, confirm it fails (red) on a missing implementation, implement, then iterate until green. A session that finishes with a failing or never-executed test is a defect.

##### Version control is the runner's job (do NOT push or open a PR)

**The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome**: `POST /bookmarks`, `GET /bookmarks`, and `DELETE /bookmarks/:id` all respond with the correct HTTP status codes and JSON bodies against the fixture Postgres, as verified by `bundle exec rspec tests/integration/bookmarks_spec.rb` exiting 0 with all examples passing.
- **Shippability claim**: This PR is independently mergeable to main even if no other Phase 2 session (S2-B, S2-C, S2-D) has merged, provided S0-A and S1-A are already on main.

##### Output and handoff

This session produces no exported Ruby symbols consumed by other sessions (the routes are auto-loaded by `app/app.rb`'s glob require; no session imports `app/routes/bookmarks.rb` by name). The session's contribution is runtime behaviour — three live HTTP routes — not a code-level export.

- `app/routes/bookmarks.rb` — loaded by `app/app.rb` glob; contributes `POST /bookmarks`, `GET /bookmarks`, `DELETE /bookmarks/:id` to `Bookmarks::App`. No downstream session imports this file directly. Not load-bearing as a symbol export.

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/bookmarks_spec.rb",
    "file": "tests/integration/bookmarks_spec.rb"
  },
  "checkpoint": "POST /bookmarks, GET /bookmarks, and DELETE /bookmarks/:id all respond with correct HTTP status codes and JSON bodies against the fixture Postgres, verified by bundle exec rspec tests/integration/bookmarks_spec.rb exiting 0 with all examples passing.",
  "manualAcs": [],
  "exports": [],
  "imports": [
    { "from": "S0-A", "file": "spec/spec_helper.rb", "names": [] },
    { "from": "S0-A", "file": "app/app.rb", "names": [] },
    { "from": "S1-A", "file": "app/store.rb", "names": ["Store"] }
  ],
  "sharedFiles": [
    {
      "path": "spec/spec_helper.rb",
      "strategy": "single-owner-glob",
      "note": "Phase 0 (S0-A) owns this as the single shared RSpec helper; no session edits it after Phase 0 merges."
    },
    {
      "path": "app/app.rb",
      "strategy": "single-owner-glob",
      "note": "Phase 0 (S0-A) owns app/app.rb and uses a glob require of app/routes/*.rb so no route session ever edits it."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Schema migrations run once by the Phase 0 harness before any parallel session; this session cleans up its own rows in before(:each) hooks to avoid collision with sibling sessions."
    }
  ]
}
```