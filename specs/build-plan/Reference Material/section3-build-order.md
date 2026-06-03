# Precise Build Order

---

## Phase 0

### Sessions starting at gate open
| Session | Parallel group |
|---------|---------------|
| **S0-A** — Phase 0 harness + Sinatra scaffold | Sole session; no parallelism available |

**Intra-phase sequencing:** None. S0-A is the only session.

### Gate 0 → 1 verification checklist
A human must confirm **all** of the following before any Phase 1 (or early-start) session begins:

1. `bundle install` completes with exit code 0 and produces `Gemfile.lock` containing entries for `sinatra`, `puma`, `pg`, `json`, `rackup`, `rspec`, and `rack-test`.
2. `bundle exec rspec tests/integration` exits 0 and the console output reports exactly the harness spec passing (e.g., `1 example, 0 failures`).
3. `config.ru` is present and `rackup --help` parses it without error (`bundle exec rackup -p 9292 config.ru` starts the process and a `curl http://localhost:9292/` returns any HTTP response — even a 404 JSON body — within 3 seconds; then kill the process).
4. `app/app.rb` defines the constant `Bookmarks::App` (verifiable by `bundle exec ruby -e "require_relative 'app/app'; puts Bookmarks::App.ancestors"` printing `Bookmarks::App` without error).
5. `spec/spec_helper.rb` sets `DATABASE_URL` before requiring the app: running `bundle exec ruby -e "load 'spec/spec_helper.rb'"` against a live Postgres instance exits 0 and does not raise `PG::Error` or `NameError`.
6. `tests/integration/.keep` is present on disk (`ls tests/integration/.keep` exits 0).

---

## Phase 1

### Sessions starting at gate open
| Session | Parallel group |
|---------|---------------|
| **S1-A** — Store (Postgres CRUD) | Sole session; no parallelism available |

**Intra-phase sequencing:** None. S1-A is the only session.

### Gate 1 → 2 verification checklist
A human must confirm **all** of the following before any Phase 2 session begins:

1. `bundle exec rspec tests/integration/store_spec.rb` exits 0 with 0 failures reported in the summary line.
2. `bundle exec rspec tests/integration` exits 0 (harness spec + store spec together; no regressions).
3. `app/store.rb` is present and `bundle exec ruby -e "require_relative 'app/store'; puts Bookmarks::Store"` exits 0 and prints `Bookmarks::Store` (or equivalent constant path).
4. A manual smoke query: start `psql $DATABASE_URL -c "SELECT COUNT(*) FROM bookmarks;"` exits 0 (table exists and is reachable from the test database URL).
5. A manual smoke query: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM bookmark_tags;"` exits 0 (join table exists).

---

## Phase 2

### Sessions starting at gate open
| Session | Parallel group |
|---------|---------------|
| **S2-A** — Bookmarks routes (POST/GET/DELETE) | **Parallel** with S2-B |
| **S2-B** — Tags routes (POST tag, GET tags) | **Parallel** with S2-A |

**Intra-phase sequencing:** S2-A and S2-B touch entirely disjoint files (`app/routes/bookmarks.rb` vs `app/routes/tags.rb`) and neither modifies `app/app.rb`. They may be assigned to separate agents/branches simultaneously with no coordination required until merge.

### Gate 2 → 3 verification checklist
A human must confirm **all** of the following before any nominally-Phase-3 session that has **not** early-started begins (and before any early-started session is merged):

1. `bundle exec rspec tests/integration/bookmarks_spec.rb` exits 0 with 0 failures.
2. `bundle exec rspec tests/integration/tags_spec.rb` exits 0 with 0 failures.
3. `bundle exec rspec tests/integration` exits 0 — full suite including harness and store specs — with 0 failures (regression check).
4. `POST /bookmarks` with body `{"url":"https://example.com","title":"T"}` returns HTTP 201 and a JSON body containing an integer `id` field (verifiable with `curl -s -o /dev/null -w "%{http_code}" -X POST ...` returning `201`).
5. `GET /bookmarks` returns HTTP 200 and a JSON array (verifiable with `curl -s ... | ruby -e "require 'json'; a=JSON.parse(STDIN.read); raise unless a.is_a?(Array)"`  exits 0).
6. `DELETE /bookmarks/:id` for an existing id returns HTTP 200 or 204 (per spec contract); for a nonexistent id returns HTTP 404 with a JSON body (not HTML).
7. `POST /bookmarks/:id/tags` returns HTTP 201; `GET /bookmarks/:id/tags` returns HTTP 200 with a JSON array.

---

## Phase 3

### Sessions starting at gate open
| Session | Parallel group |
|---------|---------------|
| **S3-A** — Health route | **Parallel** with S3-B |
| **S3-B** — Status route (brand color) | **Parallel** with S3-A |

**Intra-phase sequencing:** S3-A and S3-B touch disjoint files (`app/routes/health.rb` vs `app/routes/status.rb`). Full parallel execution; no coordination required.

### Gate 3 → done verification checklist
1. `bundle exec rspec tests/integration/health_spec.rb` exits 0 with 0 failures.
2. `bundle exec rspec tests/integration/status_spec.rb` exits 0 with 0 failures.
3. `bundle exec rspec tests/integration` exits 0 — complete suite — with 0 failures.
4. `GET /health` returns HTTP 200 and a JSON body containing keys `db` with value `"ok"` (verifiable: `curl -s http://localhost:9292/health | ruby -e "require 'json'; h=JSON.parse(STDIN.read); raise unless h['db']=='ok'"` exits 0).
5. `GET /status` returns HTTP 200 and a JSON body containing the brand color field with its specified value (verifiable: `curl -s http://localhost:9292/status | ruby -e "require 'json'; h=JSON.parse(STDIN.read); raise unless h['color']=='<expected_value>'"` exits 0).
6. Any route not defined in the manifest (e.g., `GET /nonexistent`) returns HTTP 404 with a JSON body — not an HTML Sinatra error page (verifiable: `curl -s http://localhost:9292/nonexistent | ruby -e "require 'json'; JSON.parse(STDIN.read)"` exits 0).

---

## Early-Start Optimizations

### S3-A and S3-B — early start into Phase 1 window

| Attribute | Detail |
|-----------|--------|
| **Sessions** | S3-A (Health route), S3-B (Status route) |
| **Subset of prerequisites that enables early start** | S0-A merged and Gate 0 → 1 checklist fully verified. No dependency on S1-A, S2-A, or S2-B. `Bookmarks::App` is defined in `app/app.rb`; route files reopen it without touching `app/app.rb`. |
| **How to execute** | After Gate 0 clears, launch S3-A and S3-B in parallel alongside S1-A. Their specs live in `tests/integration/health_spec.rb` and `tests/integration/status_spec.rb` and can run independently via `bundle exec rspec tests/integration/health_spec.rb`. |
| **Risk** | **Low but real:** if S0-A's scaffold is revised during the Phase 1 window (e.g., a bug fix to `app/app.rb`, `spec/spec_helper.rb`, or `Gemfile`), S3-A/S3-B branches must rebase. Since `app/app.rb` is frozen after S0-A merges (no other session modifies it), the practical rebase risk is confined to `Gemfile` or `spec_helper` hotfixes only. Mitigation: declare S0-A fully merged and locked before launching early-start sessions. |
| **Integration note** | S3-A and S3-B must still pass the full `bundle exec rspec tests/integration` suite (including store and bookmark specs) before final merge, to satisfy the Gate 2 regression requirement in checklist item 3. They may be code-complete and branch-ready before Gate 2 clears, but the merge commit is held until Gate 2 verification passes. |

---

## Critical Path

**S0-A (M) → S1-A (L) → S2-A or S2-B (M, whichever is the last to merge) → Gate 2 verification → S3-A / S3-B merge (S)**

Approximate wall-clock: **M + L + M + S ≈ 7 hours** (assuming S3-A/S3-B are code-complete via early-start and cost only merge overhead on the critical path, not full implementation time).