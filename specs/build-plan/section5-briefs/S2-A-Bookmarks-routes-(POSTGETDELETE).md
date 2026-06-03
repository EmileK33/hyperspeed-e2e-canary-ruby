#### S2-A — Bookmarks routes (POST/GET/DELETE)

**Phase 2 | Backend API | Needs: S1-A**

##### Objective

Implement the `POST /bookmarks`, `GET /bookmarks`, and `DELETE /bookmarks/:id` HTTP endpoints by reopening `Bookmarks::App` in `app/routes/bookmarks.rb`, delegating all persistence to `Store`, and returning correctly-structured JSON responses with the HTTP status codes mandated by the spec.

##### Scope

P0 MVP — all work in this session is P0. No P1 stubs required.

##### Technology constraints

- **Ruby 3.3** (declared runtime floor — non-negotiable). Do NOT use syntax or standard-library APIs introduced after Ruby 3.3.
- **Sinatra** (`Sinatra::Base` subclass `Bookmarks::App`) — route files reopen `Bookmarks::App` using `Bookmarks::App.class_eval` or by `require`-ing after the class is defined; they never redefine the class or inherit again.
- **`pg` gem** — all database access goes through `Store` (Session S1-A); this session must NOT use `pg` directly.
- **RSpec + `rack-test`** — test framework; do NOT use minitest, test-unit, or any other framework.
- **Do NOT use** `ActiveRecord`, `Sequel`, `DataMapper`, or any ORM — all persistence is through `Store`.
- **Do NOT use** `json` gem's `JSON.generate` directly in route handlers — rely on `content_type :json` set in `app/app.rb` and call `.to_json` on response hashes.

**Runtime floor — non-negotiable.** Declared floor: **Ruby 3.3**. All code in this session — `app/routes/bookmarks.rb` AND `tests/integration/bookmarks_spec.rb` — must run on Ruby 3.3. Do not use APIs, syntax, or standard-library features introduced after 3.3.

##### Performance targets

None — see downstream sessions. No SLA is assigned to this session.

##### Pre-installed environment

Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:

- **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
- **Runtimes:** `ruby 3.3` — **this is the FLOOR, not just what is installed. CI runs on Ruby 3.3. Do not use APIs or syntax newer than Ruby 3.3 in implementation OR test code (see Technology constraints).**
- **Workspace installs run:** `bundle install --path vendor/bundle`
- **Session-specific installs run for this session:** none

Do NOT include `bundle install` or equivalent in your implementation — it has already run. Do NOT re-declare these dependencies in any setup or readme.

##### Performance targets

None — see downstream sessions. No SLA is assigned to this session directly.

##### Owned files

- `app/routes/bookmarks.rb` — implements `POST /bookmarks`, `GET /bookmarks`, `DELETE /bookmarks/:id`
- `tests/integration/bookmarks_spec.rb` — RSpec integration spec for the three endpoints

##### Read-only imports

| Owning session | File | Symbols / interface required |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` class (reopened, not redefined) |
| S0-A | `spec/spec_helper.rb` | Loaded via `.rspec` / `require 'spec_helper'`; provides `Rack::Test` mixin, DB schema, per-spec TRUNCATE |
| S1-A | `app/store.rb` | `Store#create(url:, title:, tags: [])`, `Store#all`, `Store#find(id)`, `Store#delete(id)` |

##### Do not touch

- `app/app.rb` — owned by S0-A; this session reopens `Bookmarks::App` inside `app/routes/bookmarks.rb` only
- `spec/spec_helper.rb` — owned by S0-A; single owner, never edited by feature sessions
- `Gemfile` — owned by S0-A
- `config.ru` — owned by S0-A
- `.rspec` — owned by S0-A
- `Rakefile` — owned by S0-A
- `tests/integration/harness_spec.rb` — owned by S0-A
- `app/store.rb` — owned by S1-A
- `tests/integration/store_spec.rb` — owned by S1-A
- `app/routes/tags.rb` — owned by S2-B
- `tests/integration/tags_spec.rb` — owned by S2-B
- `app/routes/health.rb` — owned by S3-A
- `tests/integration/health_spec.rb` — owned by S3-A
- `app/routes/status.rb` — owned by S3-B
- `tests/integration/status_spec.rb` — owned by S3-B
- **`vitest.workspace.ts` / `vitest.workspace.js`** — N/A for this Ruby project; the analog is `spec/spec_helper.rb`, which is single-owner (S0-A) and must not be modified by this session.

##### Architecture context

Verbatim from the distilled specification:

---

**§1.1 Shared contracts**

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

---

**§1.2 Database schema**

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

---

**§1.5 HTTP status code contracts**

> | Condition | Required code | Must never return |
> |---|---|---|
> | `POST /bookmarks` success | `201` | — |
> | `GET /bookmarks` success | `200` | — |
> | `DELETE /bookmarks/:id` success | `204` | — |
> | Unknown route | `404` with `{ "error": String }` JSON body | — |

---

**§1.6 Route manifest**

> - `POST /bookmarks`
> - `GET /bookmarks`
> - `DELETE /bookmarks/:id`

---

**§1.11 Cross-session runtime patterns**

> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | Fixture Postgres rows | Any feature phase integration spec | Any other feature phase integration spec | Shared database — isolation is row-level; harness provisions schema run-once in Phase 0 |
> | `Store` API (Ruby object interface) | Phase 1 (`app/store.rb`) | Phase 2 (`app/routes/bookmarks.rb`, `app/routes/tags.rb`), Phase 3 (`app/routes/health.rb`, `app/routes/status.rb`) | ADVISORY unverified at plan time; proven by RSpec CI gate |
> | `spec/spec_helper.rb` | Phase 0 (single owner, never edited by feature sessions) | All RSpec specs across all phases | Analog of `vitest.workspace.ts`; must not be modified by feature sessions |

---

**§1.12 Environment variable schema**

> | Variable | Type | Valid values | Default if absent | Startup behavior if invalid | Startup behavior if absent |
> |---|---|---|---|---|---|
> | `DATABASE_URL` | String | Valid Postgres connection URI | None | Connection will fail at query time | Store cannot connect; all DB operations fail |

---

**§1.8 Technology stack**

> | Layer | Choice | Architecturally irreversible reason |
> |---|---|---|
> | Runtime | Ruby 3.3 | Declared explicitly |
> | HTTP framework | Sinatra (`Sinatra::Base`) | Named in spec; `Bookmarks::App < Sinatra::Base` |
> | Database driver | `pg` gem | Connects to Postgres via `DATABASE_URL` |
> | Test framework | RSpec | Integration specs under `tests/integration/`; CI gate is `bundle exec rspec tests/integration` |
> | HTTP test adapter | `rack-test` | Named explicitly as dev dependency |

---

**Session table note (S0-A entry):**

> `app/app.rb` is owned solely by S0-A. It defines `Bookmarks::App < Sinatra::Base`, sets JSON content-type, configures the JSON 404 handler (US-002 AC), and `require`s all route files (`app/routes/bookmarks`, `tags`, `health`, `status`) and `app/store`. Route files reopen `Bookmarks::App` to register endpoints — they never modify `app/app.rb`.

---

##### User stories and acceptance criteria

**US-003 — Bookmark CRUD routes**

> As an API consumer, I want to create, list, and delete bookmarks over HTTP so that I can manage my bookmark collection via the REST API.
>
> **AC-1 — POST /bookmarks creates a bookmark and returns 201**
> Given a JSON body `{ "url": "https://example.com", "title": "Example" }` (with optional `"tags": ["ruby"]`)
> When `POST /bookmarks` is called
> Then the response status is `201`
> And the response body is a JSON bookmark object `{ "id": <integer>, "url": "https://example.com", "title": "Example", "tags": ["ruby"] }`
> And the bookmark is persisted (appears in subsequent `GET /bookmarks`)
>
> **AC-2 — POST /bookmarks with tags stores the tags**
> Given a JSON body `{ "url": "https://foo.com", "title": "Foo", "tags": ["a", "b"] }`
> When `POST /bookmarks` is called
> Then the response body includes `"tags": ["a", "b"]`
> And a subsequent `GET /bookmarks` returns the bookmark with those tags
>
> **AC-3 — POST /bookmarks with no tags defaults to empty tags array**
> Given a JSON body `{ "url": "https://bar.com", "title": "Bar" }` (no `tags` key)
> When `POST /bookmarks` is called
> Then the response body includes `"tags": []`
>
> **AC-4 — GET /bookmarks returns all bookmarks**
> Given one or more bookmarks have been created
> When `GET /bookmarks` is called
> Then the response status is `200`
> And the response body is a JSON array of all bookmark objects, each with `id`, `url`, `title`, `tags`
>
> **AC-5 — GET /bookmarks returns empty array when no bookmarks exist**
> Given no bookmarks have been created
> When `GET /bookmarks` is called
> Then the response status is `200`
> And the response body is `[]`
>
> **AC-6 — DELETE /bookmarks/:id removes the bookmark and returns 204**
> Given a bookmark with a known id exists
> When `DELETE /bookmarks/:id` is called with that id
> Then the response status is `204`
> And the response body is empty
> And a subsequent `GET /bookmarks` does not include that bookmark
>
> **AC-7 — DELETE /bookmarks/:id for a non-existent id**
> Given no bookmark with id `99999` exists
> When `DELETE /bookmarks/99999` is called
> Then the response status is `204` (idempotent delete — the spec does not require 404 on missing)
>
> **AC-8 — Content-Type is application/json on 201 and 200 responses**
> Given any successful `POST /bookmarks` or `GET /bookmarks` request
> Then the `Content-Type` response header includes `application/json`

##### UX and design specification

N/A — no frontend component. This is a backend-only JSON API session.

##### Critical implementation notes

- **Route file pattern:** `app/routes/bookmarks.rb` MUST NOT redefine `Bookmarks::App`. It must reopen the already-defined class. The canonical pattern is:
  ```ruby
  require_relative '../app'    # ensures Bookmarks::App exists
  require_relative '../store'  # ensures Store exists

  module Bookmarks
    class App
      post '/bookmarks' do
        # ...
      end
      # ...
    end
  end
  ```
  Alternatively, use `Bookmarks::App.class_eval`. Never write `class Bookmarks::App < Sinatra::Base` in a route file — that would attempt to reopen with a superclass and may raise a `TypeError` or silently shadow the original.

- **`app/app.rb` already `require`s all route files.** The `require` chain is: `config.ru` → `require './app/app'` → `app/app.rb` requires `app/routes/bookmarks`, `app/routes/tags`, `app/routes/health`, `app/routes/status`, and `app/store`. Therefore `app/routes/bookmarks.rb` must be safe to require after `app/app.rb` has already been partially executed. Use `require_relative` carefully to avoid circular-require issues — call `require_relative '../store'` only if it has not already been loaded (Ruby's `require` family is idempotent by load path, `require_relative` by absolute path).

- **Status 201 for POST:** `post '/bookmarks'` MUST set status 201 explicitly: `status 201` or `[201, {...}.to_json]`. Sinatra defaults to 200; omitting the explicit status is a silent failure.

- **Status 204 for DELETE:** `delete '/bookmarks/:id'` MUST return status 204 with an empty body. Do NOT return a JSON body on 204 — some clients and proxies reject 204 responses with a body.

- **Request body parsing:** Sinatra does not auto-parse JSON request bodies. The route handler must call `request.body.rewind` then `JSON.parse(request.body.read)` (or equivalent) to access the posted JSON. `params` will be empty for raw JSON POST bodies.

- **`Store` is a class with class methods or an instantiated object — match S1-A's interface exactly.** The spec declares `Store#create`, `Store#all`, `Store#find`, `Store#delete` — if S1-A implements these as instance methods on a shared singleton, use that. If as class methods, use `Store.create(...)`. The route file must match whatever S1-A ships; do not assume one or the other — read S1-A's `app/store.rb`.

- **Idempotent DELETE:** Per AC-7, `DELETE /bookmarks/99999` where 99999 does not exist should return 204, not 404. Do not raise or redirect on missing-id delete.

- **Row-level isolation:** The fixture database is shared. `spec/spec_helper.rb` (S0-A) performs a `TRUNCATE` in `before(:each)` to isolate each spec. Do not attempt to reset the schema in the bookmarks spec; rely on `spec_helper`.

- **JSON response body:** All non-204 success responses must be valid JSON. The `content_type :json` is set globally in `app/app.rb`; route handlers need only return a `.to_json` string (or use `JSON.generate`). Do not set `content_type` again in route handlers — it is already set.

- **`halt` vs `return`:** In Sinatra, use `halt 204` to exit early with no body, or ensure the last expression is the body string. A bare `return` with no value returns `nil`, which Sinatra will coerce to an empty string — that is acceptable for 204 as long as status is set correctly.

- **Tags defaulting:** When the parsed JSON body does not include a `"tags"` key, pass `tags: []` to `Store#create`. Do not pass `nil` — the store interface specifies the default as `[]`.

- **Cross-session contract (load-bearing):** The bookmark hash shape `{ id, url, title, tags: [] }` is used by S2-B (tags routes) which calls `Store#find` and returns the same shape. Do not invent additional fields or rename existing ones in route responses.

##### Mocking contract

**Backend session — no frontend mocking required.**

This session depends on the following internal interfaces from other sessions:

| Source session | Interface | Exact shape |
|---|---|---|
| S1-A (`app/store.rb`) | `Store#create(url:, title:, tags: [])` | Returns `{ id: Integer, url: String, title: String, tags: Array<String> }` (Ruby hash with symbol or string keys — match S1-A's actual output) |
| S1-A (`app/store.rb`) | `Store#all` | Returns `Array` of bookmark hashes as above |
| S1-A (`app/store.rb`) | `Store#find(id)` | Returns bookmark hash or `nil` |
| S1-A (`app/store.rb`) | `Store#delete(id)` | Returns void; no meaningful return value consumed |

The integration spec tests against a live Postgres fixture database — no HTTP mocking or stub store is used. Tests hit the actual Rack app via `rack-test`.

##### Acceptance criteria checklist

- [ ] `POST /bookmarks` with valid JSON body returns status `201` [US-003 AC-1]
- [ ] `POST /bookmarks` response body is a JSON bookmark object with `id`, `url`, `title`, `tags` fields [US-003 AC-1]
- [ ] Created bookmark appears in a subsequent `GET /bookmarks` response [US-003 AC-1]
- [ ] `POST /bookmarks` with `"tags": ["ruby"]` returns `"tags": ["ruby"]` in response body [US-003 AC-2]
- [ ] Tags are persisted: subsequent `GET /bookmarks` includes those tags on the returned bookmark [US-003 AC-2]
- [ ] `POST /bookmarks` with no `tags` key in request body returns `"tags": []` in response body [US-003 AC-3]
- [ ] `GET /bookmarks` after creating bookmarks returns status `200` and a JSON array of all bookmarks [US-003 AC-4]
- [ ] Each element in the `GET /bookmarks` array has `id`, `url`, `title`, `tags` fields [US-003 AC-4]
- [ ] `GET /bookmarks` when no bookmarks exist returns status `200` and `[]` [US-003 AC-5]
- [ ] `DELETE /bookmarks/:id` for an existing bookmark returns status `204` [US-003 AC-6]
- [ ] `DELETE /bookmarks/:id` response body is empty [US-003 AC-6]
- [ ] After `DELETE /bookmarks/:id`, the deleted bookmark does not appear in `GET /bookmarks` [US-003 AC-6]
- [ ] `DELETE /bookmarks/99999` (non-existent id) returns status `204` [US-003 AC-7]
- [ ] `POST /bookmarks` success response includes `Content-Type: application/json` header [US-003 AC-8]
- [ ] `GET /bookmarks` success response includes `Content-Type: application/json` header [US-003 AC-8]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/bookmarks_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration/bookmarks_spec.rb`
- **Working directory** (`test.cwd`): repo root (omit — runs from repo root)
- **AC → assertion mapping**:

| AC | `it(...)` block |
|---|---|
| US-003 AC-1 (status 201) | `it "returns 201 status"` |
| US-003 AC-1 (response body shape) | `it "returns the created bookmark as JSON"` |
| US-003 AC-1 (persisted) | `it "persists the bookmark so it appears in GET /bookmarks"` |
| US-003 AC-2 (tags stored in response) | `it "stores and returns tags in the response"` |
| US-003 AC-2 (tags persisted) | `it "persists tags so they appear in GET /bookmarks"` |
| US-003 AC-3 (no tags defaults to []) | `it "defaults to empty tags array when no tags key is provided"` |
| US-003 AC-4 (GET returns 200 + all bookmarks) | `it "returns 200 and a JSON array of all bookmarks"` |
| US-003 AC-4 (each element has correct fields) | `it "returns 200 and a JSON array of all bookmarks"` (same block, inspects fields) |
| US-003 AC-5 (GET empty returns []) | `it "returns 200 and empty array when no bookmarks exist"` |
| US-003 AC-6 (DELETE returns 204) | `it "returns 204 when deleting an existing bookmark"` |
| US-003 AC-6 (DELETE body is empty) | `it "returns 204 when deleting an existing bookmark"` (same block) |
| US-003 AC-6 (bookmark gone after DELETE) | `it "removes the bookmark so it no longer appears in GET /bookmarks"` |
| US-003 AC-7 (DELETE non-existent returns 204) | `it "returns 204 when deleting a non-existent bookmark"` |
| US-003 AC-8 (Content-Type on POST) | `it "returns Content-Type application/json on POST /bookmarks"` |
| US-003 AC-8 (Content-Type on GET) | `it "returns Content-Type application/json on GET /bookmarks"` |

- **Fixtures / test doubles**: No mocks. Tests use a live Postgres fixture database provisioned by the Phase 0 harness (`spec/spec_helper.rb`). `rack-test` drives the Sinatra app directly via `include Rack::Test::Methods` / `def app; Bookmarks::App; end`. Per-spec isolation via `TRUNCATE bookmarks, bookmark_tags CASCADE` in `before(:each)` (performed by `spec_helper`).

- **Pre-conditions**:
  - `DATABASE_URL` environment variable set (default in `spec_helper`: `postgres://postgres:postgres@localhost:5432/canary_test`)
  - Postgres running and `canary_test` database provisioned with schema (done by Phase 0 harness / `spec_helper`)
  - S1-A merged: `app/store.rb` present and `Store` class functional
  - S0-A merged: `app/app.rb` present, `spec/spec_helper.rb` present

- **Isolation rule**: This test MUST pass when S2-A's PR is the only feature PR merged after S0-A and S1-A. S2-B, S3-A, S3-B need not be merged. The bookmarks spec only exercises `POST /bookmarks`, `GET /bookmarks`, and `DELETE /bookmarks/:id` — no dependency on tags, health, or status routes.

- **No project-wide gate**: Do NOT embed `RuboCop`, `bundle exec rspec` (full suite), or any tree-wide lint inside this spec file. The CI workflow enforces those separately.

- **Self-verify before finishing (REQUIRED)**: Do NOT end the session until you have run `bundle exec rspec tests/integration/bookmarks_spec.rb` and seen it pass (green, 0 failures). Write the test file first and confirm it fails (red) before writing the implementation, then iterate until green. If Postgres is unreachable, surface it as a blocker — do not finish with a red or never-executed test.

---

> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome**: `POST /bookmarks`, `GET /bookmarks`, and `DELETE /bookmarks/:id` are fully functional — a client can create a bookmark and receive `201`, list all bookmarks and receive `200` with a JSON array, and delete a bookmark and receive `204` with the record removed.
- **Shippability claim**: This PR is independently mergeable to main even if no other Phase 2 or Phase 3 session has merged, provided S0-A and S1-A have already merged.

##### Output and handoff

| Export | Kind | Consuming session(s) | Load-bearing? |
|---|---|---|---|
| `app/routes/bookmarks.rb` — defines `POST /bookmarks`, `GET /bookmarks`, `DELETE /bookmarks/:id` on `Bookmarks::App` | Route module | S2-B (tags routes call `Store#find` on bookmarks created by these routes in integration tests); S3-A, S3-B (no direct dependency but share the Sinatra app) | [LOAD-BEARING] — `/bookmarks` endpoints are the primary data-entry surface; S2-B's `POST /bookmarks/:id/tags` presupposes a bookmark created via this session's route |

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/bookmarks_spec.rb",
    "file": "tests/integration/bookmarks_spec.rb"
  },
  "checkpoint": "POST /bookmarks, GET /bookmarks, and DELETE /bookmarks/:id are fully functional — a client can create a bookmark and receive 201, list all bookmarks and receive 200 with a JSON array, and delete a bookmark and receive 204 with the record removed.",
  "manualAcs": [],
  "exports": [
    {
      "kind": "module",
      "name": "app/routes/bookmarks",
      "shape": "app/routes/bookmarks.rb — reopens Bookmarks::App to register POST /bookmarks, GET /bookmarks, DELETE /bookmarks/:id"
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
      "note": "Phase 0 (S0-A) owns spec_helper.rb as a single owner; all feature sessions require it but never edit it."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Schema provisioned once by the Phase 0 harness (spec/spec_helper.rb) before any parallel integration spec runs. Per-spec row isolation via TRUNCATE in before(:each)."
    }
  ]
}
```