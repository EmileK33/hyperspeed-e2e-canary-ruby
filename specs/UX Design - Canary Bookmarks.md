# UX Design — Canary Bookmarks API

A headless JSON API; "UX" means response shapes and the operator status surface.
Kept deliberately small (build-plan fixture).

## Response conventions

- All responses are `application/json`.
- Errors: `{ "error": string }` with the appropriate status code.
- Success bodies echo the affected bookmark.

## Surfaces

### S1 — Bookmark list (`GET /bookmarks`)
A flat list of bookmarks, each with a URL, title, and tag chips. Deleting calls
`DELETE /bookmarks/:id`.

### S2 — Tags overview (`GET /tags`)
The distinct tag set shown as chips; selecting one filters the bookmark list.

### S3 — Status surface (`GET /status`)
An operator status panel rendering the JSON from `GET /status`:

- `version` — deployed build version.
- `uptime_seconds` — process uptime.
- `brand_color` — the canary brand color, rendered as the panel accent.
  **The brand color is exactly `#ff5d8f`** (canary pink). This precise hex is
  load-bearing: it is the manual-AC token the e2e harness asserts in the PR body,
  so it must survive verbatim into the status response and the panel styling.

## Accessibility

- The status accent (`#ff5d8f`) must meet WCAG AA against its label text; pair it
  with `#3a0a1c` text where used as a background fill.
