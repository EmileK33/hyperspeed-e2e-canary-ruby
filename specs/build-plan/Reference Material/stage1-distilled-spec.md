# Distilled Specification — Canary Bookmarks API

---

## 1.1 Shared contracts

Ruby is dynamically typed; plan-time contract proof is ADVISORY "unverified". The single cross-module dependency is:

**`app/store.rb` → `app/routes/*` (Phase 1 producer → Phase 2/3 consumer)**

`Store` must expose the following interface (Ruby, no static types):

```ruby
# [CRITICAL BOUNDARY] Store public interface
Store#create(url:, title:, tags: [])  # → bookmark hash
Store#all                              # → Array of bookmark hashes
Store#find(id)                         # → bookmark hash | nil
Store#delete(id)                       # → void
```

Bookmark hash shape (used in all route responses):

```
{ id, url, title, tags: [] }
```

Error response shape (all routes):

```
{ "error": String }
```

Status response shape (`GET /status`):

```
{ version: String, uptime_seconds: Numeric, brand_color: "#ff5d8f" }
```

Health response shape (`GET /health`):

```
{ "status": "ok" }
```

---

## 1.2 Database schema

Schema is managed by the store layer (`app/store.rb`). No explicit DDL is given in the spec. The integration harness provisions a fixture Postgres database run-once before any parallel worker runs. The store connects via `DATABASE_URL`.

Implied tables (from user stories and store interface):

```sql
CREATE TABLE bookmarks (
  id    SERIAL PRIMARY KEY,
  url   TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE bookmark_tags (
  id          SERIAL PRIMARY KEY,
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag         TEXT    NOT NULL
);

CREATE INDEX ON bookmark_tags(bookmark_id);
CREATE INDEX ON bookmark_tags(tag);
```

*No RLS, partitioning, or CHECK constraints specified.*

---

## 1.3 State machines and permission matrices

No status transitions or role-permission matrices specified. No authentication layer.

---

## 1.4 Critical ordering rules

1. **Phase 0 before all feature phases.** "Provisioned **run-once** by the Phase 0 harness before any parallel worker runs; feature sessions read/write isolated rows."
2. **Phase 1 before Phase 2/3.** "`app/routes/*` use the `Store` from `app/store.rb` (Phase 1 → Phase 2/3 dependency; producer phase precedes consumer phase)."
3. **Harness detection before manifest build.** "The ecosystem adapter must make Phase-0 detection + manifest reconcile ecosystem-aware" — Ruby Phase-0 must flip NOT-READY → READY before the manifest build proceeds.

---

## 1.5 HTTP status code contracts

| Condition | Required code | Must never return |
|---|---|---|
| `POST /bookmarks` success | `201` | — |
| `GET /bookmarks` success | `200` | — |
| `DELETE /bookmarks/:id` success | `204` | — |
| `POST /bookmarks/:id/tags` success | `200` (returns updated bookmark) | — |
| `GET /tags` success | `200` | — |
| `GET /health` success | `200` | — |
| `GET /status` success | `200` | — |
| Unknown route | `404` with `{ "error": String }` JSON body | — |

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

*No frontend page routes — headless JSON API only.*

---

## 1.7 Third-party dependencies

| Service | Auth mechanism | Quota limits | Risk flags |
|---|---|---|---|
| Postgres (fixture) | `DATABASE_URL` connection string | None stated | Single shared fixture DB — all integration specs share one database; isolation is row-level only |

---

## 1.8 Technology stack — selected choices only

| Layer | Choice | Architecturally irreversible reason |
|---|---|---|
| Runtime | Ruby 3.3 | Declared explicitly; fixture targets Ruby ecosystem for #144 proof |
| Dependency manager | Bundler (`Gemfile`) | Ruby standard; workspace install via `bundle install` |
| HTTP framework | Sinatra (`Sinatra::Base`) | Named in spec; `Bookmarks::App < Sinatra::Base` |
| Database driver | `pg` gem | Connects to Postgres via `DATABASE_URL` |
| Test framework | RSpec | Integration specs under `tests/integration/`; CI gate is `bundle exec rspec tests/integration` |
| HTTP test adapter | `rack-test` | Named explicitly as dev dependency |
| Datastore | PostgreSQL | Provisioned as native CI service; `DATABASE_URL` is the connection contract |

**Declared runtime floor:** Ruby 3.3. Source: Architecture spec, "Runtime: Ruby 3.3". CI is pinned to this version.

**Dependencies:**

*Runtime:*
- `sinatra`
- `pg`

*Dev/test:*
- `rspec`
- `rack-test`

---

## 1.9 Performance targets

No SLAs or performance targets specified.

---

## 1.11 Cross-session runtime patterns

| Pattern | Written by | Read by | Notes |
|---|---|---|---|
| Fixture Postgres rows | Any feature phase integration spec | Any other feature phase integration spec | Shared database — isolation is row-level; harness provisions schema run-once in Phase 0 |
| `Store` API (Ruby object interface) | Phase 1 (`app/store.rb`) | Phase 2 (`app/routes/bookmarks.rb`, `app/routes/tags.rb`), Phase 3 (`app/routes/health.rb`, `app/routes/status.rb`) | ADVISORY unverified at plan time; proven by RSpec CI gate |
| `spec/spec_helper.rb` | Phase 0 (single owner, never edited by feature sessions) | All RSpec specs across all phases | Analog of `vitest.workspace.ts`; must not be modified by feature sessions |

---

## 1.12 Environment variable schema

| Variable | Type | Valid values | Default if absent | Startup behavior if invalid | Startup behavior if absent |
|---|---|---|---|---|---|
| `DATABASE_URL` | String | Valid Postgres connection URI | None | Connection will fail at query time | Store cannot connect; all DB operations fail |

---

## 1.13 Feature scope — P0 vs P1

All features are P0 (single release). Full feature list:

- **Phase 0:** Integration harness (`tests/integration/harness_spec.rb`, `Gemfile`, `spec/spec_helper.rb`)
- **Phase 1 — US-001:** `Store#create`, `#all`, `#find`, `#delete` with Postgres integration (`app/store.rb`)
- **Phase 1 — US-002:** `Bookmarks::App` Sinatra base with JSON handling and 404 JSON error body (`app/app.rb`)
- **Phase 2 — US-003:** `POST /bookmarks` (201), `GET /bookmarks` (200), `DELETE /bookmarks/:id` (204) (`app/routes/bookmarks.rb`)
- **Phase 2 — US-004:** `POST /bookmarks/:id/tags` (200, returns updated bookmark), `GET /tags` (200, distinct tag set) (`app/routes/tags.rb`)
- **Phase 3 — US-005:** `GET /health` → `200 { "status": "ok" }` (`app/routes/health.rb`)
- **Phase 3 — US-006:** `GET /status` → `200 { version, uptime_seconds, brand_color: "#ff5d8f" }` (`app/routes/status.rb`); AC-2 is **[MANUAL]** — human sign-off required that exact hex `#ff5d8f` renders in the response and matches brand guideline