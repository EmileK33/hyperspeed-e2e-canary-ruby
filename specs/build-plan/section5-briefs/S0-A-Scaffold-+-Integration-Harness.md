---

#### S0-A — Scaffold + Integration Harness

**Phase 0 | Infrastructure | Needs: none**

##### Objective

Stand up the Ruby/Sinatra project scaffold and the shared RSpec integration harness so every downstream session can implement its feature against a working app and a single, frozen test registry.

##### Scope

P0 MVP — this entire session is P0. No P1 work.

##### Technology constraints

- **Runtime floor — non-negotiable: Ruby 3.3.** All code (implementation AND specs) must run on Ruby 3.3. Do NOT use Ruby syntax or stdlib APIs introduced after 3.3 (e.g. nothing from 3.4+ such as `it`-block parameters, `Set` being autoloaded as core in 3.4, `Hash#dup` changes, etc.). Stick to Ruby 3.3 stdlib only. CI runs on the 3.3 floor; the build host may be newer.
- **HTTP framework**: `sinatra` — `Bookmarks::App` subclasses `Sinatra::Base` (modular style, not classic top-level DSL).
- **Datastore client**: `pg` gem (no ActiveRecord, no Sequel — not in declared deps).
- **Test framework**: `rspec` with `rack-test` for HTTP simulation. No Minitest, no other runners.
- **Dependency manager**: Bundler with `Gemfile`. No `gemspec`, no monorepo tooling.
- **Forbidden**: ActiveRecord, Sequel, Rails, Rack::Test (capital R/T mismatch — must be `rack-test`), any gem not listed in the Project Requirements `projectManifest`.

##### Performance targets

None — see downstream sessions. Phase 0 owns no SLA.

##### Pre-installed environment

> Before this session's `claude` child is spawned, the runner has executed the project's workspaceInstall commands inside the fresh worktree. The following are available to your session:
> - **Host binaries on PATH:** `git`, `gh`, `claude`, `bundle`
> - **Runtimes:** `ruby 3.3`. **This version is the FLOOR, not just what is installed — CI runs on the floor major. Do not use APIs newer than Ruby 3.3 in implementation OR spec code (see Technology constraints).**
> - **Workspace installs run:** `bundle install --path vendor/bundle` (marker: `vendor/bundle`)
> - **Session-specific installs run for this session:** none
>
> Do NOT include `bundle install` in your implementation — it has already run. Do NOT re-declare these dependencies anywhere outside `Gemfile`.

**This session owns `Gemfile` (the project manifest).** The runner has already seeded a complete `Gemfile` onto the base branch from the requirements block's `projectManifest`. Your worktree therefore already contains a `Gemfile` enumerating the project's dependencies. Your job is to RECONCILE and complete it — verify every gem the project needs is present and commit. Do NOT delete dependencies you do not personally use — sibling sessions depend on them.

Full intended dependency set (must all be present in `Gemfile`):
- Runtime: `sinatra`, `pg`
- Dev/test group: `rspec`, `rack-test`

Ruby version line: `ruby '3.3'`.

##### Owned files

- `Gemfile` — reconcile seeded manifest; confirm all four gems present with the group structure above.
- `.rspec` — minimal config (`--require spec_helper`, `--format documentation`).
- `spec/spec_helper.rb` — shared test registry: load `app/app.rb`, configure `Rack::Test::Methods`, expose an `app` helper returning `Bookmarks::App`, set `ENV['RACK_ENV'] = 'test'`. **Frozen after this session — no other session may edit.**
- `app/app.rb` — defines `module Bookmarks; class App < Sinatra::Base; end; end`. Adds a 404 JSON error handler (`not_found`) returning `{ "error": "not found" }` with content-type `application/json`. Lazy-loads any route files present via `Dir[File.expand_path('routes/*.rb', __dir__)].sort.each { |f| require f }` so downstream sessions can drop in route files without editing this file.
- `tests/integration/harness_spec.rb` — smoke spec that boots `Bookmarks::App`, hits an unknown route, and asserts `404` + JSON error body. Proves the harness, the app, and the `rack-test` wiring all work end-to-end.

##### Read-only imports

None. This session is the root of the dependency graph.

##### Do not touch

- Any file not in the Owned files list above.
- All files owned by future sessions: `app/store.rb` (S1-A), `app/routes/bookmarks.rb` (S2-A), `app/routes/tags.rb` (S2-B), `app/routes/health.rb` (S2-C), `app/routes/status.rb` (S2-D), and all sibling spec files under `tests/integration/` other than `harness_spec.rb`.
- **Shared test-registry note (#136 defect 8)**: `spec/spec_helper.rb` is a single-owner shared registry. You own it now; no future session edits it. Sibling specs simply `require 'spec_helper'` (which `.rspec` does automatically). Do NOT introduce per-session helper files that mutate global RSpec config.

##### Architecture context

From the distilled spec verbatim:

> **1.1 Shared contracts**
> No TypeScript interfaces (Ruby project, dynamically typed). Cross-session contracts are advisory only; CI RSpec gate proves compatibility at build time.
>
> **Error response shape** (all routes):
> ```ruby
> { "error" => String }
> ```

> **1.5 HTTP status code contracts**
> | Unknown route | `404` with `{ "error": string }` body | `200` |

> **1.8 Technology stack**
> Runtime: Ruby 3.3. Dependency manager: Bundler (`Gemfile`). HTTP framework: Sinatra (`Sinatra::Base`). Datastore: Postgres (`pg`, via `DATABASE_URL`). Test framework: RSpec; integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration`. HTTP test adapter: rack-test.

> **1.11 Cross-session runtime patterns**
> `spec/spec_helper.rb` — Written by Phase 0 (single owner, never edited after); Read by all RSpec sessions. Shared test registry; frozen after Phase 0.

> **1.12 Environment variable schema**
> `DATABASE_URL` — Valid PostgreSQL connection URI. App boots but all DB calls raise connection error if absent.

##### User stories and acceptance criteria

This session has no end-user story; it is infrastructure that enables every downstream user story. Its acceptance is structural: the harness runs, the app boots, and unknown routes 404 with the canonical JSON error envelope (a contract every feature session inherits from `1.5 HTTP status code contracts`).

##### UX and design specification

N/A — infrastructure session, no frontend component.

##### Critical implementation notes

- **`spec_helper.rb` is single-owner and frozen.** Future sessions must not edit it. Make it complete now: `ENV['RACK_ENV'] = 'test'`, require `app/app.rb`, `require 'rack/test'`, configure `RSpec.configure { |c| c.include Rack::Test::Methods }`, define a top-level `def app; Bookmarks::App; end` (or include it in config).
- **`app/app.rb` must lazy-glob-require its route files** (`Dir[File.expand_path('routes/*.rb', __dir__)].sort.each { |f| require f }`). This is the contract that lets Phase 2 sessions add route files without editing `app/app.rb`. The glob runs at load time, so the `app/routes/` directory must exist; create it (with a `.keep` file is fine, or simply ensure the glob safely returns `[]` when empty — `Dir[...]` returns `[]` for a missing dir, so no `.keep` is strictly required).
- **404 handler must return JSON, not HTML.** `content_type :json` then `{ error: 'not found' }.to_json`. Sinatra's default 404 is HTML — overriding is mandatory because the spec's `1.5` table mandates `{ "error": string }`.
- **Modular Sinatra, not classic.** `class App < Sinatra::Base` inside `module Bookmarks`. Never `require 'sinatra'` at top-level (that pulls the classic DSL which auto-starts a server).
- **Do not connect to Postgres in this session.** `DATABASE_URL` may be absent; the harness spec must not require a DB to pass. Connection wiring lives in S1-A (`app/store.rb`).
- **`.rspec` must include `--require spec_helper`** so sibling spec files do not need to `require 'spec_helper'` explicitly (but they may). This is the mechanism by which `spec_helper` is the universal registry.
- **Silent failure mode**: if `app/app.rb` eagerly requires specific route files by name (e.g. `require_relative 'routes/bookmarks'`), Phase 0 will fail to boot because those files don't exist yet. The glob-require pattern is mandatory.
- **Gemfile reconcile**: do NOT remove gems you don't personally use. `pg` is needed by S1-A; `rack-test` by every spec; keep them all.

##### Mocking contract

N/A — this session defines the contract surface (the `app/app.rb` module and the spec_helper); it consumes nothing from other sessions. External service contract: Postgres via `DATABASE_URL` (deferred to S1-A).

##### Acceptance criteria checklist

- [ ] `Gemfile` declares `ruby '3.3'` and gems `sinatra`, `pg`, `rspec` (in dev/test group), `rack-test` (in dev/test group) [INFRA]
- [ ] `bundle exec rspec tests/integration` exits 0 on a fresh clone after `bundle install` [INFRA]
- [ ] `app/app.rb` defines `Bookmarks::App < Sinatra::Base` [INFRA]
- [ ] `app/app.rb` glob-requires `app/routes/*.rb` so dropping route files in does not require editing `app/app.rb` [INFRA]
- [ ] Unknown route returns HTTP 404 with body `{"error":"not found"}` and `Content-Type: application/json` [1.5 contract]
- [ ] `spec/spec_helper.rb` exposes `Bookmarks::App` as the rack-test `app` and sets `RACK_ENV=test` [INFRA]
- [ ] `.rspec` auto-requires `spec_helper` [INFRA]
- [ ] Harness spec passes without any `DATABASE_URL` set [INFRA — DB-free boot]

##### Independent Test

- **Test file path** (TDD — written first, must fail before implementation): `tests/integration/harness_spec.rb`
- **Exact CI command**: `bundle exec rspec tests/integration/harness_spec.rb`
- **Working directory**: repo root (omit `cwd`).
- **AC → assertion mapping**:
  - `Gemfile` declares correct gems → `it "Gemfile declares ruby 3.3 and all required gems"`
  - `bundle exec rspec` exits 0 → implicitly proven by the suite running green
  - `Bookmarks::App < Sinatra::Base` → `it "defines Bookmarks::App as a Sinatra::Base subclass"`
  - Glob-require contract → `it "lazy-loads route files from app/routes via glob require"`
  - 404 JSON contract → `it "returns 404 with {error: 'not found'} JSON for unknown routes"`
  - `spec_helper` exposes app + RACK_ENV → `it "configures Rack::Test with Bookmarks::App and RACK_ENV=test"`
  - `.rspec` auto-requires `spec_helper` → `it "auto-requires spec_helper via .rspec"`
  - DB-free boot → `it "boots without DATABASE_URL set"`
- **Fixtures / test doubles**: none. Uses `Rack::Test` against the real `Bookmarks::App`.
- **Pre-conditions**: `bundle install` already run by the workspace install. No DB, no env vars required.
- **Isolation rule**: passes when S0-A is the only session merged; depends on nothing.
- **No project-wide gate inside the spec**: do NOT shell out to `rubocop`, full repo lint, or anything that scans sibling sessions' files. The spec exercises only S0-A's own surface.
- **Self-verify before finishing (REQUIRED)**: run `bundle exec rspec tests/integration/harness_spec.rb` and see it green before ending the session.

##### Version control is the runner's job (do NOT push or open a PR)

> **The build runner owns all version control for this session.** Implement the code and iterate the Independent Test to green, then STOP. Do **NOT** run `git push`, `git commit` to a remote, `gh pr create`, `gh pr edit`, or `gh pr merge`. The runner stages your committed work, reconciles it with the latest base, pushes the branch, and opens the single canonical PR (with the Checkpoint and any manual sign-off checklist) itself. If you open your own PR you create a duplicate the runner must reconcile around, and your self-authored body drops the manual-AC checklist a reviewer needs. Local `git commit`s inside the worktree are fine; anything that talks to the remote or GitHub is not.

##### Checkpoint

- **Observable outcome**: After merge, running `bundle exec rspec tests/integration` on a fresh clone exits 0, and `curl -s -o /dev/null -w "%{http_code}" $(rackup-served-app)/nope` returns `404` with a JSON error body.
- **Shippability claim**: this PR is independently mergeable to main even if no other session in the same wave has merged. (It is the root of the graph and has no siblings in Phase 0.)

##### Output and handoff

- `app/app.rb` exporting `Bookmarks::App` (Sinatra::Base subclass) — consumed by S1-A, S2-A, S2-B, S2-C, S2-D. [LOAD-BEARING]
- `spec/spec_helper.rb` — required by every downstream integration spec. [LOAD-BEARING]
- `.rspec` auto-require behavior — relied upon by every downstream spec. [LOAD-BEARING]
- `app/routes/` glob-require contract — every Phase 2 route file is auto-loaded by being placed in this directory. [LOAD-BEARING]
- `Gemfile` — base manifest siblings inherit; do not be deleted from.

---

```json
{
  "test": { "cmd": "bundle exec rspec tests/integration/harness_spec.rb", "file": "tests/integration/harness_spec.rb" },
  "checkpoint": "On a fresh clone, `bundle exec rspec tests/integration` exits 0 and an unknown route on Bookmarks::App returns HTTP 404 with a JSON `{\"error\":\"not found\"}` body.",
  "manualAcs": [],
  "exports": [
    { "kind": "module", "name": "Bookmarks::App", "shape": "app/app.rb" },
    { "kind": "module", "name": "spec_helper", "shape": "spec/spec_helper.rb" }
  ],
  "imports": [],
  "sharedFiles": [
    { "path": "spec/spec_helper.rb", "strategy": "single-owner-glob", "note": "Phase 0 owns it; .rspec auto-requires it; no sibling session edits it." },
    { "path": "Gemfile", "strategy": "union-merge", "note": "Seeded by runner from projectManifest; this session reconciles. Runner union-merges if siblings add gems." },
    { "path": "app/app.rb", "strategy": "single-owner-glob", "note": "Owned by S0-A; uses Dir[...]/require glob so Phase 2 route files auto-load without editing this file." },
    { "path": ".rspec", "strategy": "single-owner-glob", "note": "Phase 0 owns; configures auto-require of spec_helper." }
  ],
  "sharedResources": [
    { "name": "fixture-postgres", "kind": "database", "coordination": "run-once", "note": "Phase 0 declares it but does not connect; provisioned once by harness; S1-A is first consumer." }
  ]
}
```