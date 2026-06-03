# Section 6 — Shared File Ownership Table

Deterministically rendered from each session's owned files and structured cross-session imports (#103). Every owned file appears exactly once.

| File path | Owner session | Importing sessions | Mutable after merge |
| --------- | ------------- | ------------------ | ------------------- |
| `.rspec` | S0-A | — | Yes |
| `app/app.rb` | S0-A | S2-A, S2-B, S3-A, S3-B | No — **LOAD-BEARING** |
| `app/routes/bookmarks.rb` | S2-A | — | Yes |
| `app/routes/health.rb` | S3-A | — | Yes |
| `app/routes/status.rb` | S3-B | — | Yes |
| `app/routes/tags.rb` | S2-B | — | Yes |
| `app/store.rb` | S1-A | S2-A, S2-B | No — **LOAD-BEARING** |
| `config.ru` | S0-A | — | Yes |
| `Gemfile` | S0-A | — | Yes |
| `Rakefile` | S0-A | — | Yes |
| `spec/spec_helper.rb` | S0-A | S1-A, S3-A, S3-B | No — **LOAD-BEARING** |
| `tests/integration/.keep` | S0-A | — | Yes |
| `tests/integration/bookmarks_spec.rb` | S2-A | — | Yes |
| `tests/integration/harness_spec.rb` | S0-A | — | Yes |
| `tests/integration/health_spec.rb` | S3-A | — | Yes |
| `tests/integration/status_spec.rb` | S3-B | — | Yes |
| `tests/integration/store_spec.rb` | S1-A | — | Yes |
| `tests/integration/tags_spec.rb` | S2-B | — | Yes |

**18** owned file(s) · **3** load-bearing (imported across sessions) · **0** ownership conflict(s).

## Commentary

Three files are frozen after their owning session merges, and they demand the most discipline from all downstream contributors. `app/app.rb` carries the highest blast radius: four sessions (S2-A, S2-B, S3-A, S3-B) import it, meaning any post-merge change to the application entry point forces those four sessions to re-verify their route registrations and re-run the consistency check before their own work can be considered stable. `app/store.rb`, owned by S1-A, is imported by both S2-A and S2-B; because those two sessions own all bookmark and tag logic, a mutation to the store interface would simultaneously break two independent workstreams. `spec/spec_helper.rb` is imported by S1-A, S3-A, and S3-B, so any change to test configuration or shared helpers ripples into unit and integration coverage for the health, status, and store layers at once.

Beyond the three flagged load-bearing files, `app/store.rb` deserves extra review as a foundational concern even though its importer count is modest. It is the sole persistence layer for the application; its public interface is an implicit contract that S2-A and S2-B are coding against in parallel. A subtle signature change — method rename, argument reordering, return-type adjustment — will not be caught until integration specs run, at which point two sessions are already affected.

There are no ownership conflicts in this table, so parallel execution across all sessions is unblocked from a file-ownership standpoint, which is the cleanest possible state at this stage.

The single highest-priority coordination action is to treat `app/app.rb` as effectively locked the moment S0-A's session merges: any route-mounting or middleware change after that point must be reviewed jointly by the leads of S2-A, S2-B, S3-A, and S3-B, with a mandatory re-run of the full consistency check before any of those sessions can proceed to their own merge.
