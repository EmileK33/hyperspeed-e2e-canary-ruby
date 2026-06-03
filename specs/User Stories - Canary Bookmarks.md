# User Stories — Canary Bookmarks API

A tiny Ruby bookmarks HTTP API (Sinatra + RSpec) backed by Postgres. A
build-plan **fixture** (issue #143) and the **foreign-ecosystem proof cell** for
the #144 ecosystem-adapter: Ruby is fail-closed on the generation side today.
Shaped to decompose into ~7 sessions across 4 phases (Phase 0 integration
harness + 3 feature phases) with disjoint file ownership.

## Epic 1 — Data + app

### US-001 — Bookmark store
**As a** developer **I want** a store object **so that** routes read and write
bookmarks without embedding SQL.

- AC-1: `Store#create`, `#all`, `#find`, `#delete` are defined and tested.
- AC-2: The store connects to Postgres via `DATABASE_URL`; an integration spec
  inserts and reads back a row against the fixture database.

### US-002 — Sinatra app bootstrap
**As a** client **I want** a mounted Sinatra app with JSON handling **so that**
routes share one base.

- AC-1: `Bookmarks::App` is a `Sinatra::Base` subclass with JSON responses.
- AC-2: An unknown route returns `404` with a JSON error body.

## Epic 2 — Bookmark + tag routes

### US-003 — Bookmark CRUD
**As a** user **I want** to create, list, and delete bookmarks **so that** I can
manage links.

- AC-1: `POST /bookmarks` creates a bookmark and returns `201`.
- AC-2: `GET /bookmarks` returns all bookmarks as JSON.
- AC-3: `DELETE /bookmarks/:id` removes one and returns `204`.

### US-004 — Tags
**As a** user **I want** to tag bookmarks **so that** I can group them.

- AC-1: `POST /bookmarks/:id/tags` adds a tag and returns the updated bookmark.
- AC-2: `GET /tags` returns the distinct tag set.

## Epic 3 — Operational routes

### US-005 — Health probe
**As an** operator **I want** a health route **so that** load balancers can check
liveness.

- AC-1: `GET /health` returns `200` with `{ "status": "ok" }`.

### US-006 — Status page
**As an** operator **I want** a status route **so that** I can see build + brand
metadata.

- AC-1: `GET /status` returns `200` with `{ version, uptime_seconds }`.
- AC-2 **[MANUAL]**: The status JSON includes the canary brand color
  `#ff5d8f` in a `brand_color` field. *(Human sign-off required — verify the
  exact pink hex renders in the response and matches the brand guideline.)*
