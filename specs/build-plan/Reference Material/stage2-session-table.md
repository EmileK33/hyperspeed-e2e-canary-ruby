## Session Decomposition — Canary Bookmarks API

| ID | Name | Category | Phase | Prerequisites | Owned files (exhaustive) | Complexity |
| -- | ---- | -------- | ----- | ------------- | ------------------------ | ---------- |
| S0-A | Scaffold + Integration Harness | Infrastructure | 0 | — | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb`, `app/app.rb`, `.rspec` | M |
| S1-A | Bookmark Store (Postgres) | Backend API | 1 | S0-A | `app/store.rb`, `tests/integration/store_spec.rb` | M |
| S2-A | Bookmarks CRUD Routes | Backend API | 2 | S1-A | `app/routes/bookmarks.rb`, `tests/integration/bookmarks_spec.rb` | M |
| S2-B | Tag Routes | Backend API | 2 | S1-A | `app/routes/tags.rb`, `tests/integration/tags_spec.rb` | M |
| S2-C | Health Route | Backend API | 2 | S1-A | `app/routes/health.rb`, `tests/integration/health_spec.rb` | S |
| S2-D | Status Route (brand_color) | Backend API | 2 | S1-A | `app/routes/status.rb`, `tests/integration/status_spec.rb` | S |

### Gate definitions

- **Phase 0 → Phase 1 gate**: S0-A must complete. `bundle exec rspec tests/integration` must exit 0 on the trivial smoke spec. `Gemfile` must enumerate all four gems (`sinatra`, `pg`, `rspec`, `rack-test`). `app/app.rb` must safely load any present route files (glob-based require) so it doesn't break before Phase 2.
- **Phase 1 → Phase 2 gate**: S1-A must complete. `Store#create/#all/#find/#delete` must be defined and exercised by `store_spec.rb`. No non-blocking sessions in Phase 1.
- **Phase 2 final gate**: S2-A, S2-B, S2-C, S2-D all merged; full `bundle exec rspec tests/integration` green; manual sign-off on `brand_color: "#ff5d8f"` rendering in `GET /status` (US-006 AC-2).

### Intra-phase dependencies

None within any phase — all Phase 2 sessions are mutually independent (different route files, different spec files, both only import `Store` from Phase 1).

### Early-start optimizations

- S2-C (Health) and S2-D (Status) technically do not need `Store` (they read version/uptime/brand). If S1-A defines `Store` early but DB wiring lingers, S2-C/D can begin against the already-stable `app/app.rb` scaffold. In practice the Phase 1 gate is fast (single file) so early-start is marginal.

### Critical path

S0-A → S1-A → S2-A (Bookmarks CRUD — largest Phase 2 surface). Length: 3 phases, ~7 hrs.

### Phase-ordering self-check

- `app/store.rb` (S1-A) imports nothing session-produced → N/A
- `tests/integration/store_spec.rb` (S1-A) imports `spec_helper` (S0-A) → S0-A phase 0, S1-A phase 1 ✓
- `app/routes/bookmarks.rb` (S2-A) imports `Store` from S1-A → S1-A phase 1, S2-A phase 2 ✓
- `app/routes/tags.rb` (S2-B) imports `Store` from S1-A → phase 1 < phase 2 ✓
- `app/routes/health.rb` (S2-C) loaded by `app/app.rb` (S0-A) via glob require → S0-A phase 0, S2-C phase 2 ✓ (S0-A does not import from S2-C; lazy glob require ≠ symbol import)
- `app/routes/status.rb` (S2-D) — same as S2-C ✓
- All Phase 2 spec files import `spec_helper` (S0-A) → phase 0 < phase 2 ✓

Phase-ordering self-check: PASS

```json
[
  {
    "id": "S0-A",
    "phase": 0,
    "name": "Scaffold + Integration Harness",
    "category": "Infrastructure",
    "prerequisites": [],
    "ownedFiles": ["Gemfile", "spec/spec_helper.rb", "tests/integration/harness_spec.rb", "app/app.rb", ".rspec"],
    "complexity": "M",
    "specSections": ["1.4 Critical ordering rules", "1.7 Third-party dependencies", "1.8 Technology stack — selected choices only", "1.11 Cross-session runtime patterns", "1.12 Environment variable schema", "1.5 HTTP status code contracts"]
  },
  {
    "id": "S1-A",
    "phase": 1,
    "name": "Bookmark Store (Postgres)",
    "category": "Backend API",
    "prerequisites": ["S0-A"],
    "ownedFiles": ["app/store.rb", "tests/integration/store_spec.rb"],
    "complexity": "M",
    "specSections": ["1.1 Shared contracts", "1.2 Database schema", "1.12 Environment variable schema", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-A",
    "phase": 2,
    "name": "Bookmarks CRUD Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/bookmarks.rb", "tests/integration/bookmarks_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-B",
    "phase": 2,
    "name": "Tag Routes",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/tags.rb", "tests/integration/tags_spec.rb"],
    "complexity": "M",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.1 Shared contracts", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-C",
    "phase": 2,
    "name": "Health Route",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/health.rb", "tests/integration/health_spec.rb"],
    "complexity": "S",
    "specSections": ["1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  },
  {
    "id": "S2-D",
    "phase": 2,
    "name": "Status Route (brand_color)",
    "category": "Backend API",
    "prerequisites": ["S1-A"],
    "ownedFiles": ["app/routes/status.rb", "tests/integration/status_spec.rb"],
    "complexity": "S",
    "specSections": ["1.1 Shared contracts", "1.5 HTTP status code contracts", "1.6 Route manifest", "1.13 Feature scope — P0 vs P1"]
  }
]
```

Total: 6 sessions across 3 phases