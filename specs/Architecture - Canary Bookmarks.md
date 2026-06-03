# Architecture — Canary Bookmarks API

Ruby 3.3 · Bundler + RSpec · Sinatra · Postgres. A build-plan **fixture** and the
foreign-ecosystem proof cell for #144. Shaped to decompose into a Phase 0
integration harness + 3 feature phases with disjoint file ownership. See
`../EXPECTED.md` for the session/wave contract.

## Stack

- **Runtime:** Ruby 3.3, dependencies via Bundler (`Gemfile`).
- **HTTP:** Sinatra (`Sinatra::Base`) with JSON responses.
- **Datastore:** Postgres (`pg` gem), connected via `DATABASE_URL`.
- **Tests:** RSpec. Integration specs live under `tests/integration/` and run
  against a fixture Postgres provisioned by the harness/CI.

## Module layout (file ownership — one owner each)

| Area | Files | Phase |
|---|---|---|
| Integration harness | `tests/integration/harness_spec.rb`, `Gemfile`, `spec/spec_helper.rb` | 0 |
| Store | `app/store.rb` | 1 |
| App | `app/app.rb` | 1 |
| Bookmark routes | `app/routes/bookmarks.rb` | 2 |
| Tag routes | `app/routes/tags.rb` | 2 |
| Health route | `app/routes/health.rb` | 3 |
| Status route | `app/routes/status.rb` | 3 |

## Shared resources

- **Fixture Postgres** — a single database shared by all integration specs.
  Provisioned **run-once** by the Phase 0 harness before any parallel worker
  runs; feature sessions read/write isolated rows.
- **`spec/spec_helper.rb`** — Ruby's shared test registry (the analog of node's
  `vitest.workspace.ts`); single-owner, never edited by feature sessions. The
  #144 ecosystem-adapter's `impliedSharedFiles` must learn this mapping.

## Toolchain

- `Gemfile` (Bundler) owns deps: `sinatra`, `pg` (runtime); `rspec`, `rack-test`
  (dev). Workspace install: `bundle install`.
- Integration command: `bundle exec rspec tests/integration`.
- CI provisions Postgres as a native service and exports `DATABASE_URL`.

## Known generation gap (the #144 target this fixture proves)

Today the generation pipeline hardcodes `package.json` in `validatePhaseZeroHarness`
and the `buildRunManifest` harness precondition, so a Ruby Phase-0 session owning
`Gemfile` is flagged NOT-READY and the manifest build throws. The ecosystem
adapter must make Phase-0 detection + manifest reconcile ecosystem-aware; this
fixture is the regression target that flips Ruby NOT-READY → READY.

## Cross-session contracts

- `app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3
  dependency; producer phase precedes consumer phase).
- Ruby is dynamically typed, so the plan-time contract proof degrades to ADVISORY
  "unverified"; the CI RSpec gate proves cross-file compatibility at build time
  (#144 Decision B).
