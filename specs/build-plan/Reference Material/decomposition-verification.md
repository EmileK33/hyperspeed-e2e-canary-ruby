# Decomposition Verification Report

Proves the plan parallelizes before it is trusted (#141 / #138 tenet 4). Deterministic layers (static checks + structural merge simulation) are BLOCKING; the interface/contract proof and the critic are ADVISORY.

**Verdict:** ✅ VERIFIED — no blocking parallel-safety hazards.

| Layer | Result |
| ----- | ------ |
| Static checks (blocking) | PASS |
| Merge simulation (blocking) | PASS — 4 merge point(s) proven conflict-free |
| Interface/contract proof (advisory) | UNVERIFIED — could not type-check (advisory; CI gate covers build-time) |
| Decomposition critic (advisory) | 4 hazard(s) |

## ⚠ Advisory findings (review; do not block)

### 1. [contract] Contract proof unverified for ecosystem "ruby"
The declared interface contract was NOT statically proven: "ruby" is a dynamic ecosystem with no in-memory plan-time type proof. The language-agnostic structural checks (ownership completeness + merge simulation) still ran and are BLOCKING; a genuine cross-session contract mismatch is backstopped by the uniform CI test gate + the runner reconcile re-test at build time.

### 2. [critic] [high] spec/spec_helper.rb runs TRUNCATE across ALL tables, but parallel sessions may own disjoint table sets at different merge states
S0-A's spec_helper.rb issues TRUNCATE on both `bookmarks` and `bookmark_tags` in every `before(:each)`. When S3-A or S3-B run in parallel with S2-A/S2-B (or S1-A), their test processes share the same live Postgres database. Concurrent truncations mid-test-run in one session can silently delete rows another session's spec just inserted, causing spurious failures that are hard to reproduce. Fix: use per-session database namespaces (separate DB names), or run each parallel session's specs in a transaction-rollback isolation mode rather than TRUNCATE, or enforce that integration specs never run truly concurrently against the same DB instance. (sessions: S1-A, S2-A, S2-B, S3-A, S3-B)

### 3. [critic] [high] app/app.rb hard-codes require_relative for all route files before those files exist
S0-A writes `app/app.rb` with `require_relative` calls for `app/routes/bookmarks`, `app/routes/tags`, `app/routes/health`, and `app/routes/status`. When S0-A's harness spec runs (`bundle exec rspec tests/integration`), Ruby will attempt to load those files at boot time. Since S2-A, S2-B, S3-A, and S3-B have not merged yet, the require will raise `LoadError`, breaking the Phase 0 gate and every subsequent session's isolated test run until all four route files exist. Fix: use `require_relative` inside a rescue/LoadError guard, switch to auto-discovery (Dir.glob), or create empty stub files for each route in S0-A's owned files. (sessions: S0-A, S2-A, S2-B, S3-A, S3-B)

### 4. [critic] [medium] S3-A and S3-B isolated test runs require store.rb (via app.rb) which is owned by S1-A and may not be merged
Because `app/app.rb` (S0-A) unconditionally `require_relative`s `app/store` and all route files, any session that boots the Rack app in its specs implicitly depends on `app/store.rb` existing. S3-A and S3-B declare a prerequisite only on S0-A, not S1-A, yet their `rspec` invocation will fail with `LoadError` if S1-A has not merged. Fix: either add S1-A as a prerequisite for S3-A/S3-B, or make the require_relative for store guarded/lazy. (sessions: S3-A, S3-B, S1-A)

### 5. [critic] [medium] Shared live Postgres schema provisioned once in spec_helper; parallel session CI runs may race on CREATE TABLE IF NOT EXISTS
spec_helper.rb runs `CREATE TABLE IF NOT EXISTS bookmarks ...` and `CREATE TABLE IF NOT EXISTS bookmark_tags ...` once per process startup. When multiple CI jobs for parallel sessions (S2-A, S2-B, S3-A, S3-B) all start at the same time against the same Postgres instance, they each race to execute DDL. While `IF NOT EXISTS` is largely safe, concurrent DDL on the same table in Postgres can still produce lock contention or transient errors under load. Fix: run schema migration as a single pre-job step in CI before launching parallel session specs, or give each parallel job its own database. (sessions: S2-A, S2-B, S3-A, S3-B)
