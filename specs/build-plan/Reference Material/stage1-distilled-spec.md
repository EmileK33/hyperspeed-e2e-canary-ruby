# Distilled Specification — Canary Bookmarks API

---

## 1.1 Shared contracts

No TypeScript interfaces (Ruby project, dynamically typed). Cross-session contracts are advisory only; CI RSpec gate proves compatibility at build time.

**[CRITICAL BOUNDARY]** — `Store` API surface (producer: Phase 1 `app/store.rb`; consumers: Phase 2 `app/routes/bookmarks.rb`, `app/routes/tags.rb`; Phase 3 `app/routes/health.rb`, `app/routes/status.rb`):

```ruby
# app/store.rb — must define all four methods before any route session runs
Store#create(attrs)   # inserts a bookmark row, returns the created record
Store#all             # returns all bookmark rows
Store#find(id)        # returns one bookmark row or nil
Store#delete(id)      # removes one bookmark row
```

Ruby is dynamically typed; plan-time contract proof is ADVISORY "unverified". No compile-time enforcement.

**Status response shape** (load-bearing — exact fields required):
```ruby
{ version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }
```

**Error response shape** (all routes):
```ruby
{ "error" => String }
```

---

## 1.2 Database schema

Schema is managed by the fixture Postgres provisioned by the Phase 0 harness. Full DDL is not specified in source documents beyond these requirements derived from the store API and route contracts:

```sql
-- Minimum implied schema; exact DDL owned by app/store.rb (Phase 1)
CREATE TABLE bookmarks (
  id    SERIAL PRIMARY KEY,
  url   TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE tags (
  id          SERIAL PRIMARY KEY,
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL
);

CREATE INDEX ON tags(bookmark_id);
CREATE INDEX ON tags(name);
```

> Note: Exact DDL is implementation-defined by Phase 1; the above is the minimum required to satisfy all AC.

---

## 1.3 State machines and permission matrices

No state machines or role/permission matrices defined. No authentication layer specified.

---

## 1.4 Critical ordering rules

1. **Phase 0 before all feature phases:** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
2. **Phase 1 before Phase 2/3:** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."
3. **Harness detection before manifest build:** "a Ruby Phase-0 session owning `Gemfile` is flagged NOT-READY and the manifest build throws. The ecosystem adapter must make Phase-0 detection + manifest reconcile ecosystem-aware."

---

## 1.5 HTTP status code contracts

| Condition | Required code | Must never return |
|---|---|---|
| `POST /bookmarks` — bookmark created | `201` | — |
| `GET /bookmarks` — success | `200` | — |
| `DELETE /bookmarks/:id` — deleted | `204` | — |
| `POST /bookmarks/:id/tags` — tag added | `200` (returns updated bookmark) | — |
| `GET /tags` — success | `200` | — |
| `GET /health` — liveness | `200` | — |
| `GET /status` — success | `200` | — |
| Unknown route | `404` with `{ "error": string }` body | `200` |

---

## 1.6 Route manifest

**Backend API endpoints:**

- `POST /bookmarks`
- `GET /bookmarks`
- `DELETE /bookmarks/:id`
- `POST /bookmarks/:id/tags`
- `GET /tags`
- `GET /health`
- `GET /status`

---

## 1.7 Third-party dependencies

| Service | Auth mechanism | Quota limits | Risk flags |
|---|---|---|---|
| Postgres (fixture instance) | `DATABASE_URL` env var (connection string) | None stated | Single shared fixture DB; sessions must use isolated rows to avoid collision |

---

## 1.8 Technology stack — selected choices only

| Layer | Choice | Architecturally irreversible reason |
|---|---|---|
| Runtime | Ruby 3.3 | Declared in spec; fixture targets Ruby ecosystem proof for #144 |
| Dependency manager | Bundler (`Gemfile`) | Ruby standard; ecosystem adapter detects `Gemfile` as Phase-0 harness file |
| HTTP framework | Sinatra (`Sinatra::Base`) | Specified; `Bookmarks::App` subclasses `Sinatra::Base` |
| Datastore | Postgres | Specified; `pg` gem; connected via `DATABASE_URL` |
| Test framework | RSpec | Specified; integration specs under `tests/integration/`; run via `bundle exec rspec tests/integration` |
| HTTP test adapter | rack-test | Specified as dev dependency |

**Declared runtime floor:** Ruby 3.3. Source: "Ruby 3.3 · Bundler + RSpec · Sinatra · Postgres" (Architecture spec, line 1) and "**Runtime:** Ruby 3.3" (Architecture spec, Stack section). This floor is load-bearing; no APIs newer than Ruby 3.3 may be used.

**Dependencies:**

| Package (gem name) | Runtime / Dev |
|---|---|
| `sinatra` | runtime |
| `pg` | runtime |
| `rspec` | dev |
| `rack-test` | dev |

---

## 1.9 Performance targets

No specific SLAs or performance targets stated in the source documents.

---

## 1.11 Cross-session runtime patterns

| Pattern | Written by | Read by | Notes |
|---|---|---|---|
| Fixture Postgres rows | All feature phase sessions | All feature phase sessions | Shared single DB; sessions use isolated rows |
| `Store` object (`app/store.rb`) | Phase 1 | Phase 2 (`bookmarks.rb`, `tags.rb`), Phase 3 (`health.rb`, `status.rb`) | Require/load dependency; not a network contract |
| `spec/spec_helper.rb` | Phase 0 (single owner, never edited after) | All RSpec sessions | Shared test registry; frozen after Phase 0 |

---

## 1.12 Environment variable schema

| Variable | Type | Valid values | Default if absent | Startup behavior if invalid | Startup behavior if absent |
|---|---|---|---|---|---|
| `DATABASE_URL` | String | Valid PostgreSQL connection URI | None | Undefined (pg gem will raise on connect) | App boots but all DB calls raise connection error |

---

## 1.13 Feature scope — P0 vs P1

All features are P0 (single release). Full feature list:

- Phase 0: Integration harness (`tests/integration/harness_spec.rb`, `Gemfile`, `spec/spec_helper.rb`)
- Phase 1: Bookmark store (`app/store.rb`) — `Store#create`, `#all`, `#find`, `#delete`; Sinatra app bootstrap (`app/app.rb`) — `Bookmarks::App`, 404 JSON handler
- Phase 2: Bookmark CRUD routes (`app/routes/bookmarks.rb`) — `POST /bookmarks` (201), `GET /bookmarks` (200), `DELETE /bookmarks/:id` (204); Tag routes (`app/routes/tags.rb`) — `POST /bookmarks/:id/tags`, `GET /tags`
- Phase 3: Health route (`app/routes/health.rb`) — `GET /health` → `{ "status": "ok" }`; Status route (`app/routes/status.rb`) — `GET /status` → `{ version, uptime_seconds, brand_color: "#ff5d8f" }`

**Manual sign-off gate (AC-2 of US-006):** Status JSON must include `brand_color: "#ff5d8f"` (exact hex, canary pink). Human verification required that the hex renders in the response and matches brand guidelines. WCAG AA pairing: `#ff5d8f` background with `#3a0a1c` text.