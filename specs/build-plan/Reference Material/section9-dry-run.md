## Dry-Run Verification Procedure

---

### Step 1 — Phase 0 Export Manifest

Run S0-A in isolation. From its complete output, extract one row per named artifact:

| # | File Path | Key Exported Artifact / Contract |
|---|-----------|----------------------------------|
| 1 | `Gemfile` | All gem dependencies declared (sinatra, pg, rspec, rack-test, etc.) |
| 2 | `spec/spec_helper.rb` | `DATABASE_URL` default set; schema provisioned once; per-spec `TRUNCATE`; `Rack::Test` mixin included |
| 3 | `tests/integration/harness_spec.rb` | Trivial passing spec present |
| 4 | `tests/integration/.keep` | Empty file present |
| 5 | `app/app.rb` | `Bookmarks::App < Sinatra::Base` defined; JSON content-type; JSON 404 handler; `require_relative` calls for `store`, `routes/bookmarks`, `routes/tags`, `routes/health`, `routes/status` |
| 6 | `config.ru` | Requires `app/app`; runs `Bookmarks::App` |
| 7 | `.rspec` | `--require spec_helper --format documentation` (or equivalent) |
| 8 | `Rakefile` | `default` task runs `bundle exec rspec tests/integration` |

---

### Step 2 — Consolidated Import Table (Phase 1 → Phase 0)

| Session | File Path | Export Name | Expected Type/Shape |
|---------|-----------|-------------|---------------------|
| S1-A | `spec/spec_helper.rb` | `require 'spec_helper'` resolves | File exists, loadable by RSpec; provides `DATABASE_URL` default, schema provisioning, per-spec `TRUNCATE`, `Rack::Test` mixin |
| S1-A | `Gemfile` | Bundler environment | File exists and includes gems needed by `store.rb` (at minimum: `pg` or equivalent Postgres adapter, `rspec`) |
| S1-A | `Gemfile.lock` | Lock file present | Generated from `Gemfile`; allows `bundle exec` to resolve without network in CI |

---

### Step 3 — Mismatch Report

Cross-reference Step 1 output against Step 2 after S0-A runs. Report **only failures**:

| Session | File | Expected Export | Issue | Fix |
|---------|------|-----------------|-------|-----|
| *(populate after Step 1 output is captured)* | | | | |

If no failures are found after inspection: **All imports verified — dry run PASS**

---

### Step 4 — Ambiguous Items Requiring Step 1 Output Inspection

| # | Session | File | What to Verify |
|---|---------|------|----------------|
| 1 | S1-A | `spec/spec_helper.rb` | Confirm `TRUNCATE` scope: does it truncate **all** tables or a specific list? `store_spec.rb` will rely on clean state — if only `bookmarks` is truncated and a `tags` join table exists, tag-related store specs will bleed. |
| 2 | S1-A | `spec/spec_helper.rb` | Confirm schema provisioning mechanism: is it `ActiveRecord::Migration`, raw SQL file execution, or something else? `store.rb` must target the same schema shape. |
| 3 | S1-A | `Gemfile` | Confirm which Postgres adapter gem is listed (`pg`, `sequel`, `activerecord`+`pg`, etc.) — `store.rb` must `require` the same adapter. |
| 4 | S1-A | `spec/spec_helper.rb` | Confirm whether `Rack::Test` mixin is included globally or only in a tagged example group — `store_spec.rb` may not need it, but must not break if it is included. |

---

**Gate rule:** Steps 3 and 4 must both be resolved with zero open mismatches before any S1-A work begins.