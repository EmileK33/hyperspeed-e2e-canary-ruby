---

#### S1-A — Store (Postgres CRUD)

**Phase 1 | Backend API | Needs: S0-A**

##### Objective

Implement the `Store` class in `app/store.rb` that provides Postgres-backed CRUD over bookmarks and tags, exposing the canonical interface every downstream route file in Phases 2 and 3 consumes.

##### Scope

P0 MVP. All work in this session is P0 — implements US-001 in full. No P1 work in this session.

##### Technology constraints

- **Runtime floor (non-negotiable):** Ruby 3.3. Do NOT use syntax or stdlib APIs introduced after Ruby 3.3 (e.g., do not assume Ruby 3.4+ features). CI is pinned to Ruby 3.3 — code that works on a newer host but uses a post-3.3 API will fail CI.
- **Database driver:** `pg` gem only. Do NOT introduce ActiveRecord, Sequel, or any ORM.
- **Connection:** read `ENV['DATABASE_URL']`. Do NOT hardcode credentials.
- **No new gems.** All required gems are already declared in S0-A's `Gemfile` (`pg`, `sinatra`, `puma`, `json`, `rackup`, `rspec`, `rack-test`). Do NOT modify `Gemfile`.
- Ruby is dynamically typed; no static type annotations.

##### Performance targets

None — see downstream sessions. (Spec declares no SLAs.)

##### Pre-installed environment

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
> - **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** `bundle install --path vendor/bundle`
> - **Session-specific installs run for this session:** none
>
> Do NOT include `bundle install` in your implementation — it has already run. Do NOT re-declare these dependencies in any setup or readme.

##### Owned files

- `app/store.rb` — defines `Store` class (or `Bookmarks::Store`) with `create`, `all`, `find`, `delete` instance methods, plus tag-mutation helpers needed by Phase 2 (`add_tag`, `all_tags`).
- `tests/integration/store_spec.rb` — RSpec integration spec exercising the store against the live fixture Postgres.

##### Read-only imports

- From **S0-A**:
  - `spec/spec_helper.rb` — `require 'spec_helper'` at the top of the integration spec; provides `DATABASE_URL` default, schema provisioning, and per-spec row truncation.
  - `Gemfile` / `Gemfile.lock` — bundler environment (not edited).

No other session files exist yet (S1-A is the first feature session).

##### Do not touch

- `app/app.rb` (S0-A) — Sinatra base class.
- `config.ru`, `Rakefile`, `.rspec` (S0-A).
- `Gemfile` (S0-A) — all required gems already present; do NOT add or remove gems.
- `spec/spec_helper.rb` (S0-A) — the shared test-registry/harness analog; never edit it from a feature session.
- `tests/integration/harness_spec.rb` (S0-A).
- Any file under `app/routes/` — owned by Phase 2/3 sessions.

##### Architecture context

Verbatim from the distilled specification:

**1.1 Shared contracts — Store public interface (CRITICAL BOUNDARY):**

```ruby
# [CRITICAL BOUNDARY] Store public interface
Store#create(url:, title:, tags: [])  # → bookmark hash
Store#all                              # → Array of bookmark hashes
Store#find(id)                         # → bookmark hash | nil
Store#delete(id)                       # → void
```

Bookmark hash shape (used in all route responses):

```
{ id, url, title, tags: [] }
```

**1.2 Database schema** — managed by the store layer. Implied tables:

```sql
CREATE TABLE bookmarks (
  id    SERIAL PRIMARY KEY,
  url   TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE bookmark_tags (
  id          SERIAL PRIMARY KEY,
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag         TEXT    NOT NULL
);

CREATE INDEX ON bookmark_tags(bookmark_id);
CREATE INDEX ON bookmark_tags(tag);
```

Schema provisioning is run-once by the Phase 0 harness (`spec/spec_helper.rb`) via `CREATE TABLE IF NOT EXISTS …`. Per-spec isolation is row-level via `TRUNCATE` in `before(:each)`.

**1.4 Critical ordering rules:**
1. Phase 0 before all feature phases.
2. Phase 1 (`app/store.rb`) before Phase 2/3 — producer precedes consumer.

**1.11 Cross-session runtime patterns:**
- `Store` API (Ruby object interface) — written by Phase 1 (`app/store.rb`), read by Phase 2 (`app/routes/bookmarks.rb`, `app/routes/tags.rb`) and Phase 3 (`app/routes/health.rb`, `app/routes/status.rb`). ADVISORY unverified at plan time; proven by RSpec CI gate.

**1.12 Environment variable schema:**
- `DATABASE_URL` — String, valid Postgres connection URI. Default if absent: none. If absent, store cannot connect; all DB operations fail. The Phase 0 `spec_helper.rb` sets a default of `postgres://postgres:postgres@localhost:5432/canary_test` for the test environment.

##### User stories and acceptance criteria

The spec attributes all store CRUD behavior to **US-001 (Phase 1, Store with Postgres integration)**, with the public interface enumerated verbatim in §1.1. Acceptance criteria, derived strictly from the interface contract and bookmark hash shape:

- **US-001 AC-1:** `Store#create(url:, title:, tags: [])` inserts a bookmark and returns a hash of shape `{ id, url, title, tags: [] }`, where `id` is the newly assigned primary key and `tags` is the array as supplied.
- **US-001 AC-2:** `Store#create` with no `tags:` argument (or `tags: []`) returns a bookmark hash with `tags: []`.
- **US-001 AC-3:** `Store#create` with `tags: ['ruby', 'web']` persists those tags so a subsequent `Store#find(id)` returns the same tag set.
- **US-001 AC-4:** `Store#all` returns an Array of bookmark hashes in the shape `{ id, url, title, tags: [] }`, including the tags for each bookmark.
- **US-001 AC-5:** `Store#all` on an empty table returns `[]`.
- **US-001 AC-6:** `Store#find(id)` returns the bookmark hash for an existing id with its tags.
- **US-001 AC-7:** `Store#find(id)` returns `nil` for an id that does not exist.
- **US-001 AC-8:** `Store#delete(id)` removes the bookmark; a subsequent `Store#find(id)` returns `nil`.
- **US-001 AC-9:** `Store#delete(id)` cascades to `bookmark_tags` (no orphan tag rows remain for the deleted bookmark id).
- **US-001 AC-10:** The store connects to Postgres using `ENV['DATABASE_URL']`.

Helpers needed by Phase 2 routes (US-004) — also implemented and tested here as part of the store boundary:

- **US-001 AC-11:** `Store#add_tag(id, tag)` appends a tag to the named bookmark and returns the updated bookmark hash; returns `nil` if the bookmark does not exist.
- **US-001 AC-12:** `Store#all_tags` returns the distinct set of tag strings across all bookmarks, as an Array.

##### UX and design specification

N/A — backend-only session (headless JSON API; no frontend).

##### Critical implementation notes

- **Hash key consistency.** The bookmark hash MUST use symbol keys `:id`, `:url`, `:title`, `:tags` consistently. Route layers (Phase 2/3) will rely on this; mixing string and symbol keys is a silent-failure mode that breaks downstream JSON serialization.
- **`tags` is always an Array, never `nil`.** Even when a bookmark has zero tags, `tags: []`. If you `LEFT JOIN` and aggregate, filter out `NULL` tags or coalesce.
- **Use parameterized queries.** All SQL must use `conn.exec_params(sql, [...])`. Do NOT interpolate values into SQL strings — injection risk.
- **`id` is an Integer, not a String.** `pg` returns text by default; cast `id` to `Integer` before returning. Route layers will receive params as strings (`params[:id]`); the store should accept both `Integer` and `String` and cast internally with `Integer(id)`.
- **`Store#delete` returns void.** The spec contract is `void`. Do not return the deleted row.
- **`Store#find` returns `nil` on miss.** Do NOT raise. Routes depend on `nil` to issue 404s.
- **`ON DELETE CASCADE` is declared in the schema** (Phase 0). Do not also delete tag rows manually — let the FK cascade handle it. The test will assert no orphan rows remain.
- **Connection lifecycle.** Open a `PG::Connection` per call OR maintain a single class-level connection — either is acceptable, but it MUST be thread-safe enough for RSpec's sequential runs. Simplest correct approach: `PG.connect(ENV.fetch('DATABASE_URL'))` lazily memoized.
- **Schema is NOT created by the store.** `spec/spec_helper.rb` owns schema creation (`CREATE TABLE IF NOT EXISTS`). Do not add DDL to `app/store.rb`.
- **No direct `require` cycle with `app/app.rb`.** `app/app.rb` requires `app/store.rb`; the store must NOT require `app/app.rb`.
- **HTTP status codes are NOT this session's concern** — they are Phase 2/3. The store returns Ruby values only.

##### Mocking contract

Backend session. Internal dependencies consumed:

- **From Phase 0 (`spec/spec_helper.rb`):**
  - `ENV['DATABASE_URL']` is set (default `postgres://postgres:postgres@localhost:5432/canary_test`) before the store loads.
  - Tables `bookmarks` and `bookmark_tags` exist (created `IF NOT EXISTS`) with the schema in §1.2.
  - `before(:each)` truncates rows; specs assume an empty DB at start of each example.
  - `Rack::Test` mixin is configured (not used by this session's spec, but harmless).

This session itself produces the Ruby Store interface that S2-A, S2-B, S3-A, S3-B will import.

##### Acceptance criteria checklist

- [ ] `Store#create(url:, title:)` returns a hash `{ id:, url:, title:, tags: [] }` with `id` as Integer [US-001 AC-1, AC-2]
- [ ] `Store#create(url:, title:, tags: ['ruby','web'])` persists tags so `Store#find(id)[:tags]` returns the same set [US-001 AC-3]
- [ ] `Store#all` returns an Array of bookmark hashes including each bookmark's tags [US-001 AC-4]
- [ ] `Store#all` on empty DB returns `[]` [US-001 AC-5]
- [ ] `Store#find(id)` returns the bookmark hash for an existing id [US-001 AC-6]
- [ ] `Store#find(id)` returns `nil` for a missing id [US-001 AC-7]
- [ ] `Store#delete(id)` removes the bookmark (subsequent `find` returns `nil`) [US-001 AC-8]
- [ ] `Store#delete(id)` cascades — no `bookmark_tags` rows remain for the deleted bookmark id [US-001 AC-9]
- [ ] Store reads connection string from `ENV['DATABASE_URL']` [US-001 AC-10]
- [ ] `Store#add_tag(id, tag)` appends a tag and returns updated bookmark hash; returns `nil` for missing id [US-001 AC-11]
- [ ] `Store#all_tags` returns the distinct Array of tag strings across all bookmarks [US-001 AC-12]
- [ ] All bookmark hashes use symbol keys (`:id`, `:url`, `:title`, `:tags`) [technical]
- [ ] All SQL is parameterized via `exec_params` (no string interpolation of values) [technical]

##### Independent Test

This session must follow a TDD workflow — the Independent Test file is written FIRST and must fail before any implementation code is written.

- **Test file path:** `tests/integration/store_spec.rb`
- **Exact CI command:** `bundle exec rspec tests/integration/store_spec.rb`
- **Working directory:** repo root (omit `cwd`).
- **AC → assertion mapping:**
  - US-001 AC-1, AC-2 → `it("creates a bookmark with default empty tags and returns a hash with integer id")`
  - US-001 AC-3 → `it("persists tags supplied to create so find returns them")`
  - US-001 AC-4 → `it("all returns every bookmark with its tags")`
  - US-001 AC-5 → `it("all returns [] when no bookmarks exist")`
  - US-001 AC-6 → `it("find returns the bookmark hash for an existing id")`
  - US-001 AC-7 → `it("find returns nil for a missing id")`
  - US-001 AC-8 → `it("delete removes the bookmark")`
  - US-001 AC-9 → `it("delete cascades and leaves no orphan bookmark_tags rows")`
  - US-001 AC-10 → `it("connects via ENV['DATABASE_URL']")` (asserts ENV is set and a connection succeeds)
  - US-001 AC-11 → `it("add_tag appends a tag and returns the updated bookmark; nil for missing id")`
  - US-001 AC-12 → `it("all_tags returns the distinct array of tags across all bookmarks")`
  - technical (symbol keys) → `it("returns bookmark hashes with symbol keys")`
  - technical (parameterized SQL) → covered implicitly by an `it("safely stores a url containing single quotes")` assertion
- **Fixtures / test doubles:** none — runs against the real fixture Postgres provisioned by `spec/spec_helper.rb`. Each example starts with truncated tables.
- **Pre-conditions:** Postgres service reachable at the URL set by `spec/spec_helper.rb`; `bookmarks` and `bookmark_tags` tables exist (created by harness).
- **Isolation rule:** This spec must pass when only S0-A and S1-A are merged. No sibling Phase 2/3 sessions need to exist.
- **No project-wide gate in the spec.** Do not invoke a repo-wide typecheck or rubocop run inside the spec file.
- **Self-verify before finishing (REQUIRED):** run `bundle exec rspec tests/integration/store_spec.rb` and confirm green before stopping. If Postgres is not reachable, surface that as a blocker — do NOT finish with red or un-run tests.

##### Version control is the runner's job (do NOT push or open a PR)

> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **Observable outcome:** After this PR merges, an operator can open an `irb -r ./app/store` session (with `DATABASE_URL` set), call `Store.new.create(url: 'https://example.com', title: 'Ex', tags: ['x'])`, and get back `{id: <int>, url: 'https://example.com', title: 'Ex', tags: ['x']}`, with the row visible in Postgres.
- **Shippability claim:** this PR is independently mergeable to main even if no other session in the same wave has merged. (S1-A is the sole Phase 1 session; depends only on the merged S0-A.)

##### Output and handoff

Exports consumed by Phases 2 and 3:

- `app/store.rb` → `Store` class [LOAD-BEARING] — public interface (`create`, `all`, `find`, `delete`, `add_tag`, `all_tags`) and bookmark hash shape `{id:, url:, title:, tags: []}` (symbol keys).
- Consumers: S2-A (`app/routes/bookmarks.rb`), S2-B (`app/routes/tags.rb`), S3-A (`app/routes/health.rb` — may instantiate to verify DB), S3-B (`app/routes/status.rb`).

---

```json
{
  "test": { "cmd": "bundle exec rspec tests/integration/store_spec.rb", "file": "tests/integration/store_spec.rb" },
  "checkpoint": "Calling Store.new.create(url:, title:, tags:) returns a {id:, url:, title:, tags:} hash and the row is persisted in Postgres.",
  "manualAcs": [],
  "exports": [
    { "kind": "module", "name": "app/store", "shape": "app/store.rb" },
    { "kind": "function", "name": "Store#create", "shape": "(url:, title:, tags: []) => {id:Integer, url:String, title:String, tags:Array<String>}" },
    { "kind": "function", "name": "Store#all", "shape": "() => Array<{id:Integer, url:String, title:String, tags:Array<String>}>" },
    { "kind": "function", "name": "Store#find", "shape": "(id) => {id:Integer, url:String, title:String, tags:Array<String>} | nil" },
    { "kind": "function", "name": "Store#delete", "shape": "(id) => void" },
    { "kind": "function", "name": "Store#add_tag", "shape": "(id, tag:String) => {id:Integer, url:String, title:String, tags:Array<String>} | nil" },
    { "kind": "function", "name": "Store#all_tags", "shape": "() => Array<String>" }
  ],
  "imports": [
    { "from": "S0-A", "file": "spec/spec_helper.rb", "names": ["spec_helper"] }
  ],
  "sharedFiles": [
    { "path": "spec/spec_helper.rb", "strategy": "single-owner-glob", "note": "Owned by S0-A; this session only `require 'spec_helper'`, never edits it." },
    { "path": "Gemfile", "strategy": "single-owner-glob", "note": "Owned by S0-A; all required gems already declared. This session does not modify it." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Schema created run-once by Phase 0 spec_helper.rb via CREATE TABLE IF NOT EXISTS; per-spec isolation via TRUNCATE in before(:each)." }
  ]
}
```