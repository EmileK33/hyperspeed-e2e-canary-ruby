## Session decomposition

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Phase 0 harness + Sinatra scaffold | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `tests/integration/.keep`, `app/app.rb`, `config.ru`, `.rspec`, `Rakefile` | M |
| S1-A | Store (Postgres CRUD) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | L |
| S2-A | Bookmarks routes (POST/GET/DELETE) | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tags routes (POST tag, GET tags) | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S3-A | Health route | Backend API | 3 | S0-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S3-B | Status route (brand color) | Backend API | 3 | S0-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Notes on shared infrastructure
- `app/app.rb` is owned solely by S0-A. It defines `Bookmarks::App < Sinatra::Base`, sets JSON content-type, configures the JSON 404 handler (US-002 AC), and `require`s all route files (`app/routes/bookmarks`, `tags`, `health`, `status`) and `app/store`. Route files reopen `Bookmarks::App` to register endpoints — they never modify `app/app.rb`.
- `Gemfile` is exclusive to S0-A and enumerates **every** gem the project needs: runtime (`sinatra`, `puma`, `pg`, `json`, `rackup`), dev/test (`rspec`, `rack-test`).
- `spec/spec_helper.rb` (S0-A) sets `ENV['DATABASE_URL'] ||= 'postgres://postgres:postgres@localhost:5432/canary_test'` BEFORE requiring `app/app.rb`, provisions schema once (`CREATE TABLE IF NOT EXISTS bookmarks ...; CREATE TABLE IF NOT EXISTS bookmark_tags ...`), and configures `Rack::Test` mixin. Per-spec isolation is row-level via `TRUNCATE` in `before(:each)`.
- S0-A's `test.cmd` is `bundle exec rspec tests/integration` (project-level integration command) and ships a trivial harness spec that exits 0.

### Gate definitions
- **Phase 0 → Phase 1 gate:** S0-A merged. `bundle exec rspec tests/integration` exits 0 on harness spec.
- **Phase 1 → Phase 2 gate:** S1-A merged. Store CRUD specs green.
- **Phase 2 → Phase 3 gate:** S2-A + S2-B merged. Phase 3 sessions (S3-A, S3-B) have no semantic dependency on Phase 2 routes and could start as soon as S0-A clears — see early-start.

### Intra-phase dependencies
- None. Within each phase all sessions touch disjoint files and can run in parallel.

### Early-start optimizations
- **S3-A, S3-B** depend only on S0-A (Sinatra base + harness). They can begin as soon as the Phase 0 gate clears, in parallel with S1-A. Listed as Phase 3 only because the spec assigns them to US-005/006; runtime ordering permits Phase 1 launch.

### Critical path
S0-A → S1-A → S2-A (or S2-B) → (Phase 3) = M + L + M + S ≈ 7 hrs

### Phase-ordering self-check
- S1-A imports from S0-A (`app/app.rb`, harness) → 0 < 1 ✓
- S2-A imports Store from S1-A → 1 < 2 ✓
- S2-B imports Store from S1-A → 1 < 2 ✓
- S2-A, S2-B, S3-A, S3-B reopen `Bookmarks::App` from S0-A → 0 < 2/3 ✓
- S3-A, S3-B import from S0-A only → 0 < 3 ✓
- No same-phase or backwards edges.

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Phase 0 harness + Sinatra scaffold",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "tests/integration/.keep", "app/app.rb", "config.ru", ".rspec", "Rakefile"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.7 Third-party dependencies"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Store (Postgres CRUD)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "L",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.4 Critical ordering rules"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks routes (POST/GET/DELETE)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tags routes (POST tag, GET tags)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest"]
  },
  {
    "id": "S3-A",
    "phase": 3,
    "name": "Health route",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest"]
  },
  {
    "id": "S3-B",
    "phase": 3,
    "name": "Status route (brand color)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest"]
  }
]
```

Total: 6 sessions across 4 phases