# Expected outputs — Ruby canary build plan

This file documents what the Ruby canary's source specs (`specs/`) should
produce when run through `hyperspeed --generate-build-plan` and then through
`agents/build-plan/runner-template/run-build.mjs` with `--fixture ruby`.

The harness (`tests/e2e/run-canary.mjs`) asserts against this contract. If the
build-plan agent legitimately changes its session naming, file ownership splits,
or wave ordering, **update this file in the same commit** so the contract stays
meaningful.

> **Status: READY (as of #144 step 2).** Ruby is the foreign-ecosystem proof
> cell for the #144 ecosystem-adapter. The Phase-0/manifest detection is now
> ecosystem-aware (`validatePhaseZeroHarness` + `buildRunManifest` resolve the
> manifest via the adapter — `Gemfile` for Ruby), so a Ruby Phase-0 session owning
> `Gemfile` + `tests/integration/` is recognized and the plan assembles without a
> NOT-READY banner. The offline Tier 1 suite
> (`tests/build-plan-fixture-matrix.test.ts`) locks the Ruby cell at READY with
> the contract proof degrading honestly to `unverified` (Decision B). This Tier-2
> fixture is the **real-build** target validating the same flip end-to-end.

## Sessions

Seven sessions across four phases (phase 0 = integration harness + three feature
phases). Concrete IDs may shift if the agent renames them; assertions match by
*count per phase* and *file ownership* rather than literal IDs where possible.

| Phase | Expected sessions | What they own | Manual ACs |
| --- | --- | --- | --- |
| 0 | 1 (S0-A) | `Gemfile`, `spec/spec_helper.rb`, `tests/integration/harness_spec.rb` | 0 |
| 1 | 2 (S1-A, S1-B) | `app/store.rb` + `app/app.rb` | 0 |
| 2 | 2 (S2-A, S2-B) | `app/routes/bookmarks.rb` + `app/routes/tags.rb` | 0 |
| 3 | 2 (S3-A, S3-B) | `app/routes/health.rb` + `app/routes/status.rb` | **1** (`US-006 AC-2`, brand `#ff5d8f`) |

Total sessions: **7**. Total PRs opened on a clean run: **7** (once #144 makes
Ruby READY).

## Waves

```
W0  feature      phase 0 — 1 session
W1  integration  integration-0  → bundle exec rspec tests/integration
W2  feature      phase 1 — 2 sessions
W3  integration  integration-1  → bundle exec rspec tests/integration
W4  feature      phase 2 — 2 sessions
W5  integration  integration-2  → bundle exec rspec tests/integration
W6  feature      phase 3 — 2 sessions
W7  integration  integration-3  → bundle exec rspec tests/integration
```

Integration command: `bundle exec rspec tests/integration`.

## Toolchain (requirements block)

- `requirements.runtimes[]` includes `{ name: "ruby", version: "3.3" }`.
- `requirements.workspaceInstall[]` includes a `bundle install` command.
- `projectManifestStub.path` is `Gemfile` (ecosystem inferred as ruby).
- `requirements.services[]` includes a Postgres entry.

## Manual ACs

Exactly one session — the one owning `app/routes/status.rb` (US-006) — should
carry a `[MANUAL]` AC for the canary brand color `#ff5d8f`. The harness asserts
that *some* PR body contains a checkbox referencing `#ff5d8f`.

## Notes on robustness

- Match session count per phase, not exact session names.
- Match PR title pattern (`/^S\d+-[A-Z]: autonomous build$/`).
- Match the `[MANUAL]` AC by the literal `#ff5d8f` token (a unique pink chosen so
  it survives agent rewording).
- Tolerate the integration wave running `bundle exec rspec tests/integration` or
  `rspec tests/integration`.
