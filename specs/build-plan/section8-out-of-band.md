# Out-of-Band Validation Tasks — Canary Bookmarks API

---

## Task 1: Postgres Fixture Instance Provisioned and Reachable

**Name:** Live Postgres server available at a valid `DATABASE_URL`

**Gates:** Phase 0 session (harness), and transitively every Phase 1/2/3 session

**Pass condition:**
- A Postgres instance (≥ 12 acceptable; must support `SERIAL`, `ON DELETE CASCADE`, partial indexes) is running and network-reachable from the build worker
- `DATABASE_URL` is set in the CI/build environment to a valid connection URI
- `psql $DATABASE_URL -c "SELECT 1;"` returns `1` with exit code `0`
- The connecting role has `CREATE TABLE`, `INSERT`, `SELECT`, `DELETE`, `DROP TABLE` privileges on at least one writable schema

**Fail condition:**
- `psql` connection refused, authentication error, or role lacks DDL privileges
- `DATABASE_URL` is absent or malformed (pg gem raises `PG::ConnectionBad` on first connect attempt)
- Postgres version < 10 (risks `ON DELETE CASCADE` or index syntax edge cases)

**Fallback architecture:**
- Replace Postgres with SQLite via the `sequel` gem + `sqlite3` gem; rewrite `app/store.rb` to use Sequel DSL instead of raw `pg` calls
- Schema changes: drop `SERIAL` → use `INTEGER PRIMARY KEY AUTOINCREMENT`; cascade deletes expressed via Sequel migrations
- **Session briefs that must change:** Phase 0 (`Gemfile` adds `sequel`, `sqlite3`, removes `pg`), Phase 1 (`app/store.rb` rewrites connection and query layer), all Phase 2/3 sessions if connection bootstrapping moves

---

## Task 2: Ruby 3.3 Runtime Available on Build Worker

**Name:** Ruby 3.3.x interpreter installed and default on the build worker PATH

**Gates:** Phase 0 session (owns `Gemfile`; `bundle install` must resolve against the declared platform)

**Pass condition:**
- `ruby --version` returns `ruby 3.3.x` (any patch level)
- `gem --version` returns a Bundler-compatible RubyGems version
- `bundle --version` returns Bundler ≥ 2.4

**Fail condition:**
- `ruby --version` returns 3.1, 3.2, or any version < 3.3
- `ruby` not on PATH at all
- Bundler not installed or version < 2.0

**Fallback architecture:**
- If only Ruby 3.2 is available: audit gem lockfile for any 3.3-only syntax (pattern-matching refinements, etc.); if none used, lower the `.ruby-version` pin to `3.2` and update `Gemfile` `ruby` directive — no session logic changes required
- If Ruby < 3.2 only: full re-evaluation of gem compatibility required; this is a project-blocking escalation, not a self-contained fallback

---

## Task 3: RubyGems Network Access Confirmed (Gem Installability)

**Name:** `sinatra`, `pg`, `rspec`, `rack-test` resolvable and installable from the build environment

**Gates:** Phase 0 session (`bundle install` must succeed before any subsequent session can load the app)

**Pass condition:**
- A scratch `Gemfile` containing exactly `gem "sinatra"`, `gem "pg"`, `gem "rspec"`, `gem "rack-test"` resolves and installs cleanly via `bundle install` on the build worker
- No native extension build failures (notably `pg` requires `libpq-dev` / `postgresql-client` headers)

**Fail condition:**
- `bundle install` exits non-zero for any of the four gems
- `pg` native extension fails to compile (missing `libpq-dev` or `pg_config` not on PATH)
- Air-gapped environment with no gem mirror configured

**Fallback architecture:**
- If `pg` native extension is unbuildable: same SQLite fallback as Task 1 (they are coupled — both tasks failing triggers the same fallback path)
- If only a private gem mirror is available: add `source "https://internal-mirror"` to `Gemfile` in Phase 0 brief; no logic changes required
- **Session briefs that must change:** Phase 0 `Gemfile` source directive if mirror substitution is needed

---

## Task 4: `DATABASE_URL` Environment Variable Injected into CI Secrets Store

**Name:** `DATABASE_URL` secret configured in CI pipeline before any job runs

**Gates:** Phase 0 session (spec_helper connects on load; harness_spec.rb will fail if absent)

**Pass condition:**
- `DATABASE_URL` is present as a CI secret/environment variable visible to all build job steps
- Value is a syntactically valid PostgreSQL URI: `postgres://user:password@host:port/dbname`
- The variable is injected before the first `bundle exec rspec` invocation

**Fail condition:**
- Variable absent: app boots but all DB calls raise `PG::ConnectionBad`; every integration spec fails
- Variable present but URI malformed: same failure mode
- Variable scoped only to some pipeline stages and not the rspec job

**Fallback architecture:**
- If secrets management is unavailable: use a `.env` file loaded by a `dotenv` gem added to dev dependencies; add `require 'dotenv/load'` at top of `spec/spec_helper.rb`
- **Session briefs that must change:** Phase 0 (`Gemfile` adds `gem "dotenv", group: :development`; `spec/spec_helper.rb` adds dotenv require)

---

## Task 5: Manual Brand Color Sign-Off (AC-2 of US-006)

**Name:** Human verification that `GET /status` response contains `brand_color: "#ff5d8f"` and matches brand guidelines

**Gates:** Final delivery / project sign-off (not a session gate — all build sessions can complete without this; this blocks acceptance)

**Pass condition:**
- A human reviewer issues `curl` or equivalent against the running service and confirms the JSON response contains exactly `"brand_color":"#ff5d8f"` (case-sensitive hex, lowercase)
- Reviewer visually confirms the hex `#ff5d8f` renders as canary pink (not a near-miss like `#ff5d8e`)
- WCAG AA pairing documented: `#ff5d8f` background / `#3a0a1c` text passes contrast check (reviewer confirms via a contrast tool, e.g., WebAIM)

**Fail condition:**
- Response contains a different hex value (wrong digit, uppercase, shorthand `#f58`)
- `brand_color` key absent or misspelled
- WCAG AA contrast ratio < 4.5:1 for the declared pairing

**Fallback architecture:**
- If `#ff5d8f` fails WCAG AA with `#3a0a1c`: substitute text color (not the brand color, which is spec-locked) — propose `#1a0008` or darker; re-run contrast check; update brand guidelines doc only, no code change required (the API field value is fixed by spec)
- **Session briefs that must change:** Phase 3 (`app/routes/status.rb`) only if the hex value itself is determined to be a typo in the spec — requires explicit spec amendment before any code change

---

## Summary Table

| # | Task | Gates | Blocking risk |
|---|---|---|---|
| 1 | Postgres instance live + reachable | Phase 0 → all phases | High — no DB, no integration tests pass |
| 2 | Ruby 3.3 on build worker | Phase 0 → all phases | High — wrong runtime breaks gem resolution |
| 3 | Gem installability (`pg` native ext) | Phase 0 → all phases | High — coupled to Task 1 via `pg` gem |
| 4 | `DATABASE_URL` in CI secrets | Phase 0 → all phases | High — silent boot success, total test failure |
| 5 | Manual brand color sign-off | Acceptance/delivery only | Low-risk to build; blocks final sign-off |