# Section 6 — Shared File Ownership Table

Deterministically rendered from each session's owned files and structured cross-session imports (#103). Every owned file appears exactly once.

| File path | Owner session | Importing sessions | Mutable after merge |
| --------- | ------------- | ------------------ | ------------------- |
| `.rspec` | S0-A | — | Yes |
| `app/app.rb` | S0-A | S2-A, S2-B, S2-C, S2-D | No — **LOAD-BEARING** |
| `app/routes/bookmarks.rb` | S2-A | — | Yes |
| `app/routes/health.rb` | S2-C | — | Yes |
| `app/routes/status.rb` | S2-D | — | Yes |
| `app/routes/tags.rb` | S2-B | — | Yes |
| `app/store.rb` | S1-A | S2-A, S2-B | No — **LOAD-BEARING** |
| `Gemfile` | S0-A | — | Yes |
| `spec/spec_helper.rb` | S0-A | S2-A, S2-C, S2-D | No — **LOAD-BEARING** |
| `tests/integration/bookmarks_spec.rb` | S2-A | — | Yes |
| `tests/integration/harness_spec.rb` | S0-A | — | Yes |
| `tests/integration/health_spec.rb` | S2-C | — | Yes |
| `tests/integration/status_spec.rb` | S2-D | — | Yes |
| `tests/integration/store_spec.rb` | S1-A | — | Yes |
| `tests/integration/tags_spec.rb` | S2-B | — | Yes |

**15** owned file(s) · **3** load-bearing (imported across sessions) · **0** ownership conflict(s).

## Commentary

Three files are frozen after their owning session merges: `app/app.rb` (owned by S0-A), `app/store.rb` (owned by S1-A), and `spec/spec_helper.rb` (owned by S0-A). Because these are marked load-bearing, any post-merge change to one of them invalidates the assumptions of every session that imports it, requiring those sessions to re-integrate and the full consistency check to be re-run before further work can proceed. Practically, this means S0-A and S1-A must merge cleanly and early, since four of the five downstream sessions in the S2 wave depend on at least one of their files.

`app/store.rb` deserves particular scrutiny beyond its load-bearing status. As the apparent persistence layer, its public interface — method signatures, return types, error contracts — forms an implicit contract with both S2-A and S2-B. Even a superficially minor refactor (renaming a method, changing a return value's shape) will silently break the bookmark and tag route layers unless those sessions are notified and their specs re-verified. Reviewers should confirm that `store.rb` exports a stable, explicitly documented interface before S1-A's PR is approved. Similarly, `app/app.rb` is the application entry point imported by all four S2 route sessions; its middleware stack, mount points, and environment configuration should be treated as a public API contract during review.

There are no ownership conflicts in this table, so parallel execution across sessions is unblocked on that front. The highest-risk coordination point remains `app/app.rb`: with four importing sessions, it has the widest blast radius of any file in the build. The concrete recommendation is to lock `app/app.rb` behind a required review gate — at minimum two approvers including one from the S2 wave — and to run the full integration suite against a branch tip that includes S0-A's merge before any S2 session opens a pull request.
