# Decomposition Verification Report

Proves the plan parallelizes before it is trusted (#141 / #138 tenet 4). Deterministic layers (static checks + structural merge simulation) are BLOCKING; the interface/contract proof and the critic are ADVISORY.

**Verdict:** ✅ VERIFIED — no blocking parallel-safety hazards.

| Layer | Result |
| ----- | ------ |
| Static checks (blocking) | PASS |
| Merge simulation (blocking) | PASS — 3 merge point(s) proven conflict-free |
| Interface/contract proof (advisory) | UNVERIFIED — could not type-check (advisory; CI gate covers build-time) |
| Decomposition critic (advisory) | 4 hazard(s) |

## ⚠ Advisory findings (review; do not block)

### 1. [contract] Contract proof unverified for ecosystem "ruby"
The declared interface contract was NOT statically proven: "ruby" is a dynamic ecosystem with no in-memory plan-time type proof. The language-agnostic structural checks (ownership completeness + merge simulation) still ran and are BLOCKING; a genuine cross-session contract mismatch is backstopped by the uniform CI test gate + the runner reconcile re-test at build time.

### 2. [critic] [high] Phase 2 sessions each create their own Postgres tables/state without a shared DB-reset coordination contract
S2-A, S2-B, S2-C, and S2-D all run integration specs in parallel against the same real Postgres fixture database. S2-A's bookmark CRUD tests insert/delete rows in the bookmarks table; S2-B's tag tests also insert bookmarks as prerequisites. Without an explicit between-example truncation or transaction-rollback strategy declared in spec_helper (owned by S0-A and frozen after that session), parallel spec runs will see each other's fixture data, causing intermittent failures. Fix: S0-A must bake a DB-cleanup hook (e.g., database_cleaner or a DELETE/TRUNCATE around each example) into spec_helper.rb before it is frozen, so all Phase 2 sessions inherit a clean slate per example. (sessions: S2-A, S2-B, S2-C, S2-D)

### 3. [critic] [medium] S2-A and S2-B both register routes on the shared Sinatra app class without a declared registration-order contract
Both sessions add route handlers to `Bookmarks::App` (defined in `app/app.rb`) by requiring their files into the same class via the glob loader. If either session's routes include a broad catch-all or overlapping path segment (e.g., `/bookmarks/:id` in S2-A vs `/bookmarks/:id/tags` in S2-B), Sinatra's first-match-wins routing means merge order of the glob sort determines correctness. The plan has no declared sort-order contract beyond `Dir[...].sort`. Fix: explicitly document and test that `bookmarks.rb` sorts before `tags.rb` (it does alphabetically) and add a route-ordering smoke test, or use explicit `require` ordering in `app.rb` rather than relying on filesystem sort. (sessions: S2-A, S2-B)

### 4. [critic] [medium] S1-A DDL bootstrap races with Phase 2 parallel spec runs if store_spec truncates or drops tables
S1-A's `store.rb` runs `CREATE TABLE IF NOT EXISTS` as a DDL bootstrap on first load. If S1-A's store_spec performs any destructive DDL (DROP/TRUNCATE) as part of cleanup and a Phase 2 session's spec suite loads the app concurrently (in a parallel CI matrix), the table may not exist when Phase 2 specs begin. Fix: ensure S1-A's spec teardown only deletes rows (DML), never drops or recreates the schema, and document this as a constraint in the gate definition. (sessions: S1-A, S2-A, S2-B)

### 5. [critic] [medium] spec/spec_helper.rb is frozen after S0-A but Phase 2 sessions may each need per-suite DB setup hooks
The brief states spec_helper is 'frozen after this session — no other session may edit.' However, S2-A and S2-B require database truncation/transaction hooks to run safely in isolation. If S0-A does not include a sufficiently general cleanup hook, Phase 2 sessions have no sanctioned way to add one, and workarounds (inline `before`/`after` blocks per spec) will be ad-hoc and inconsistent. Fix: S0-A must proactively include a generic around-each DB-cleanup hook before freezing spec_helper, explicitly called out in the Phase 0→1 gate criteria. (sessions: S0-A, S2-A, S2-B)
