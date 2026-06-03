# Out-of-Band Validation Tasks — Canary Bookmarks API

---

## OOB-1: PostgreSQL CI Service Provisioning

**Name:** PostgreSQL service container available in CI with `DATABASE_URL` injected

**Gates:** Phase 0 (harness session) — and transitively every downstream session, since Phase 0 must flip NOT-READY → READY before the manifest build proceeds

**Pass condition:**
- A Postgres instance (any 14+ version) is reachable inside the CI runner
- `DATABASE_URL` environment variable is set to a valid connection URI pointing at that instance
- A `psql $DATABASE_URL -c '\l'` (or equivalent smoke command) exits 0
- The CI service config (e.g., `services: postgres:` in GitHub Actions YAML, or equivalent) is committed and visible in the repo before Phase 0 session starts

**Fail condition:**
- `psql $DATABASE_URL` returns a connection-refused or authentication error
- `DATABASE_URL` is unset or empty in the CI job environment
- The CI YAML does not declare a Postgres service block

**Fallback architecture:**
- Swap the fixture Postgres for SQLite in-process using the `sequel` + `sqlite3` gems, removing the `pg` gem dependency
- Store layer uses `Sequel.sqlite` with an in-memory or temp-file URI instead of `DATABASE_URL`
- **Sessions that need brief changes:** Phase 0 harness (remove DB service wait step, change `DATABASE_URL` setup), Phase 1 `app/store.rb` (replace `PG::Connection` with `Sequel` DSL), all integration specs (adjust connection setup in `spec/spec_helper.rb`)
- *Note: this is an architecturally significant change — `pg` is listed as irreversible in the stack table; this fallback should only be taken if CI Postgres provisioning is structurally blocked, not merely misconfigured*

---

## OOB-2: Ruby 3.3 Runtime Available on CI Runner

**Name:** CI runner provides Ruby 3.3.x as the active runtime

**Gates:** Phase 0 — if `ruby --version` does not satisfy `~> 3.3`, `bundle install` may silently use a wrong runtime, causing spec failures that are misattributed to application code

**Pass condition:**
- `ruby --version` in the CI job outputs `ruby 3.3.x (...)` (any patch release of 3.3)
- CI YAML explicitly pins the Ruby version (e.g., `ruby-version: '3.3'` in a `setup-ruby` step or `.ruby-version` file present in repo root)

**Fail condition:**
- `ruby --version` returns 3.0, 3.1, 3.2, or any 2.x
- No `.ruby-version` file and no CI pin; runtime is whatever happens to be on the image
- `bundle install` emits a platform mismatch or `required_ruby_version` constraint error

**Fallback architecture:**
- Downgrade declared runtime floor to Ruby 3.1 (the oldest non-EOL minor at time of writing)
- Audit `Gemfile` and `app/` code for any 3.3-only syntax (e.g., it-block numbered parameters used as primary style); replace with compatible equivalents
- **Sessions that need brief changes:** Phase 0 (update `.ruby-version` and `Gemfile` `ruby` directive), no application logic changes anticipated unless 3.3-specific syntax was used

---

## OOB-3: Native Extension Build for `pg` Gem

**Name:** `libpq` client library available on CI runner so `gem install pg` compiles successfully

**Gates:** Phase 0 (`bundle install` must succeed before harness spec can run)

**Pass condition:**
- `bundle install` completes without error in the CI environment
- `bundle exec ruby -e "require 'pg'; puts PG::VERSION"` exits 0 and prints a version string
- CI YAML includes the necessary system dependency step (e.g., `sudo apt-get install -y libpq-dev` on Ubuntu runners, or use of a pre-baked image that includes it)

**Fail condition:**
- `bundle install` fails with `pg` native extension build error: `Can't find the 'libpq-fe.h' header`
- CI log shows `mkmf` or `extconf.rb` error for the `pg` gem

**Fallback architecture:**
- Same as OOB-1 fallback (SQLite + Sequel), since the `pg` build failure and Postgres unavailability have the same root cause and the same remedy
- Alternatively, use `pg` gem pre-compiled binary variants (`gem 'pg', platform: :x86_64-linux`) if the CI runner architecture supports it — add explicit platform lock to `Gemfile.lock`
- **Sessions that need brief changes:** Phase 0 only (Gemfile platform directive); no application logic changes

---

## OOB-4: RubyGems Registry Reachability

**Name:** `rubygems.org` (and any configured mirror) is reachable from the CI runner for `bundle install`

**Gates:** Phase 0

**Pass condition:**
- `bundle install` resolves and downloads all four declared gems (`sinatra`, `pg`, `rspec`, `rack-test`) plus their transitive dependencies without network error
- Optionally: a `Gemfile.lock` is pre-committed to the repo, so CI only needs to verify the lock, not re-resolve — this is the recommended mitigation

**Fail condition:**
- `bundle install` fails with a network timeout or SSL error against `rubygems.org`
- A custom gem source is declared in `Gemfile` but the registry is not accessible from CI

**Fallback architecture:**
- Commit a complete `Gemfile.lock` (pre-generated locally) so CI runs `bundle install --frozen` against cached gems or a vendor bundle
- Or add `bundle cache` / vendored gems (`vendor/bundle`) committed to the repo
- **Sessions that need brief changes:** Phase 0 brief should specify that `Gemfile.lock` must be committed as part of the harness deliverable, not gitignored

---

## OOB-5: [MANUAL] Brand Color Sign-Off for `GET /status`

**Name:** Human reviewer confirms `brand_color: "#ff5d8f"` in `GET /status` response matches brand guideline

**Gates:** Phase 3 (US-006) **cannot be marked complete** — the session may write and pass automated tests, but AC-2 requires explicit human sign-off before the story is closed

**Pass condition:**
- A human reviewer calls `GET /status` against a running instance (local or CI-deployed) and visually/textually confirms the response body contains `"brand_color":"#ff5d8f"` with that exact six-character hex string (case-insensitive is acceptable only if the brand guideline document explicitly permits it; default assumption is lowercase as written)
- Sign-off is recorded (PR comment, ticket acceptance, or equivalent)

**Fail condition:**
- Response contains a different hex value (e.g., `#FF5D8F` in uppercase if brand requires lowercase, or any digit transposition)
- No human reviewer is available before the release gate; story remains open

**Fallback architecture:**
- No code change is needed; this is a human-approval gate, not a technical blocker
- If the brand guideline document specifies a *different* canonical hex, the constant in `app/routes/status.rb` must be updated and the RSpec literal matcher updated to match
- **Sessions that need brief changes:** Phase 3 (US-006) brief should include an explicit "do not close until OOB-5 sign-off received" note

---

## Summary Table

| ID | What | Gates | Automated? |
|---|---|---|---|
| OOB-1 | Postgres CI service + `DATABASE_URL` | Phase 0 (all downstream) | Yes — CI YAML check + `psql` smoke |
| OOB-2 | Ruby 3.3 on CI runner | Phase 0 (all downstream) | Yes — `ruby --version` + `.ruby-version` pin |
| OOB-3 | `libpq` / `pg` native extension build | Phase 0 | Yes — `bundle install` exit code |
| OOB-4 | RubyGems reachability / `Gemfile.lock` | Phase 0 | Yes — `bundle install` or `--frozen` |
| OOB-5 | Brand color human sign-off | Phase 3 US-006 completion | **No — manual** |