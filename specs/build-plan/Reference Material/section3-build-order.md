# Canary Bookmarks API — Precise Build Order

---

## Phase 0

### Sessions starting at gate open

| Session | Parallel group | Intra-phase sequencing |
|---------|---------------|----------------------|
| **S0-A** Scaffold + Integration Harness | Sole session — no parallelism available | None |

S0-A runs alone. There are no other Phase 0 sessions.

### Phase 0 → Phase 1 Gate Verification Checklist

A human must confirm **all four items** before any Phase 1 work begins:

1. **`bundle exec rspec tests/integration/harness_spec.rb` exits 0** — the trivial smoke spec passes with zero failures, zero errors, zero pending-failures. Terminal output must show `0 failures`.
2. **`Gemfile` enumerates exactly these four gems** — open `Gemfile` and confirm `gem 'sinatra'`, `gem 'pg'`, `gem 'rspec'`, and `gem 'rack-test'` are each present as explicit entries (not transitive-only). `bundle list` output must show all four resolved.
3. **`app/app.rb` uses glob-based require for routes** — open `app/app.rb` and confirm the route-loading mechanism is a glob pattern (e.g., `Dir[File.join(__dir__, 'routes', '*.rb')].each { |f| require f }`) rather than explicit named requires. The file must parse without error when no files exist in `app/routes/`: `ruby -c app/app.rb` exits 0 and `bundle exec ruby -e "require_relative 'app/app'"` exits 0 against an empty `app/routes/` directory.
4. **`.rspec` is present and sets default flags** — `cat .rspec` shows at minimum `--require spec_helper` and `--format documentation` (or project-agreed flags). `bundle exec rspec --version` exits 0.

---

## Phase 1

### Sessions starting at gate open

| Session | Parallel group | Intra-phase sequencing |
|---------|---------------|----------------------|
| **S1-A** Bookmark Store (Postgres) | Sole session — no parallelism available | None |

S1-A runs alone. The session table explicitly states no non-blocking sessions exist in Phase 1.

### Phase 1 → Phase 2 Gate Verification Checklist

A human must confirm **all five items** before any Phase 2 work begins:

1. **`bundle exec rspec tests/integration/store_spec.rb` exits 0** — zero failures. Terminal output must show `0 failures`.
2. **`Store#create` is defined and exercised** — `store_spec.rb` contains at least one example that calls `Store#create` and asserts a returned record with a non-nil `:id`.
3. **`Store#all` is defined and exercised** — `store_spec.rb` contains at least one example that calls `Store#all` and asserts it returns an Array (including empty-array case).
4. **`Store#find` is defined and exercised** — `store_spec.rb` contains at least one example that calls `Store#find` with a known id and asserts the correct record is returned; and at least one example for a missing id (returns nil or raises a defined exception, per spec contract).
5. **`Store#delete` is defined and exercised** — `store_spec.rb` contains at least one example that calls `Store#delete` and confirms the record no longer appears in `Store#all` afterwards.

---

## Phase 2

### Sessions starting at gate open

All four sessions start simultaneously at Phase 2 gate open. They are **fully parallel** — no arrows between any of them.

| Session | Parallel group | Intra-phase sequencing |
|---------|---------------|----------------------|
| **S2-A** Bookmarks CRUD Routes | Group A (all four parallel) | None |
| **S2-B** Tag Routes | Group A (all four parallel) | None |
| **S2-C** Health Route | Group A (all four parallel) | None |
| **S2-D** Status Route (brand_color) | Group A (all four parallel) | None |

Each session owns disjoint files (`app/routes/<name>.rb` and `tests/integration/<name>_spec.rb`). No session reads another's output file. Merge conflicts are structurally impossible given the file ownership table.

### Phase 2 Final Gate Verification Checklist

A human must confirm **all six items** before the build is considered complete:

1. **`bundle exec rspec tests/integration` exits 0** — the full integration suite (all spec files, including harness, store, bookmarks, tags, health, status) completes with zero failures, zero errors. Terminal output must show `0 failures`.
2. **`GET /bookmarks` returns HTTP 200 with `Content-Type: application/json`** — `curl -i http://localhost:4567/bookmarks` shows `HTTP/1.1 200` and `Content-Type: application/json` header present.
3. **`GET /tags` returns HTTP 200 with `Content-Type: application/json`** — `curl -i http://localhost:4567/tags` shows `HTTP/1.1 200` and `Content-Type: application/json` header present.
4. **`GET /healthz` returns HTTP 200 with both `db:ok` and `redis:ok` fields** — `curl -s http://localhost:4567/healthz` produces a JSON body where both `"db":"ok"` and the uptime field are present (exact field names per spec section 1.6); response code is 200.
5. **`GET /status` returns HTTP 200 with `brand_color` field present** — `curl -s http://localhost:4567/status` produces a JSON body containing a `brand_color` key.
6. **Manual sign-off: `brand_color` value is exactly `"#ff5d8f"`** — a human reads the raw response body of `GET /status` and confirms `"brand_color":"#ff5d8f"` (US-006 AC-2). This item requires human eyes and cannot be delegated to the automated suite alone.

---

## Early-Start Optimizations

### Optimization 1 — S2-C (Health Route) early start

| Attribute | Detail |
|-----------|--------|
| **Session** | S2-C |
| **Subset of prerequisites that enables early start** | S0-A complete (glob-require in `app/app.rb` stable; `spec_helper` available). S1-A need not be complete because `app/routes/health.rb` does not call `Store` — it reads only uptime/version data. |
| **What "early start" means** | S2-C begins immediately after Phase 0 gate passes, running concurrently with S1-A rather than waiting for Phase 1 gate. |
| **Risk** | (1) If S1-A changes the `Store` interface in a way that forces a structural change to `app/app.rb` or `spec/spec_helper.rb`, S2-C's spec setup may need re-work. (2) If S1-A introduces a gem or Bundler change, S2-C's test run mid-session may fail mid-flight. (3) Phase 1 gate is expected to be fast (single-file session); the time saving is marginal and the coordination overhead may exceed the gain. **Recommended only if S1-A is unexpectedly delayed.** |

### Optimization 2 — S2-D (Status Route) early start

| Attribute | Detail |
|-----------|--------|
| **Session** | S2-D |
| **Subset of prerequisites that enables early start** | S0-A complete only. `app/routes/status.rb` reads `brand_color` from config/env — no `Store` dependency. |
| **What "early start" means** | S2-D begins immediately after Phase 0 gate, concurrently with S1-A. |
| **Risk** | Same risks as S2-C above. Additionally: if the environment variable schema (spec section 1.12) is still being settled during S1-A work, S2-D's `brand_color` env-var wiring may require a fixup pass. **Same recommendation: defer unless S1-A is delayed.** |

---

## Critical Path

**S0-A → S1-A → S2-A**

Three phases in sequence. S2-A (Bookmarks CRUD) is the largest Phase 2 surface (complexity M, largest route+spec surface area) and therefore the last session expected to complete, making it the tail of the critical path. Total estimated length: ~7 hours.