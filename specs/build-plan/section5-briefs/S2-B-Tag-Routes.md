#### S2-B — Tag Routes

**Phase 2 | Backend API | Needs: S1-A**

##### Objective

Implement the `POST /bookmarks/:id/tags` and `GET /tags` Sinatra routes, wiring them to the `Store` from Phase 1, so callers can attach tags to bookmarks and list all tags across the system.

##### Scope

**P0 MVP** — all work in this session is P0. No P1 stubs required.

P0 stories:
- US-004: `POST /bookmarks/:id/tags` — add a tag to a bookmark, return updated bookmark (HTTP 200)
- US-005: `GET /tags` — list all tags (HTTP 200)

##### Technology constraints

| Constraint | Detail |
|---|---|
| Ruby version | **3.3** (floor — non-negotiable) |
| HTTP framework | `sinatra` gem; route file must subclass or register with `Bookmarks::App` (defined in `app/app.rb`) |
| Datastore | `pg` gem; all DB access goes through `Store` (from `app/store.rb`); do NOT reach into `PG::Connection` directly |
| Test framework | `rspec` + `rack-test`; specs live under `tests/integration/` |
| Must NOT use | Any Ruby API introduced after 3.3 (e.g., do not rely on features specific to 3.4+) |
| Must NOT use | ActiveRecord, Sequel, or any ORM not declared in the Gemfile |
| Must NOT use | Any gem not already declared in the `Gemfile` (`sinatra`, `pg`, `rspec`, `rack-test`) |

**Runtime floor — non-negotiable.** This project's declared runtime floor is **Ruby 3.3**. All implementation and test code MUST run on Ruby 3.3. Do not use syntax or standard-library APIs introduced in Ruby 3.4 or later. Apply the Ruby 3.3 floor strictly; use only features available in the 3.3 stdlib.

##### Performance targets

None — see downstream sessions. No SLA is directly owned by this session.

##### Pre-installed environment

Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:

- **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
- **Runtimes:** `ruby 3.3` — **this version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than 3.3 in implementation OR test code (see Technology constraints).**
- **Workspace installs run:** `bundle install --path vendor/bundle`
- **Session-specific installs run for this session:** none

Do NOT run `bundle install` in your implementation — it has already run. Do NOT re-declare these dependencies in any setup or readme.

##### Performance targets

None — see downstream sessions.

##### Pre-installed environment

(See above.)

##### Owned files

- `app/routes/tags.rb` — implements `POST /bookmarks/:id/tags` and `GET /tags`
- `tests/integration/tags_spec.rb` — RSpec integration spec for these routes

##### Read-only imports

| Session | File | Symbols / contract used |
|---|---|---|
| S0-A | `app/app.rb` | `Bookmarks::App` (Sinatra base class; `tags.rb` registers routes against it) |
| S0-A | `spec/spec_helper.rb` | RSpec + rack-test wiring (`app` helper, shared DB setup) |
| S1-A | `app/store.rb` | `Store#create`, `Store#all`, `Store#find`, `Store#delete` (full contract listed in §1.1) |

##### Do not touch

- `app/app.rb` — pre-stubbed by S0-A; must not be modified
- `Gemfile` / `Gemfile.lock` — owned by S0-A
- `spec/spec_helper.rb` — single-owner S0-A; frozen after Phase 0
- `app/store.rb` — owned by S1-A
- `app/routes/bookmarks.rb` — owned by S2-A
- `app/routes/health.rb` — owned by S2-C
- `app/routes/status.rb` — owned by S2-D
- `tests/integration/harness_spec.rb` — owned by S0-A
- `tests/integration/store_spec.rb` — owned by S1-A
- `tests/integration/bookmarks_spec.rb` — owned by S2-A
- `tests/integration/health_spec.rb` — owned by S2-C
- `tests/integration/status_spec.rb` — owned by S2-D
- `.rspec` — owned by S0-A
- **`vitest.workspace.ts` / `vitest.workspace.js`** — N/A for this Ruby project; the equivalent shared test registry is `spec/spec_helper.rb`, owned by S0-A. Never edit it.

##### Architecture context

Verbatim from distilled spec §1.1 (Shared contracts):

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

Verbatim from distilled spec §1.2 (Database schema):

> ```sql
> -- Minimum implied schema; exact DDL owned by app/store.rb (Phase 1)
> CREATE TABLE bookmarks (
>   id    SERIAL PRIMARY KEY,
>   url   TEXT NOT NULL,
>   title TEXT NOT NULL
> );
>
> CREATE TABLE tags (
>   id          SERIAL PRIMARY KEY,
>   bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
>   name        TEXT    NOT NULL
> );
>
> CREATE INDEX ON tags(bookmark_id);
> CREATE INDEX ON tags(name);
> ```
>
> Note: Exact DDL is implementation-defined by Phase 1; the above is the minimum required to satisfy all AC.

Verbatim from distilled spec §1.5 (HTTP status code contracts):

> | Condition | Required code | Must never return |
> |---|---|---|
> | `POST /bookmarks/:id/tags` — tag added | `200` (returns updated bookmark) | — |
> | `GET /tags` — success | `200` | — |
> | Unknown route | `404` with `{ "error": string }` body | `200` |

Verbatim from distilled spec §1.6 (Route manifest):

> - `POST /bookmarks/:id/tags`
> - `GET /tags`

Verbatim from distilled spec §1.8 (Technology stack):

> | Layer | Choice | Architecturally irreversible reason |
> |---|---|---|
> | Runtime | Ruby 3.3 | Declared in spec; fixture targets Ruby ecosystem proof for #144 |
> | HTTP framework | Sinatra (`Sinatra::Base`) | Specified; `Bookmarks::App` subclasses `Sinatra::Base` |
> | Datastore | Postgres | Specified; `pg` gem; connected via `DATABASE_URL` |
> | Test framework | RSpec | Specified; integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration` |
> | HTTP test adapter | rack-test | Specified as dev dependency |

Verbatim from distilled spec §1.11 (Cross-session runtime patterns):

> | Pattern | Written by | Read by | Notes |
> |---|---|---|---|
> | Fixture Postgres rows | All feature phase sessions | All feature phase sessions | Shared single DB; sessions use isolated rows |
> | `Store` object (`app/store.rb`) | Phase 1 | Phase 2 (`bookmarks.rb`, `tags.rb`), Phase 3 (`health.rb`, `status.rb`) | Require/load dependency; not a network contract |
> | `spec/spec_helper.rb` | Phase 0 (single owner, never edited after) | All RSpec sessions | Shared test registry; frozen after Phase 0 |

Verbatim from distilled spec §1.12 (Environment variable schema):

> | Variable | Type | Valid values | Default if absent | Startup behavior if absent |
> |---|---|---|---|---|
> | `DATABASE_URL` | String | Valid PostgreSQL connection URI | None | App boots but all DB calls raise connection error |

Verbatim from distilled spec §1.4 (Critical ordering rules):

> 1. **Phase 0 before all feature phases:** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
> 2. **Phase 1 before Phase 2/3:** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."

##### User stories and acceptance criteria

**US-004 — Add a tag to a bookmark**

_As an API consumer I want to attach a named tag to an existing bookmark so that I can categorise bookmarks._

**AC-1 (Happy path):** Given a bookmark with `id=1` exists, when I `POST /bookmarks/1/tags` with body `{ "name": "ruby" }`, then the response status is `200` and the response body includes the updated bookmark record with the tag `"ruby"` associated.

**AC-2 (Missing bookmark):** Given no bookmark exists with `id=9999`, when I `POST /bookmarks/9999/tags` with body `{ "name": "ruby" }`, then the response status is `404` and the body contains `{ "error": <string> }`.

**AC-3 (Content-Type):** The response to a successful `POST /bookmarks/:id/tags` includes `Content-Type: application/json`.

---

**US-005 — List all tags**

_As an API consumer I want to retrieve every tag in the system so that I can build a full taxonomy view._

**AC-1 (Happy path):** When I `GET /tags`, the response status is `200` and the body is a JSON array of tag objects (may be empty).

**AC-2 (Non-empty):** Given at least one tag has been created (via `POST /bookmarks/:id/tags`), when I `GET /tags`, the response body includes that tag.

**AC-3 (Content-Type):** The response includes `Content-Type: application/json`.

##### UX and design specification

N/A — no frontend component. This is a backend-only session delivering JSON API endpoints.

##### Critical implementation notes

- **`POST /bookmarks/:id/tags` must return HTTP 200** (not 201) with the updated bookmark record as JSON. This is specified in §1.5 and is a load-bearing contract consumed by clients.
- **`GET /tags` must return HTTP 200** with a JSON array. An empty array is valid when no tags exist.
- **404 for unknown bookmark id**: when `Store#find(id)` returns `nil` for `POST /bookmarks/:id/tags`, return `404` with `{ "error" => "Not found" }` (or equivalent message). Never return `500` for a missing resource.
- **Error response shape**: all error responses must use `{ "error" => String }` — verbatim from §1.1. The key must be the string `"error"`, not a symbol.
- **Route registration**: `app/routes/tags.rb` must register its routes against `Bookmarks::App` (defined in `app/app.rb`). The glob-based `require` in `app/app.rb` will load this file automatically — do not modify `app/app.rb`.
- **`Store` is the only DB access path**: do not open a `PG::Connection` directly from a route file. All persistence goes through `Store#create`, `#all`, `#find`, `#delete`.
- **`Store#create` for tags**: the `attrs` hash passed to `Store#create` for a tag must include at minimum `bookmark_id` and `name`. The exact column names are owned by S1-A's DDL (see §1.2 schema).
- **JSON serialisation**: use `JSON.generate` / `JSON.parse` from Ruby's stdlib `json` library (available in Ruby 3.3 stdlib — no extra gem needed). Set `content_type :json` on every response from these routes.
- **Isolation**: each spec example must create its own isolated rows (unique URL/title for bookmarks, unique tag names) to avoid collisions with sibling sessions running against the same fixture DB.
- **`DATABASE_URL` must be set** for specs to reach Postgres. In CI the value is `postgres://postgres:postgres@localhost:5432/canary_test` (derived from the `services` block in project requirements). Specs must read this from the environment — do not hard-code credentials.
- **No shell operators in `test.cmd`**: the runner uses `shell: false`; the CI command must be a single binary invocation.
- **TDD workflow required**: write `tests/integration/tags_spec.rb` first, verify it fails (red), then implement `app/routes/tags.rb` until it passes (green).

##### Mocking contract

This is a backend session. There are no frontend mocks to define.

**Internal dependencies this session consumes from other sessions:**

| Producing session | Interface | Exact contract |
|---|---|---|
| S1-A (`app/store.rb`) | `Store#create(attrs)` | inserts a row; `attrs` for a tag: `{ bookmark_id: Integer, name: String }`; returns created record |
| S1-A (`app/store.rb`) | `Store#all` | returns all bookmark rows as array |
| S1-A (`app/store.rb`) | `Store#find(id)` | returns one bookmark row or `nil` |
| S1-A (`app/store.rb`) | `Store#delete(id)` | removes one bookmark row (used in `after` cleanup) |
| S0-A (`spec/spec_helper.rb`) | `app` rack-test helper | returns `Bookmarks::App` instance wired into rack-test |
| S0-A (`app/app.rb`) | `Bookmarks::App` class | Sinatra base; route file opens it with `Bookmarks::App.get`, `Bookmarks::App.post`, or reopens the class |

##### Acceptance criteria checklist

- [ ] `POST /bookmarks/:id/tags` with a valid bookmark id returns HTTP 200 [US-004 AC-1]
- [ ] Response body for successful `POST /bookmarks/:id/tags` includes the updated bookmark with the new tag associated [US-004 AC-1]
- [ ] `POST /bookmarks/:id/tags` with a non-existent bookmark id returns HTTP 404 [US-004 AC-2]
- [ ] `POST /bookmarks/:id/tags` 404 response body contains `{ "error": <string> }` [US-004 AC-2]
- [ ] Successful `POST /bookmarks/:id/tags` response includes `Content-Type: application/json` [US-004 AC-3]
- [ ] `GET /tags` returns HTTP 200 [US-005 AC-1]
- [ ] `GET /tags` response body is a JSON array (empty array is valid) [US-005 AC-1]
- [ ] `GET /tags` response body includes a previously created tag [US-005 AC-2]
- [ ] `GET /tags` response includes `Content-Type: application/json` [US-005 AC-3]
- [ ] Tags created via `POST /bookmarks/:id/tags` are persisted to Postgres and visible to subsequent `GET /tags` calls [US-005 AC-2 + US-004 AC-1 integration]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/tags_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration/tags_spec.rb`
- **Working directory** (`test.cwd`): repo root (no subdirectory needed)

**AC → assertion mapping:**

| AC | `it(...)` block |
|---|---|
| US-004 AC-1 | `it "returns 200 and the updated bookmark with the new tag"` |
| US-004 AC-2 | `it "returns 404 when bookmark does not exist"` |
| US-004 AC-3 | `it "returns Content-Type application/json for POST /bookmarks/:id/tags"` |
| US-005 AC-1 | `it "returns 200 and a JSON array from GET /tags"` |
| US-005 AC-2 | `it "includes a previously created tag in GET /tags"` |
| US-005 AC-3 | `it "returns Content-Type application/json for GET /tags"` |
| US-005 AC-2 + US-004 AC-1 integration | covered by the US-005 AC-2 example above (it first POSTs a tag then GETs /tags) |

**Fixtures / test doubles:**

- No external mocks — all tests hit the live fixture Postgres via rack-test.
- Each `it` block creates its own bookmark (unique URL/title) via `Store#create` in a `before` block, and tears it down in an `after` block via `Store#delete`.
- `spec/spec_helper.rb` (S0-A) provides the `app` rack-test helper and loads `Bookmarks::App`.

**Pre-conditions:**

- `DATABASE_URL` environment variable set to `postgres://postgres:postgres@localhost:5432/canary_test` (provided by CI services block).
- Postgres `bookmarks` and `tags` tables already exist (DDL run by S1-A's `Store` bootstrap, which S0-A's harness exercises before this session's specs run).
- `bundle install --path vendor/bundle` already executed.

**Isolation rule:**

This test file creates its own bookmarks with unique URLs and cleans them up in `after` hooks. It will pass when only this session's PR is merged (S1-A is a prerequisite, not a sibling). It does not depend on any sibling Phase 2 session (S2-A, S2-C, S2-D) having merged.

**Self-verify before finishing (REQUIRED):** Do NOT end the session until you have actually run `bundle exec rspec tests/integration/tags_spec.rb` and seen it pass. Implement, run the test, read the failure, fix, and repeat until it is green — green on the real command, not "looks correct." If the Postgres fixture is not reachable, surface it as a blocker; do not finish with a red or un-run test.

##### Version control is the runner's job (do NOT push or open a PR)

**The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome:** `POST /bookmarks/1/tags` with body `{"name":"ruby"}` returns HTTP 200 with a JSON body containing the updated bookmark and its tag, and `GET /tags` returns HTTP 200 with a JSON array that includes the newly created tag.
- **Shippability claim:** This PR is independently mergeable to main even if no other session in the same wave (S2-A, S2-C, S2-D) has merged — it depends only on S0-A (Phase 0) and S1-A (Phase 1), which are both prerequisites.

##### Output and handoff

| Export | Consuming session(s) | Load-bearing? |
|---|---|---|
| `app/routes/tags.rb` — `POST /bookmarks/:id/tags` route (HTTP 200 with updated bookmark) | None (terminal route session) | No |
| `app/routes/tags.rb` — `GET /tags` route (HTTP 200 JSON array) | None (terminal route session) | No |
| `tests/integration/tags_spec.rb` — picked up by `bundle exec rspec tests/integration` full-suite run in Phase 2 gate | Phase 2 gate (full integration run) | Yes — must remain green for the final `bundle exec rspec tests/integration` gate |

---

```json
{
  "test": {
    "cmd": "bundle exec rspec tests/integration/tags_spec.rb",
    "file": "tests/integration/tags_spec.rb"
  },
  "checkpoint": "POST /bookmarks/:id/tags returns HTTP 200 with the updated bookmark and its new tag, and GET /tags returns HTTP 200 with a JSON array containing the created tag.",
  "manualAcs": [],
  "exports": [
    {
      "kind": "module",
      "name": "app/routes/tags.rb",
      "shape": "Registers POST /bookmarks/:id/tags (200) and GET /tags (200) on Bookmarks::App"
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
      "note": "Phase 0 (S0-A) owns spec/spec_helper.rb as a single-owner file; all RSpec sessions require it but never edit it."
    }
  ],
  "sharedResources": [
    {
      "name": "fixture-postgres",
      "kind": "database",
      "coordination": "run-once",
      "note": "Postgres fixture provisioned once by the Phase 0 harness (S0-A) before any parallel session runs; this session uses isolated rows with unique URLs and cleans up in after hooks."
    }
  ]
}
```