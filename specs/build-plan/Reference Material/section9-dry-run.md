## Dry-Run Verification Procedure

---

### Step 1 — Phase 0 Export Manifest

Run S0-A in isolation. After completion, extract one row per named export across all output files:

| # | File | Export Name | Type/Shape |
|---|------|-------------|------------|
| 1 | `Gemfile` | gem `sinatra` | gem declaration, no group |
| 2 | `Gemfile` | gem `pg` | gem declaration, no group |
| 3 | `Gemfile` | gem `rspec` | gem declaration, `:test` group |
| 4 | `Gemfile` | gem `rack-test` | gem declaration, `:test` group |
| 5 | `.rspec` | `--require spec_helper` flag | line present in file |
| 6 | `.rspec` | `--format documentation` flag | line present in file |
| 7 | `spec/spec_helper.rb` | `require 'app/app'` (or equivalent load) | top-level require |
| 8 | `spec/spec_helper.rb` | `Rack::Test::Methods` inclusion | `include` in RSpec config or shared context |
| 9 | `spec/spec_helper.rb` | `app` helper → `Bookmarks::App` | `let(:app) { Bookmarks::App }` or `def app` |
| 10 | `spec/spec_helper.rb` | `ENV['RACK_ENV'] = 'test'` | assignment present |
| 11 | `app/app.rb` | `Bookmarks::App` | `class App < Sinatra::Base` inside `module Bookmarks` |
| 12 | `app/app.rb` | `not_found` handler | block returning `{ "error": "not found" }`, content-type `application/json` |
| 13 | `app/app.rb` | route auto-loader | `Dir[…routes/*.rb…].sort.each { |f| require f }` |

---

### Step 2 — Consolidated Import Table (Phase 1 ← Phase 0)

| Session | File Path | Export Name | Expected Type/Shape |
|---------|-----------|-------------|---------------------|
| S1-A | `spec/spec_helper.rb` | loaded via `--require spec_helper` | auto-loaded by `.rspec`; must be resolvable on load path |
| S1-A | `spec/spec_helper.rb` | `ENV['RACK_ENV'] = 'test'` | set before DB connections open |
| S1-A | `Gemfile` | gem `pg` | available in default or test group so `require 'pg'` works in specs |
| S1-A | `Gemfile` | gem `rspec` | available in test group |
| S1-A | `Gemfile` | gem `rack-test` | available in test group (already declared) |
| S1-A | `app/app.rb` | *(explicitly NOT imported)* | no require in `store.rb` or `store_spec.rb` |

---

### Step 3 — Mismatch Report

Cross-reference manifest (Step 1) against imports (Step 2):

| Session | File | Expected Export | Issue | Fix |
|---------|------|-----------------|-------|-----|
| S1-A | `Gemfile` | gem `pg` | **Shape ambiguity risk**: S0-A brief says `pg` is present but does not specify its group. If `pg` is placed inside the `:test` group it won't be available to `app/store.rb` at runtime; if it's in `:development, :test` only, production use breaks. | S0-A brief §Gemfile: explicitly declare `pg` outside any group (default group) so `require 'pg'` resolves in all environments. |

---

### Step 4 — Ambiguous Items

| # | Session | File | What to verify |
|---|---------|------|----------------|
| 1 | S1-A | `spec/spec_helper.rb` | Confirm load path includes project root so `--require spec_helper` resolves without an explicit `-I` flag (i.e., `.rspec` or `spec_helper` itself adds `$LOAD_PATH << File.expand_path('..', __dir__)`). Cannot confirm from brief text alone — inspect actual Step 1 output. |
| 2 | S1-A | `spec/spec_helper.rb` | The `app` helper (`let`/`def app`) returns `Bookmarks::App` for `rack-test`. Confirm this helper is defined at a scope visible to `store_spec.rb` even though `store_spec.rb` does **not** use `Rack::Test`. If it is defined inside a `describe Bookmarks::App` block rather than globally, it won't conflict — but verify it does not raise on load. |
| 3 | S1-A | `Gemfile` | Confirm `pg` gem group placement from actual file content (see Step 3 mismatch above). |

---

**Resolution required before Phase 1 begins:**

The single identified mismatch (Step 3, row 1) must be resolved: the S0-A brief must explicitly state that `gem 'pg'` is declared in the **default (ungrouped) block** of the `Gemfile`. Once that is confirmed in Step 1 output inspection and the brief is updated accordingly:

> **All imports verified — dry run PASS**