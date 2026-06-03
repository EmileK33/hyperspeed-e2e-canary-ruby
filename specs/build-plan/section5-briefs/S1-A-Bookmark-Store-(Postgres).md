---

#### S1-A — Bookmark Store (Postgres)

**Phase 1 | Backend API | Needs: S0-A**

##### Objective

Implement the `Store` class backed by Postgres that provides the four bookmark persistence methods (`create`, `all`, `find`, `delete`) consumed by every Phase 2 route session.

##### Scope

P0 MVP. All work in this session is P0 — there is no P1 deferral.

##### Technology constraints

- **Runtime floor (non-negotiable):** Ruby 3.3. All code (implementation + RSpec) MUST run on Ruby 3.3. Do NOT use syntax or stdlib APIs introduced in Ruby 3.4+ (e.g. no `it` block parameter, no `Hash#freeze_keys`, no new `Range#step` semantics from 3.4, no `Set` as a core class — `require 'set'`). Stick to the Ruby 3.3 stdlib. If newer behavior is needed, use a maintained gem targeting Ruby 3.3.
- **Database driver:** `pg` gem (already in `Gemfile` from S0-A). Do NOT add ActiveRecord, Sequel, or any other ORM.
- **HTTP framework:** None in this session — `Store` is a plain Ruby class. Do NOT require Sinatra here.
- **Test framework:** RSpec (already configured by S0-A's `spec/spec_helper.rb` and `.rspec`).
- **No type signatures / RBS** — Ruby is dynamically typed in this project; cross-session contract proof is advisory only.

##### Performance targets

None — no SLA stated in spec for the store layer. See downstream sessions for any monitoring targets.

##### Pre-installed environment

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
> - **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than Ruby 3.3 in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** `bundle install --path vendor/bundle`
> - **Session-specific installs run for this session:** none
>
> Do NOT include `bundle install` / `gem install` in your implementation — it has already run. Do NOT re-declare these gems in any setup or readme.

A Postgres 16 service is running on `localhost:5432` with user `postgres`, password `postgres`, database `canary_test`. Use the `DATABASE_URL` env var if set, otherwise default to `postgres://postgres:postgres@localhost:5432/canary_test`.

##### Owned files

- `app/store.rb` — defines `Bookmarks::Store` (or top-level `Store`; see Critical implementation notes) with `#create`, `#all`, `#find`, `#delete`, plus DDL bootstrap (`CREATE TABLE IF NOT EXISTS`).
- `tests/integration/store_spec.rb` — RSpec integration spec exercising all four methods against the real fixture Postgres.

##### Read-only imports

- From **S0-A**: `spec/spec_helper.rb` (loaded automatically by `.rspec`'s `--require spec_helper`); `Gemfile` (already provides `pg`, `rspec`, `rack-test`); `app/app.rb` (NOT required by this session — `Store` is independent of the Sinatra app).

##### Do not touch

- `app/app.rb` (S0-A)
- `Gemfile`, `Gemfile.lock` (S0-A)
- `spec/spec_helper.rb` (S0-A — single-owner; never edited after Phase 0)
- `.rspec` (S0-A)
- `tests/integration/harness_spec.rb` (S0-A)
- Any future `app/routes/*.rb` file (Phase 2 sessions)
- `vitest.workspace.ts` or any test-runner workspace registry (N/A for Ruby, but stated for completeness)

##### Architecture context

From the distilled spec, verbatim:

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

Database schema (minimum implied; this session owns the DDL):

```sql
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

Environment:

| Variable | Type | Default if absent | Behavior if absent |
|---|---|---|---|
| `DATABASE_URL` | String | None | App boots but all DB calls raise connection error |

Cross-session pattern: "Fixture Postgres rows — Shared single DB; sessions use isolated rows."

##### User stories and acceptance criteria

The source spec defines feature scope as: **Phase 1: Bookmark store (`app/store.rb`) — `Store#create`, `#all`, `#find`, `#delete`**. There are no separately-numbered US for the store layer in the distilled spec; the contract IS the acceptance criteria. Stated verbatim:

- `Store#create(attrs)` — inserts a bookmark row, returns the created record.
- `Store#all` — returns all bookmark rows.
- `Store#find(id)` — returns one bookmark row or nil.
- `Store#delete(id)` — removes one bookmark row.

(Brand color, status, health, tag and bookmark route US — US-001 through US-006 — are implemented by Phase 2/3 sessions, not here.)

##### UX and design specification

N/A — backend persistence layer, no frontend component.

##### Critical implementation notes

- **Schema bootstrap is idempotent.** Use `CREATE TABLE IF NOT EXISTS …` (and `CREATE INDEX IF NOT EXISTS`) so the test suite can run repeatedly against the same fixture DB without exploding. Direct quote from shared-resources contract: setup must be `idempotent` — "`CREATE … IF NOT EXISTS`, upserts."
- **Test isolation by rows, not by schema.** Per spec: "Shared single DB; sessions use isolated rows to avoid collision." In the spec's `before(:each)`, `TRUNCATE bookmarks RESTART IDENTITY CASCADE` (CASCADE will also clear `tags`). Do NOT drop or recreate tables in test setup.
- **`Store#create(attrs)` must return the created record** (including its newly-assigned `id`). Use `INSERT … RETURNING *`. Returning `nil`, `true`, or the input hash unchanged is wrong — Phase 2's `POST /bookmarks` route serializes the returned record to JSON with its `id`.
- **`Store#find(id)` returns `nil` (not raises) when the row is absent.** Phase 2 routes branch on `nil` to produce 404s.
- **`Store#delete(id)` removes the row.** Return value is unspecified by the contract; do not raise when the id is missing (just no-op delete) — Phase 2 may issue idempotent deletes.
- **Record shape.** Return hashes with symbol keys for bookmarks: `{ id: Integer, url: String, title: String }`. Use `PG::Connection#type_map_for_results = PG::BasicTypeMapForResults.new(conn)` (or manual `to_i`) so `id` comes back as Integer, not String. Symbol keys are conventional Ruby; downstream routes will `.to_json` them.
- **Connection management.** Lazily open the `PG::Connection` at `Store.new` (or memoize at first call). Read `ENV.fetch('DATABASE_URL') { 'postgres://postgres:postgres@localhost:5432/canary_test' }`. Do NOT hardcode credentials anywhere else.
- **Use parameterized queries** (`conn.exec_params`) for every value-bearing query. Never string-interpolate user input — even though there is no auth layer, SQL injection in tests will silently corrupt the shared fixture DB and produce baffling Phase 2 failures.
- **Constructor signature.** `Store.new` with no required args is the simplest API for Phase 2 to call (`Store.new`). If you accept an optional connection-override for testing, it must be a keyword arg with a default, not positional, so the no-arg form keeps working.
- **Namespacing.** The spec writes the contract as `Store#…` (top-level). Define the class as top-level `Store` so Phase 2 sessions can call `Store.new` without guessing a namespace. (Phase 2 briefs will be told to call `Store`.)
- **Do not require any route file.** `app/store.rb` must be loadable in isolation (`require_relative '../app/store'` from the spec works without any Sinatra bootstrap).
- **Silent failure mode to avoid:** if `#create` returns the input attrs hash instead of the DB-returned row, `id` will be missing or `nil`, and Phase 2's `DELETE /bookmarks/:id` and `POST /bookmarks/:id/tags` will fail with confusing 404s much later. Always return `RETURNING *` results.

##### Mocking contract

Backend session, no inter-session events. Internal dependencies consumed:

- **Postgres** (provisioned by harness): connect via `ENV['DATABASE_URL']` or the default `postgres://postgres:postgres@localhost:5432/canary_test`. No payload shape — raw SQL via `pg`.

This session produces the `Store` class consumed by Phase 2 (`bookmarks.rb`, `tags.rb`) and Phase 3 (`health.rb`, `status.rb` if they need DB; status currently does not). Shape of return values:

```ruby
Store#create(url:, title:) #=> { id: Integer, url: String, title: String }
Store#all                  #=> Array<{ id:, url:, title: }>
Store#find(id)             #=> { id:, url:, title: } | nil
Store#delete(id)           #=> (return value unspecified; does not raise)
```

##### Acceptance criteria checklist

- [ ] `Store.new` succeeds when `DATABASE_URL` points at a reachable Postgres instance [contract]
- [ ] Calling the store after construction creates `bookmarks` and `tags` tables idempotently (`IF NOT EXISTS`); running setup twice does not raise [contract]
- [ ] `Store#create(url:, title:)` inserts a row and returns a hash containing `:id` (Integer), `:url`, `:title` matching the input [contract: "inserts a bookmark row, returns the created record"]
- [ ] `Store#create` returns a record whose `:id` is non-nil and assigned by the DB (not the caller) [silent-failure guard]
- [ ] `Store#all` returns every inserted row as an Array of hashes with `:id`, `:url`, `:title` [contract: "returns all bookmark rows"]
- [ ] `Store#all` returns `[]` (not `nil`) when the table is empty [edge case]
- [ ] `Store#find(id)` returns the row matching `id` as a hash [contract: "returns one bookmark row"]
- [ ] `Store#find(id)` returns `nil` when no row matches (does NOT raise) [contract: "or nil"]
- [ ] `Store#delete(id)` removes the row so a subsequent `Store#find(id)` returns `nil` [contract: "removes one bookmark row"]
- [ ] `Store#delete(id)` does not raise when no row matches (idempotent delete) [silent-failure guard]
- [ ] Spec uses `TRUNCATE … RESTART IDENTITY CASCADE` in `before(:each)` so tests are order-independent [isolation rule]
- [ ] Parameterized queries (`exec_params`) are used for all value-bearing SQL — no string interpolation of input [security/integrity]

(No `[MANUAL]` items in this session.)

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/store_spec.rb`
- **Exact CI command:** `bundle exec rspec tests/integration/store_spec.rb`
- **Working directory:** repo root (omit `cwd`).
- **AC → assertion mapping:**

| AC | `it(...)` block |
|---|---|
| `Store.new` connects | `it "constructs against DATABASE_URL"` |
| Idempotent DDL | `it "creates schema idempotently on repeat construction"` |
| `#create` returns hash w/ id | `it "#create returns a hash with a db-assigned :id and the input :url/:title"` |
| `#create` id is non-nil Integer | (same as above — asserts `expect(row[:id]).to be_a(Integer)`) |
| `#all` returns all rows | `it "#all returns every inserted row"` |
| `#all` empty → `[]` | `it "#all returns [] when no rows exist"` |
| `#find(id)` returns row | `it "#find returns the matching row as a hash"` |
| `#find(id)` returns nil | `it "#find returns nil when the id is absent"` |
| `#delete(id)` removes row | `it "#delete removes the row so #find returns nil after"` |
| `#delete(id)` no-op when absent | `it "#delete does not raise when the id is absent"` |
| TRUNCATE in `before(:each)` | (structural — covered by suite executing in any order; add `it "tests are isolated by truncation"` that inserts then asserts `#all.length == 1`, relying on the truncation having cleared prior tests) |
| Parameterized queries | `it "#create stores values verbatim including SQL metacharacters"` — inserts a title like `"Robert'); DROP TABLE bookmarks;--"` and asserts the table still exists and the title round-trips |

- **Fixtures / test doubles:** None — uses the real fixture Postgres at `DATABASE_URL` (or the default). No mocks.
- **Pre-conditions:** Postgres reachable on `localhost:5432` with db `canary_test` (already true per Project Requirements). `spec/spec_helper.rb` from S0-A is auto-loaded via `.rspec`'s `--require spec_helper`.
- **Isolation rule:** This spec passes when S1-A is the only merged PR in its wave (Phase 1 has no siblings — trivially satisfied).
- **No project-wide gate:** Do NOT shell out to lint/typecheck the whole tree from inside this spec. Test only `Store`.
- **Self-verify before finishing (REQUIRED):** Run `bundle exec rspec tests/integration/store_spec.rb` and observe it green before ending the session. If Postgres is unreachable, that is a blocker to surface, not a reason to ship red.

##### Version control is the runner's job (do NOT push or open a PR)

> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **Observable outcome:** After this PR merges, running `bundle exec rspec tests/integration/store_spec.rb` exits 0, and an operator can `require_relative 'app/store'; s = Store.new; s.create(url: 'https://example.com', title: 'Ex'); puts s.all.inspect` and see the inserted row echoed back with a numeric `id`.
- **Shippability claim:** This PR is independently mergeable to main even if no other session in the same wave has merged. (Phase 1 contains only this session.)

##### Output and handoff

- `app/store.rb` defining top-level class `Store` with public instance methods `#create(url:, title:)`, `#all`, `#find(id)`, `#delete(id)` `[LOAD-BEARING]` — consumed by S2-A, S2-B, S2-C, S2-D.
- Schema (`bookmarks`, `tags` tables) created idempotently on `Store.new` — consumed implicitly by S2-B (tags) which reads/writes the `tags` table.

---

```json
{
  "test": { "cmd": "bundle exec rspec tests/integration/store_spec.rb", "file": "tests/integration/store_spec.rb" },
  "checkpoint": "Running `bundle exec rspec tests/integration/store_spec.rb` exits 0 and `Store#create/#all/#find/#delete` round-trip bookmark rows against the fixture Postgres.",
  "manualAcs": [],
  "exports": [
    { "kind": "module", "name": "app/store", "shape": "app/store.rb" },
    { "kind": "function", "name": "Store#create", "shape": "(url: String, title: String) => { id: Integer, url: String, title: String }" },
    { "kind": "function", "name": "Store#all", "shape": "() => Array<{ id: Integer, url: String, title: String }>" },
    { "kind": "function", "name": "Store#find", "shape": "(id: Integer) => { id: Integer, url: String, title: String } | nil" },
    { "kind": "function", "name": "Store#delete", "shape": "(id: Integer) => void" }
  ],
  "imports": [],
  "sharedFiles": [],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "idempotent", "note": "Schema bootstrap uses CREATE TABLE IF NOT EXISTS; tests isolate via TRUNCATE … RESTART IDENTITY CASCADE in before(:each). Postgres itself is provisioned run-once by the Phase 0 harness." }
  ]
}
```