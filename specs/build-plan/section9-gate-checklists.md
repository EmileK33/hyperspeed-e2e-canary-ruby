### Gate: Phase 0 → Phase 1

Required sessions: [S0-A]
Non-blocking: none

- [ ] `bundle install` exits 0 with no unresolved gems
- [ ] `grep -E '"sinatra"|"pg"|"rspec"|"rack-test"' Gemfile` returns all four gem names (confirm exact strings present)
- [ ] `bundle exec ruby -e "require_relative 'app/app'; puts 'ok'"` exits 0 and prints `ok` with no `LoadError` or `NameError`
- [ ] `bundle exec rspec tests/integration/harness_spec.rb` exits 0 with at least 1 example, 0 failures
- [ ] `bundle exec rspec tests/integration` exits 0 (full suite green against the trivial smoke spec; no other spec files exist yet so this is equivalent to above)
- [ ] Manually confirm `app/app.rb` contains a glob-based require (e.g., `Dir[File.join(__dir__, 'routes', '**', '*.rb')].each { |f| require f }` or equivalent) and does **not** hardcode individual route file paths
- [ ] Create an empty file at `app/routes/_probe.rb` and confirm `bundle exec ruby -e "require_relative 'app/app'; puts 'ok'"` still exits 0, then delete `_probe.rb` (verifies glob require tolerates arbitrary route files without crashing)
- [ ] `.rspec` file exists and contains `--require spec_helper` (or equivalent default-path directive) so specs load `spec/spec_helper.rb` automatically

---

### Gate: Phase 1 → Phase 2

Required sessions: [S1-A]
Non-blocking: none

- [ ] `bundle exec ruby -e "require_relative 'app/store'; puts Store.instance_methods(false).sort.inspect"` exits 0 and output includes `:all`, `:create`, `:delete`, `:find` (exact method names confirmed present)
- [ ] `psql $DATABASE_URL -c '\dt'` exits 0 and lists the `bookmarks` table (confirms migration ran against the target database)
- [ ] `psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name='bookmarks' ORDER BY column_name;"` returns at minimum: `id`, `url`, `title`, `tags`, `created_at` (exact column set per schema spec §1.2)
- [ ] `DATABASE_URL=<test-db-url> bundle exec rspec tests/integration/store_spec.rb` exits 0 with 0 failures and exercises at least one example each for `Store#create`, `Store#all`, `Store#find`, and `Store#delete`
- [ ] `bundle exec rspec tests/integration` exits 0 (harness spec still green; store spec green; no regressions)
- [ ] Manually confirm `app/store.rb` does **not** `require` any file owned by Phase 2 sessions (S2-A through S2-D) — run `grep -E "routes/" app/store.rb` and confirm empty output

---

### Gate: Phase 2 → Final (release)

Required sessions: [S2-A, S2-B, S2-C, S2-D]
Non-blocking: none

- [ ] `bundle exec rspec tests/integration` exits 0 with 0 failures across all six spec files (`harness_spec.rb`, `store_spec.rb`, `bookmarks_spec.rb`, `tags_spec.rb`, `health_spec.rb`, `status_spec.rb`)
- [ ] `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4567/bookmarks -H "Content-Type: application/json" -d '{"url":"https://example.com","title":"Test"}'` returns `201`
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://localhost:4567/bookmarks/99999999` returns `404`
- [ ] `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:4567/bookmarks/99999999` returns `404`
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://localhost:4567/tags` returns `200`
- [ ] `curl -s http://localhost:4567/health` exits 0 and response body is valid JSON containing a `status` key with value `"ok"` — confirm with `curl -s http://localhost:4567/health | ruby -e "require 'json'; d=JSON.parse(STDIN.read); abort unless d['status']=='ok'"`
- [ ] `curl -s http://localhost:4567/status` returns HTTP 200 and response body contains the string `#ff5d8f` — confirm with `curl -s http://localhost:4567/status | grep -F '"#ff5d8f"'` returning a match (US-006 AC-2 manual sign-off)
- [ ] `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer invalid" http://localhost:4567/bookmarks` returns the project-specified rejection status (confirm exact code per §1.5; not 200 and not 500)
- [ ] `grep -rE "require.*routes/" app/app.rb` confirms no hardcoded per-route requires exist — glob pattern is the sole loading mechanism
- [ ] All six owned file paths exist on disk: `app/routes/bookmarks.rb`, `app/routes/tags.rb`, `app/routes/health.rb`, `app/routes/status.rb`, `tests/integration/bookmarks_spec.rb`, `tests/integration/tags_spec.rb`, `tests/integration/health_spec.rb`, `tests/integration/status_spec.rb` — confirm with `ls app/routes/{bookmarks,tags,health,status}.rb tests/integration/{bookmarks,tags,health,status}_spec.rb` exiting 0