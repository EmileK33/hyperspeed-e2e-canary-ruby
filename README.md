# Ruby canary project — `canary-bookmarks`

Tiny Sinatra + RSpec bookmarks API backed by Postgres. Exists **only** as the
Ruby target project that `tests/e2e/run-canary.mjs --fixture ruby` exercises the
Track B Node runner against (issue #143). It is the Ruby analog of the node
`../canary-project` and the **foreign-ecosystem proof cell** for the #144
ecosystem-adapter.

This is not a published gem. It is a fixture. Treat it like one:

- `Gemfile`, `bundle install`, `bundle exec rspec`, and
  `bundle exec rspec tests/integration` are the real commands a generated plan
  drives — they must work on a Ruby-provisioned host.
- `app/` is intentionally near-empty. The committed source specs in `../specs/`
  describe what sessions should build; the fixture's starting state is "fresh
  bundle init + rspec + one passing integration smoke spec".
- Session output never lands here. The harness copies this dir into a scratch
  checkout of the throwaway test repo on every run.

## Why this fixture exists (the foreign-ecosystem proof)

The node and python fixtures cannot exercise a previously **fail-closed foreign
ecosystem**. Ruby is exactly that: before #144, `validatePhaseZeroHarness` and
the `buildRunManifest` harness precondition hardcoded `package.json`, and the
reconcile had no `Gemfile` merge strategy, so a real generation emitted a
`NOT READY` banner.

As of #144 step 2 the generation-side detection is ecosystem-aware (the adapter
resolves the manifest — `Gemfile` for Ruby — for Phase-0 detection and the
run-manifest precondition), and the contract proof degrades honestly to
`unverified` for the dynamic ecosystem (Decision B). The offline Tier 1 suite
(`tests/build-plan-fixture-matrix.test.ts`) locks the Ruby cell at READY; this
Tier-2 fixture is the **real-build** target validating the same flip end-to-end.
Remaining for the runner side (#144 step 4): `Gemfile` reconcile manifest-merge.

## Toolchain requirement

The Ruby reconcile and relock need **`ruby` + `bundler` on PATH** (and a Postgres
fixture service for the integration specs). The Ruby scenarios self-skip when the
toolchain is absent — the first real run is a manual pre-release gate on a
Ruby-CI throwaway repo. See `../README.md` for throwaway-repo provisioning.
