---

#### S0-A — Phase 0 harness + Sinatra scaffold

**Phase 0 | Infrastructure | Needs: none**

##### Objective

Establish the Ruby/Sinatra project skeleton, the RSpec integration-test harness, and a run-once Postgres fixture schema so every downstream feature session can mount routes on `Bookmarks::App` and run isolated integration specs against a shared fixture database.

##### Scope

P0 MVP. All work in this session is P0 — there is no P1 work to stub. This session is the **mandatory Phase 0 integration-harness session** for the build: it owns the project manifest (`Gemfile`), the shared RSpec helper, the Sinatra base app, and the project-level integration test command.

##### Technology constraints

**Declared runtime floor — non-negotiable:** Ruby **3.3**. All code in this session — implementation and specs — MUST run on Ruby 3.3. Do NOT use syntax or stdlib APIs introduced in a LATER Ruby version than 3.3 (e.g. do not assume features from a hypothetical 3.4+). Stick to the Ruby 3.3 stdlib. CI is pinned to Ruby 3.3; the build host may run newer but that does not change the floor.

Required libraries (from distilled spec §1.8):
- **Sinatra** (`Sinatra::Base` subclass pattern — `Bookmarks::App < Sinatra::Base`)
- **`pg`** gem for Postgres
- **RSpec** as the test framework
- **`rack-test`** as the HTTP test adapter
- **`puma`** as the Rack server; **`rackup`** for `config.ru` boot
- **`json`** (stdlib wrapper gem already in the manifest)

MUST NOT use:
- Rails or Rails-ergonomics gems (ActiveRecord, ActiveSupport) — the spec mandates Sinatra + raw `pg`.
- Any test framework other than RSpec (no Minitest, no `test/unit`).
- Any ORM — the `Store` (S1-A) talks to `pg` directly.

##### Performance targets

None — see downstream sessions. The spec declares no SLAs.

##### Pre-installed environment

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
> - **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than the floor in implementation OR test code (see Technology constraints).**
> - **Workspace installs run:** `bundle install --path vendor/bundle` (marker: `vendor/bundle`)
> - **Session-specific installs run for this session:** none
>
> Do NOT include `bundle install` or any gem-install equivalent in your implementation — it has already run. Do NOT re-declare these dependencies in any setup or readme.

**This session is the Phase 0 integration-harness session that owns the project manifest (`Gemfile`).** The runner has already seeded a complete `Gemfile` onto the base branch from the requirements block's `projectManifest`. Your worktree therefore already contains a `Gemfile` enumerating the project's dependencies. Your job is to RECONCILE and complete it — verify every dependency the project needs is present and wire up the project-level integration command (the `Rakefile` `default` task and your `test.cmd` `bundle exec rspec tests/integration`). Do NOT delete dependencies you do not personally use — sibling sessions in your wave depend on them.

**Full intended dependency set** (must all be present in the final `Gemfile`):
- Runtime: `sinatra`, `puma`, `pg`, `json`, `rackup`
- Dev/test group (`group :development, :test`): `rspec`, `rack-test`

##### Owned files

- `Gemfile` — reconcile from the seeded manifest; final state must list all dependencies above.
- `spec/spec_helper.rb` — RSpec config, `DATABASE_URL` default, schema provision (run-once), per-spec `TRUNCATE`, `Rack::Test` mixin.
- `tests/integration/harness_spec.rb` — trivial passing spec that proves the harness boots.
- `tests/integration/.keep` — empty file so the directory exists pre-feature-sessions.
- `app/app.rb` — defines `module Bookmarks; class App < Sinatra::Base; end; end`, sets JSON content-type for all responses, configures JSON 404 handler, and `require_relative`s `app/store`, `app/routes/bookmarks`, `app/routes/tags`, `app/routes/health`, `app/routes/status`.
- `config.ru` — Rack rackup file: `require_relative 'app/app'; run Bookmarks::App`.
- `.rspec` — RSpec config (e.g. `--require spec_helper --format documentation`).
- `Rakefile` — defines a `default` task that runs `bundle exec rspec tests/integration` (optional convenience; the canonical CI command is the rspec invocation itself).

##### Read-only imports

None. This is the root Phase 0 session.

##### Do not touch

- All files owned by other sessions:
  - `app/store.rb` (S1-A)
  - `app/routes/bookmarks.rb` (S2-A)
  - `app/routes/tags.rb` (S2-B)
  - `app/routes/health.rb` (S3-A)
  - `app/routes/status.rb` (S3-B)
  - Any `tests/integration/*_spec.rb` other than `harness_spec.rb`
- **Important Ruby caveat about `require_relative` in `app/app.rb`:** you MUST `require_relative` the route files even though they do not exist yet in this session's worktree. The runner merges feature sessions on top of yours; at runtime (after merges) those files exist. To prevent your own Independent Test from blowing up on `LoadError`, see the Critical implementation notes for the safe pattern.

##### Architecture context

Verbatim from distilled spec:

**§1.1 Shared contracts** — `app/store.rb` → `app/routes/*` (Phase 1 producer → Phase 2/3 consumer). `Store` public interface:
```ruby
Store#create(url:, title:, tags: [])  # → bookmark hash
Store#all                              # → Array of bookmark hashes
Store#find(id)                         # → bookmark hash | nil
Store#delete(id)                       # → void
```
Bookmark hash shape: `{ id, url, title, tags: [] }`. Error response shape: `{ "error": String }`.

**§1.2 Database schema** — managed by the store layer. Implied tables:
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
No RLS, partitioning, or CHECK constraints specified.

**§1.5 HTTP status code contracts** — Unknown route → `404` with `{ "error": String }` JSON body. (This 404 contract is owned BY THIS SESSION via the Sinatra `not_found` block in `app/app.rb`.)

**§1.11 Cross-session runtime patterns** — `spec/spec_helper.rb` is written by Phase 0 (single owner, never edited by feature sessions); read by all RSpec specs across all phases. Analog of `vitest.workspace.ts`. Fixture Postgres schema is provisioned **run-once** by the Phase 0 harness before any parallel worker; feature sessions read/write isolated rows.

**§1.12 Environment variable schema** — `DATABASE_URL` (String, valid Postgres URI, no default). If absent, store cannot connect.

**§1.7 Third-party dependencies** — Fixture Postgres connected via `DATABASE_URL`; single shared fixture DB; isolation is row-level only.

**§1.4 Critical ordering rules** — "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."

##### User stories and acceptance criteria

This session does not directly implement a numbered user story. It establishes the foundation that US-001 through US-006 depend on. The closest behavioral contract it owns directly is the **US-002 JSON 404 handler** (the rest of US-002 — request body JSON parsing — is realized by feature sessions reopening `Bookmarks::App`):

> **US-002 (excerpt) — 404 JSON error body.** Any request to an unknown route must return HTTP 404 with a JSON body of shape `{ "error": String }`. The `Content-Type` must be `application/json`.

##### UX and design specification

N/A — backend-only infrastructure session, no frontend component.

##### Critical implementation notes

- **Run-once schema provision.** `spec/spec_helper.rb` must create the `bookmarks` and `bookmark_tags` tables using `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, wrapped in an `RSpec.configure { |c| c.before(:suite) { ... } }` block. Idempotent provisioning is required — multiple specs and reruns must not raise `relation "bookmarks" already exists`. This is the §1.4 ordering rule made concrete.
- **Per-spec isolation.** Use `c.before(:each) { conn.exec('TRUNCATE bookmarks, bookmark_tags RESTART IDENTITY CASCADE') }` so sibling specs in parallel waves do not leak rows. Row-level isolation only — no per-worker schema split.
- **`DATABASE_URL` default for spec_helper.** Set `ENV['DATABASE_URL'] ||= 'postgres://postgres:postgres@localhost:5432/canary_test'` BEFORE any `require_relative 'app/app'` so the store (when loaded in later phases) sees a value.
- **JSON 404 handler is yours.** In `app/app.rb`:
  ```ruby
  not_found do
    content_type :json
    { error: "not found" }.to_json
  end
  ```
  This satisfies the §1.5 contract: unknown route → `404` with `{ "error": String }`. Any feature session that defines its own `not_found` would be overstepping.
- **JSON content-type for all responses.** `before { content_type :json }` in `app/app.rb` so route files (which only register `get`/`post`/`delete` blocks) do not each have to set it.
- **Safe `require_relative` for sibling route files that do not yet exist in your isolated worktree.** Your Independent Test boots `app/app.rb`; the route files for S2-A/S2-B/S3-A/S3-B are not present in your branch. Use:
  ```ruby
  %w[store routes/bookmarks routes/tags routes/health routes/status].each do |rel|
    path = File.expand_path(rel, __dir__)
    require path if File.exist?("#{path}.rb")
  end
  ```
  This way the harness spec passes in isolation, AND once the runner merges all sessions onto main, every route file is found and loaded. This is the only ordering-safe pattern; a bare `require_relative 'routes/bookmarks'` would fail your own Independent Test (isolation rule violation).
- **Project-level integration test command.** Your `test.cmd` is `bundle exec rspec tests/integration` — that is the project-wide integration command every downstream session also runs (with their own `--example` filter or full directory). The Rakefile `default` task should invoke the same.
- **Do not pre-stub feature endpoints.** Don't add a `get '/health'` or any other route in `app/app.rb`; that belongs to S3-A/S3-B/S2-A/S2-B. Your scaffold is content-type + 404 + requires, nothing more.
- **Bundler `--path vendor/bundle` already configured.** Do not re-run `bundle install` or `bundle config`. Just use `bundle exec` to invoke specs.
- **Ruby 3.3 only.** No `it`-as-anonymous-block-param, no `Data.define`-introduced-after-3.3 features. Stick to Ruby 3.3 stdlib.

##### Mocking contract

N/A — this session defines contracts (the `Bookmarks::App` Sinatra base, the spec helper, the schema), does not consume any. External service contracts:

- **Postgres fixture** — connection string from `ENV['DATABASE_URL']`, default `postgres://postgres:postgres@localhost:5432/canary_test`. The CI runner provisions a native Postgres 16 service with user/password `postgres`/`postgres` and database `canary_test` on port 5432.

##### Acceptance criteria checklist

- [ ] `Gemfile` lists runtime gems: `sinatra`, `puma`, `pg`, `json`, `rackup` [tech]
- [ ] `Gemfile` lists dev/test gems in `group :development, :test`: `rspec`, `rack-test` [tech]
- [ ] `Gemfile` declares `ruby "3.3"` [tech]
- [ ] `bundle exec rspec tests/integration` exits 0 in a fresh worktree with Postgres available [tech]
- [ ] `Bookmarks::App` is defined under module `Bookmarks` and inherits from `Sinatra::Base` [tech]
- [ ] `app/app.rb` sets `application/json` content-type for every response [tech]
- [ ] Any request to an unknown route returns HTTP 404 with JSON body matching `{ "error": String }` and `Content-Type: application/json` [US-002 404-JSON]
- [ ] `spec/spec_helper.rb` provisions `bookmarks` and `bookmark_tags` tables idempotently in a `before(:suite)` block [tech, §1.4]
- [ ] `spec/spec_helper.rb` truncates both tables in `before(:each)` so specs are row-isolated [tech, §1.11]
- [ ] `spec/spec_helper.rb` defaults `DATABASE_URL` if unset and includes `Rack::Test::Methods` for spec groups that opt in [tech]
- [ ] `config.ru` boots `Bookmarks::App` via `run Bookmarks::App` [tech]
- [ ] `app/app.rb` `require_relative`s the eventual route files in a `File.exist?`-guarded loop so the harness boots in isolation AND on the merged main branch [tech, isolation rule]
- [ ] Harness spec `tests/integration/harness_spec.rb` boots the app and asserts a 404-on-unknown-route returns JSON `{ "error": ... }` [US-002 404-JSON]

No `[MANUAL]` items in this session.

##### Independent Test

This session follows TDD — the Independent Test is written FIRST, observed to fail, then implementation is filled in until it passes.

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/harness_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration`
- **Working directory**: omitted (repo root)
- **AC → assertion mapping**:
  - `Gemfile` lists runtime gems → `it "lists required runtime gems in the Gemfile"`
  - `Gemfile` lists dev/test gems → `it "lists rspec and rack-test in the dev/test group"`
  - `Gemfile` declares ruby 3.3 → `it "pins ruby to 3.3 in the Gemfile"`
  - `Bookmarks::App` defined under `Bookmarks` module, inherits `Sinatra::Base` → `it "defines Bookmarks::App as a Sinatra::Base subclass"`
  - JSON content-type default → `it "responds with application/json content-type"`
  - 404 JSON body on unknown route (US-002 404-JSON) → `it "returns 404 with a JSON error body for unknown routes"`
  - `spec/spec_helper.rb` schema idempotency → `it "provisions bookmarks and bookmark_tags tables idempotently"` (asserts tables exist via `pg_class` query)
  - `spec/spec_helper.rb` TRUNCATE per-spec → `it "truncates tables in before(:each) so rows do not leak between specs"` (inserts a row, ends spec, next spec asserts table empty — implement as two ordered `it` blocks)
  - `config.ru` boots app → `it "boots Bookmarks::App via config.ru"` (loads `config.ru` and asserts `Bookmarks::App` is callable)
  - Safe `require_relative` guard → `it "loads app/app.rb in isolation even when sibling route files are absent"`
- **Fixtures / test doubles**: A bare `Rack::Test`-using describe block targeting `Bookmarks::App`. A direct `PG.connect(ENV['DATABASE_URL'])` connection for the table-existence and TRUNCATE assertions.
- **Pre-conditions**: Postgres reachable at `DATABASE_URL` (CI provides this via the native `postgres:16` service on port 5432 with user/password/db `postgres`/`postgres`/`canary_test`). `bundle install` already run by the workspace install step.
- **Isolation rule**: Test passes with ONLY this session's PR merged. It does not import or reference any route file from S1-A/S2-A/S2-B/S3-A/S3-B.
- **No project-wide gate inside this test**: this spec exercises only Phase 0's own ACs. No tree-wide `ruby -c` or full-repo lint.
- **Self-verify before finishing (REQUIRED)**: run `bundle exec rspec tests/integration` and observe it green before ending the session. If Postgres is not reachable, surface that as a blocker — do NOT finish with a red or un-run test.

##### Version control is the runner's job (do NOT push or open a PR)

> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **One-sentence observable outcome:** Running `bundle exec rspec tests/integration` from a fresh clone (with Postgres reachable) boots `Bookmarks::App`, provisions the `bookmarks` and `bookmark_tags` tables once, and exits 0 with a passing harness spec that confirms unknown routes return `404` with a JSON `{ "error": ... }` body.
- **Shippability claim:** this PR is independently mergeable to main even if no other session in the same wave has merged. (It is the root Phase 0 session; nothing in its wave precedes it.)

##### Output and handoff

Producers exported to downstream sessions:

- `app/app.rb` — module `Bookmarks` with class `App < Sinatra::Base`. **[LOAD-BEARING]** Consumed by S1-A, S2-A, S2-B, S3-A, S3-B (they reopen `Bookmarks::App` to register routes). The module path and class name must not change after merge.
- `spec/spec_helper.rb` — RSpec config, `DATABASE_URL` default, schema provisioning, per-spec TRUNCATE, `Rack::Test::Methods` available. **[LOAD-BEARING]** Required by every downstream `*_spec.rb`.
- `Gemfile` — full dependency set. **[LOAD-BEARING]** Any feature session expecting `pg`, `sinatra`, `rspec`, `rack-test` to be installed depends on this manifest.
- `config.ru` — runtime boot artifact, consumed by deployment / `rackup`.
- `.rspec` — auto-requires `spec_helper`, consumed by every spec.
- `tests/integration/` directory — populated by every feature session with its own `*_spec.rb`.

---

```json
{
  "test": { "cmd": "bundle exec rspec tests/integration", "file": "tests/integration/harness_spec.rb" },
  "checkpoint": "Running `bundle exec rspec tests/integration` from a fresh clone with Postgres reachable boots Bookmarks::App, provisions the bookmarks and bookmark_tags tables once, and exits 0 with a passing harness spec that confirms unknown routes return 404 with a JSON `{ \"error\": ... }` body.",
  "manualAcs": [],
  "exports": [
    { "kind": "module", "name": "Bookmarks::App", "shape": "app/app.rb" },
    { "kind": "module", "name": "spec_helper", "shape": "spec/spec_helper.rb" },
    { "kind": "module", "name": "Gemfile", "shape": "Gemfile" },
    { "kind": "module", "name": "config.ru", "shape": "config.ru" }
  ],
  "imports": [],
  "sharedFiles": [
    { "path": "Gemfile", "strategy": "single-owner-glob", "note": "S0-A is the sole owner; runner-seeded then reconciled here. Feature sessions never edit it." },
    { "path": "spec/spec_helper.rb", "strategy": "single-owner-glob", "note": "Analog of vitest.workspace.ts — S0-A owns; feature sessions only require it." },
    { "path": "app/app.rb", "strategy": "single-owner-glob", "note": "S0-A defines Bookmarks::App; feature sessions reopen the class in their own route files without editing app/app.rb." },
    { "path": "tests/integration/", "strategy": "single-owner-glob", "note": "Directory is a glob target; each session owns its own *_spec.rb file inside it — no shared registry to edit." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Schema (bookmarks, bookmark_tags) provisioned once by spec/spec_helper.rb before(:suite) using CREATE TABLE IF NOT EXISTS. Per-spec isolation via TRUNCATE in before(:each)." }
  ]
}
```