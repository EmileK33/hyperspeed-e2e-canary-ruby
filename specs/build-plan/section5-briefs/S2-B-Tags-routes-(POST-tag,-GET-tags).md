#### S2-B — Tags Routes (POST tag, GET tags)

**Phase 2 | Backend API | Needs: S1-A**

---

##### Objective

Implement the `POST /bookmarks/:id/tags` and `GET /tags` endpoints by reopening `Bookmarks::App` in `app/routes/tags.rb`, so that callers can attach tags to existing bookmarks and retrieve the global distinct tag set.

---

##### Scope

**P0 MVP** — all work in this session is P0. No P1 stubs required.

Stories covered:
- **US-004 (P0):** `POST /bookmarks/:id/tags` (HTTP 200, returns updated bookmark) and `GET /tags` (HTTP 200, distinct tag set).

---

##### Technology constraints

- **Ruby 3.3** (floor — see Runtime floor below). Do NOT use syntax or standard-library APIs introduced in a Ruby version later than 3.3.
- **Sinatra** (`Sinatra::Base`) — route file reopens `Bookmarks::App < Sinatra::Base`; never creates a new Sinatra application class.
- **`pg` gem** — the `Store` class (Phase 1) handles all Postgres interaction; this session does NOT use `pg` directly.
- **`rspec` + `rack-test`** — integration tests only; no unit-test framework substitution.
- **`json` gem** — already in the bundle; use `JSON.parse` / `.to_json` for serialisation.
- Must NOT use Rails, ActiveRecord, Sequel, or any ORM. Must NOT use `Sinatra::ActiveRecordExtension` or any middleware not already declared in `Gemfile`.
- Must NOT write DDL or run migrations — schema is provisioned once by `spec/spec_helper.rb` (S0-A).

**Runtime floor — non-negotiable.** This project's declared runtime floor is **Ruby 3.3**. All code — implementation AND test files — must run on Ruby 3.3. Do not use syntax or APIs introduced in Ruby 3.4 or later.

---

##### Performance targets

None — see downstream sessions. No SLA assigned to this session.

---

##### Pre-installed environment

Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:

- **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
- **Runtimes:** `ruby 3.3` — **This version is the FLOOR, not just what is installed — CI runs on Ruby 3.3. Do not use APIs newer than 3.3 in implementation OR test code (see Technology constraints).**
- **Workspace installs run:** `bundle install --path vendor/bundle`
- **Session-specific installs run for this session (S2-B):** none

Do NOT run `bundle install` in your implementation — it has already been run. Do NOT re-declare dependencies in any setup or readme.

---

##### Owned files

- `app/routes/tags.rb` — implementation of `POST /bookmarks/:id/tags` and `GET /tags`
- `tests/integration/tags_spec.rb` — RSpec integration spec for both endpoints

No other files may be created or modified.

---

##### Read-only imports

| Owning session | File | Symbols / interface used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (reopened by this route file; class already defined) |
| S0-A | `spec/spec_helper.rb` | Required automatically by `.rspec`; provides `Rack::Test`, DB setup/teardown |
| S1-A | `app/store.rb` | `Store#create`, `Store#all`, `Store#find`, `Store#delete` (Ruby object interface) |

---

##### Do not touch

- `app/app.rb` — owned by S0-A; this session only reopens `Bookmarks::App`, never edits the base file
- `Gemfile` / `Gemfile.lock` — owned by S0-A
- `spec/spec_helper.rb` — owned by S0-A; single owner, never edited by feature sessions
- `config.ru` — owned by S0-A
- `.rspec` — owned by S0-A
- `Rakefile` — owned by S0-A
- `app/store.rb` — owned by S1-A
- `tests/integration/store_spec.rb` — owned by S1-A
- `app/routes/bookmarks.rb` — owned by S2-A
- `tests/integration/bookmarks_spec.rb` — owned by S2-A
- `app/routes/health.rb` — owned by S3-A
- `tests/integration/health_spec.rb` — owned by S3-A
- `app/routes/status.rb` — owned by S3-B
- `tests/integration/status_spec.rb` — owned by S3-B
- `tests/integration/harness_spec.rb` — owned by S0-A
- **`spec/spec_helper.rb`** — Phase 0 single-owner; functions as the analog of `vitest.workspace.ts`; never edited by feature sessions. Put test files where the existing `require 'spec_helper'` pattern already picks them up.

---

##### Architecture context

Verbatim from the distilled specification:

> **1.1 Shared contracts**
>
> Ruby is dynamically typed; plan-time contract proof is ADVISORY "unverified". The single cross-module dependency is:
>
> **`app/store.rb` → `app/routes/*` (Phase 1 producer → Phase 2/3 consumer)**
>
> `Store` must expose the following interface (Ruby, no static types):
>
> ```ruby
> # [CRITICAL BOUNDARY] Store public interface
> Store#create(url:, title:, tags: [])  # → bookmark hash
> Store#all                              # → Array of bookmark hashes
> Store#find(id)                         # → bookmark hash | nil
> Store#delete(id)                       # → void
> ```
>
> Bookmark hash shape (used in all route responses):
>
> ```
> { id, url, title, tags: [] }
> ```
>
> Error response shape (all routes):
>
> ```
> { "error": String }
> ```

> **1.2 Database schema**
>
> Schema is managed by the store layer (`app/store.rb`). No explicit DDL is given in the spec. The integration harness provisions a fixture Postgres database run-once before any parallel worker runs. The store connects via `DATABASE_URL`.
>
> Implied tables (from user stories and store interface):
>
> ```sql
> CREATE TABLE bookmarks (
>   id    SERIAL PRIMARY KEY,
>   url   TEXT NOT NULL,
>   title TEXT NOT NULL
> );
>
> CREATE TABLE bookmark_tags (
>   id          SERIAL PRIMARY KEY,
>   bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
>   tag         TEXT    NOT NULL
> );
>
> CREATE INDEX ON bookmark_tags(bookmark_id);
> CREATE INDEX ON bookmark_tags(tag);
> ```
>
> *No RLS, partitioning, or CHECK constraints specified.*

> **1.5 HTTP status code contracts**
>
> | Condition | Required code | Must never return |
> |---|---|---|
> | `POST /bookmarks/:id/tags` success | `200` (returns updated bookmark) | — |
> | `GET /tags` success | `200` | — |
> | Unknown route | `404` with `{ "error": String }` JSON body | — |

> **1.6 Route manifest**
>
> - `POST /bookmarks/:id/tags`
> - `GET /tags`

> **1.11 Cross-session runtime patterns**
>
> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | Fixture Postgres rows | Any feature phase integration spec | Any other feature phase integration spec | Shared database — isolation is row-level; harness provisions schema run-once in Phase 0 |
> | `Store` API (Ruby object interface) | Phase 1 (`app/store.rb`) | Phase 2 (`app/routes/bookmarks.rb`, `app/routes/tags.rb`), Phase 3 (`app/routes/health.rb`, `app/routes/status.rb`) | ADVISORY unverified at plan time; proven by RSpec CI gate |
> | `spec/spec_helper.rb` | Phase 0 (single owner, never edited by feature sessions) | All RSpec specs across all phases | Analog of `vitest.workspace.ts`; must not be modified by feature sessions |

> **1.12 Environment variable schema**
>
> | Variable | Type | Valid values | Default if absent | Startup behavior if absent |
> |---|---|---|---|---|
> | `DATABASE_URL` | String | Valid Postgres connection URI | None | Store cannot connect; all DB operations fail |

> **Session table — S2-B notes:**
>
> Route files reopen `Bookmarks::App` to register endpoints — they never modify `app/app.rb`.
>
> `app/app.rb` is owned solely by S0-A. It defines `Bookmarks::App < Sinatra::Base`, sets JSON content-type, configures the JSON 404 handler (US-002 AC), and `require`s all route files (`app/routes/bookmarks`, `tags`, `health`, `status`) and `app/store`. Route files reopen `Bookmarks::App` to register endpoints — they never modify `app/app.rb`.
>
> `spec/spec_helper.rb` (S0-A) sets `ENV['DATABASE_URL'] ||= 'postgres://postgres:postgres@localhost:5432/canary_test'` BEFORE requiring `app/app.rb`, provisions schema once (`CREATE TABLE IF NOT EXISTS bookmarks ...; CREATE TABLE IF NOT EXISTS bookmark_tags ...`), and configures `Rack::Test` mixin. Per-spec isolation is row-level via `TRUNCATE` in `before(:each)`.

---

##### User stories and acceptance criteria

**US-004 — Tags routes**

> **POST /bookmarks/:id/tags**
>
> As an API consumer, I want to add tags to an existing bookmark so that I can organise bookmarks by topic.
>
> - **AC-1:** `POST /bookmarks/:id/tags` with a valid bookmark `id` and a JSON body `{ "tag": "ruby" }` returns HTTP 200 with the full updated bookmark hash `{ id, url, title, tags: ["ruby"] }`.
> - **AC-2:** `POST /bookmarks/:id/tags` with a non-existent `id` returns HTTP 404 with `{ "error": String }`.
> - **AC-3:** Calling `POST /bookmarks/:id/tags` twice with the same tag appends the tag to the array (duplicates are permitted in the stored tags list — uniqueness is not enforced per the spec).
> - **AC-4:** The `tags` field in the returned bookmark reflects all tags currently associated with the bookmark (not just the newly added one).
>
> **GET /tags**
>
> As an API consumer, I want to retrieve the global set of distinct tags so that I can discover all topics in use.
>
> - **AC-5:** `GET /tags` returns HTTP 200 with a JSON array of distinct tag strings currently stored across all bookmarks.
> - **AC-6:** `GET /tags` returns an empty array `[]` when no tags have been added.
> - **AC-7:** Each tag string appears at most once in the `GET /tags` response even if it is associated with multiple bookmarks.

---

##### UX and design specification

N/A — backend-only session. No frontend component.

---

##### Critical implementation notes

- **Reopen, never redefine.** `app/routes/tags.rb` must open `Bookmarks::App` with `class Bookmarks::App < Sinatra::Base` (the idiomatic Sinatra reopen pattern). Never call `Sinatra::Base.new` or define a new class. `app/app.rb` (S0-A) already defines the class; this file merely adds route methods to it.
- **`require` discipline.** The route file must `require_relative` (or `require`) `app/store` to ensure `Store` is available when the route file is loaded standalone in tests. Do not `require 'app/app'` from the route file — that creates a circular require. `spec/spec_helper.rb` loads `app/app.rb` which in turn requires all route files and the store.
- **`Store` interface is the only DB abstraction.** Do NOT open a `PG::Connection` directly in `app/routes/tags.rb`. All database interaction must go through `Store` instance methods (`Store#find`, `Store#create`, etc.). The tags endpoints need `Store#find(id)` to look up the bookmark (for both `POST …/tags` and the 404 path) and need access to the raw DB connection only if `Store` does not expose a tag-append method — in that case implement a tag-append method on `Store` and call it from the route. (The `Store` public interface shown in 1.1 does not include a tag-append method; you must add one, e.g. `Store#add_tag(id:, tag:)` and `Store#all_tags`, but only if `Store` is extended — which it cannot be because `app/store.rb` is owned by S1-A.) **Resolution: because `app/store.rb` is owned by S1-A and must not be touched, implement the Postgres tag-append and all-tags queries directly inside `app/routes/tags.rb` using the same `DATABASE_URL` environment variable, opening a `PG::Connection` there.** This is the correct approach when the store layer does not expose the needed interface and the owning file cannot be modified.
- **Distinct tags for `GET /tags`.** The SQL query must use `SELECT DISTINCT tag FROM bookmark_tags ORDER BY tag` (or equivalent) so each tag appears at most once. Do not deduplicate in Ruby after fetching duplicates — use SQL `DISTINCT`.
- **HTTP 200 for `POST /bookmarks/:id/tags`.** Must return 200 (not 201). Status code is contractually specified.
- **HTTP 404 for unknown bookmark.** When the `:id` does not exist, return `{ "error": "not found" }` (or equivalent descriptive message) with status 404. The 404 handler in `app/app.rb` covers unknown routes, not application-level not-found conditions — this route must explicitly set `status 404; { "error": ... }.to_json`.
- **JSON body parsing.** Parse the request body with `JSON.parse(request.body.read)` inside the route. The `content_type :json` and `before` filter may or may not be set globally in `app/app.rb` — do not rely on automatic body parsing; parse explicitly.
- **Response `Content-Type`.** All responses must be `application/json`. Set `content_type :json` at the top of each route handler or rely on the global setting in `app/app.rb`.
- **Row-level isolation.** `spec/spec_helper.rb` runs `TRUNCATE` in `before(:each)`. Each spec example starts with an empty database. Your tests must create their own fixture rows (bookmarks + tags) rather than relying on data from other specs.
- **`GET /tags` empty case.** When the `bookmark_tags` table is empty (no tags added yet), return `[]` — not `null`, not a 204.
- **Atomicity.** `POST /bookmarks/:id/tags` performs two operations: (1) check bookmark exists, (2) insert into `bookmark_tags`, (3) re-fetch the updated bookmark. These do not need to be in a single transaction per the spec, but the existence check must precede the insert to enable the 404 path.
- **Ordering rule from spec:** "Phase 1 before Phase 2/3." This session depends on S1-A being merged. In CI, S1-A's `app/store.rb` is already present when this session's tests run.
- **Test isolation rule:** This session's tests must pass when S2-B is the only Phase 2 session merged. Tests must not import from `app/routes/bookmarks.rb` (S2-A) or depend on any S2-A behaviour.

---

##### Mocking contract

**Backend session** — no HTTP mocks. The integration tests hit a real Rack app backed by a real Postgres fixture database provisioned by `spec/spec_helper.rb`. The `rack-test` gem drives the Rack interface directly (no network layer).

Internal dependencies:

| Dependency | Source | Payload / interface |
|---|---|---|
| Fixture Postgres DB | S0-A `spec/spec_helper.rb` | Schema provisioned once (`bookmarks`, `bookmark_tags` tables); TRUNCATED before each example |
| `Store` public interface | S1-A `app/store.rb` | `Store#find(id) → hash | nil`; tag-append and all-tags queries are implemented directly via PG connection in this session's route file |
| `Bookmarks::App` class | S0-A `app/app.rb` | Class is defined before route files are loaded; route files reopen it |

---

##### Acceptance criteria checklist

- [ ] `POST /bookmarks/:id/tags` with valid `id` and `{ "tag": "ruby" }` returns HTTP 200 [US-004 AC-1]
- [ ] Response body contains the full bookmark hash `{ "id": ..., "url": ..., "title": ..., "tags": ["ruby"] }` [US-004 AC-1]
- [ ] `POST /bookmarks/:id/tags` with non-existent `id` returns HTTP 404 [US-004 AC-2]
- [ ] HTTP 404 response body is `{ "error": String }` (valid JSON object with an "error" key) [US-004 AC-2]
- [ ] Calling `POST /bookmarks/:id/tags` twice with the same tag results in the tag appearing in the `tags` array (duplicate tag storage is permitted) [US-004 AC-3]
- [ ] After two `POST /bookmarks/:id/tags` calls (different tags), the returned `tags` field contains both tags [US-004 AC-4]
- [ ] `GET /tags` returns HTTP 200 [US-004 AC-5]
- [ ] `GET /tags` response body is a JSON array of strings [US-004 AC-5]
- [ ] `GET /tags` returns `[]` when no tags have been added [US-004 AC-6]
- [ ] `GET /tags` returns each tag at most once even when the same tag is associated with multiple bookmarks [US-004 AC-7]
- [ ] `POST /bookmarks/:id/tags` response `Content-Type` is `application/json` [technical — HTTP contract]
- [ ] `GET /tags` response `Content-Type` is `application/json` [technical — HTTP contract]
- [ ] `POST /bookmarks/:id/tags` never returns HTTP 201 (must be 200) [technical — status code contract from 1.5]

---

##### Independent Test

- **Test file path (TDD — written first, must fail before implementation):** `tests/integration/tags_spec.rb`
- **Exact CI command:** `bundle exec rspec tests/integration/tags_spec.rb`
- **Working directory (`test.cwd`):** repo root (omit `cwd`)

**AC → assertion mapping:**

| AC | `it(...)` block |
|---|---|
| US-004 AC-1 (200 status) | `it "returns 200 and the updated bookmark with the new tag"` |
| US-004 AC-1 (response body shape) | `it "returns 200 and the updated bookmark with the new tag"` |
| US-004 AC-2 (404 on missing id) | `it "returns 404 when the bookmark does not exist"` |
| US-004 AC-2 (error body shape) | `it "returns 404 when the bookmark does not exist"` |
| US-004 AC-3 (duplicate tag storage) | `it "allows adding the same tag twice"` |
| US-004 AC-4 (all tags reflected) | `it "reflects all previously added tags in the response"` |
| US-004 AC-5 (GET /tags 200 + array) | `it "returns 200 and a JSON array of distinct tags"` |
| US-004 AC-6 (empty array) | `it "returns an empty array when no tags exist"` |
| US-004 AC-7 (distinct tags) | `it "returns each tag only once even if used on multiple bookmarks"` |
| Technical — Content-Type POST | `it "returns 200 and the updated bookmark with the new tag"` (header assertion) |
| Technical — Content-Type GET | `it "returns 200 and a JSON array of distinct tags"` (header assertion) |
| Technical — never 201 | `it "returns 200 and the updated bookmark with the new tag"` (status assertion) |

**Fixtures / test doubles:**

- Real Postgres database via `DATABASE_URL` (default: `postgres://postgres:postgres@localhost:5432/canary_test`)
- `rack-test` `include Rack::Test::Methods` mixin, `app` method returning `Bookmarks::App`
- Fixture bookmark rows created in each example via `post '/bookmarks', { url: '...', title: '...' }.to_json, 'CONTENT_TYPE' => 'application/json'` (relying on S2-A's endpoint) — **CAUTION:** S2-A may not be merged when S2-B tests run. Use direct DB inserts for fixtures instead: `PG.connect(ENV['DATABASE_URL']).exec_params('INSERT INTO bookmarks (url, title) VALUES ($1, $2) RETURNING id', ['http://example.com', 'Example'])`. This preserves isolation from S2-A.
- `before(:each)` TRUNCATE is handled by `spec/spec_helper.rb`; do not duplicate it.

**Pre-conditions:**

- `DATABASE_URL` set (default provided by `spec/spec_helper.rb`)
- Postgres running with `canary_test` database
- Schema provisioned (done by `spec/spec_helper.rb` before suite runs)
- S0-A's `spec/spec_helper.rb` loaded via `require 'spec_helper'` at top of test file
- S1-A's `app/store.rb` present (loaded transitively via `app/app.rb`)

**Isolation rule:** This test file must pass when S2-B is the only feature session merged. Tests must not rely on S2-A's `POST /bookmarks` endpoint to create fixture data — use direct `PG` inserts. Tests must not require `app/routes/bookmarks.rb` to be present (it is required by `app/app.rb`, which is S0-A's file; if S0-A stubs out the require gracefully for missing files, tests still pass — but the `require` in `app/app.rb` for `bookmarks` will fail if the file does not exist). **Resolution:** S0-A's `app/app.rb` must require all route files; since S0-A is a prerequisite of the harness gate and all phase files are present on the branch when S2-B runs, `app/routes/bookmarks.rb` from S2-A will be present. The isolation risk is only at the PR level — the CI gate runs after S1-A merges, so S2-A's file will exist on the base branch before S2-B merges. This is safe.

**Self-verify before finishing (REQUIRED):** Do NOT end the session until you have actually run `bundle exec rspec tests/integration/tags_spec.rb` and seen it pass (all examples green, 0 failures). Implement the test first (it must fail), then implement `app/routes/tags.rb`, then iterate until the command exits 0. A session that finishes with a failing or never-executed Independent Test is a defect.

---

##### Version control is the runner's job (do NOT push or open a PR)

**The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

---

##### Checkpoint

- **One-sentence observable outcome:** `POST /bookmarks/1/tags` with `{"tag":"ruby"}` returns `200` with the full updated bookmark (including `"tags":["ruby"]`), and `GET /tags` returns `["ruby"]` — verified by `bundle exec rspec tests/integration/tags_spec.rb` exiting 0.
- **Shippability claim:** This PR is independently mergeable to main even if no other session in Phase 2 (S2-A) has merged — provided S1-A has already merged. The only blocking prerequisite is S1-A.

---

##### Output and handoff

| Artifact | Consuming session(s) | Load-bearing? |
|---|---|---|
| `app/routes/tags.rb` (reopens `Bookmarks::App` with `POST /bookmarks/:id/tags` and `GET /tags`) | S3-A, S3-B (indirectly, via `app/app.rb` which requires it) | [LOAD-BEARING] — `app/app.rb` requires this file at startup |
| `tests/integration/tags_spec.rb` | CI gate only | No |

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/tags_spec.rb",
    "file": "tests/integration/tags_spec.rb"
  },
  "checkpoint": "POST /bookmarks/1/tags with {\"tag\":\"ruby\"} returns 200 with the full updated bookmark including tags:[\"ruby\"], and GET /tags returns [\"ruby\"], verified by bundle exec rspec tests/integration/tags_spec.rb exiting 0.",
  "manualAcs": [],
  "exports": [
    {
      "kind": "module",
      "name": "app/routes/tags",
      "shape": "app/routes/tags.rb — reopens Bookmarks::App with POST /bookmarks/:id/tags and GET /tags route handlers"
    }
  ],
  "imports": [
    {
      "from": "S0-A",
      "file": "app/app.rb",
      "names": ["Bookmarks::App"]
    },
    {
      "from": "S1-A",
      "file": "app/store.rb",
      "names": ["Store"]
    }
  ],
  "sharedFiles": [
    {
      "path": "spec/spec_helper.rb",
      "strategy": "single-owner-glob",
      "note": "Phase 0 owns it as a single file loaded by .rspec require directive; no feature session edits it — all specs require it automatically."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Schema provisioned once by the Phase 0 harness (spec/spec_helper.rb) before any parallel integration session; per-example isolation via TRUNCATE in before(:each)."
    }
  ]
}
```