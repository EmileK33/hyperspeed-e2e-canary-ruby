### Gate: Phase 0 → Phase 1

Required sessions: [S0-A]
Non-blocking: none

- [ ] `bundle install` exits 0 and `Gemfile.lock` is written with no resolution errors
- [ ] `bundle exec ruby -c app/app.rb` exits 0 (no syntax errors in Sinatra base class)
- [ ] `bundle exec ruby -c config.ru` exits 0 (no syntax errors in rack entry point)
- [ ] `psql "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/canary_test}" -c '\q'` exits 0 (Postgres reachable at configured URL)
- [ ] `bundle exec rspec tests/integration/harness_spec.rb` exits 0 and output contains `0 failures`
- [ ] App started via `bundle exec rackup -p 9292`; `curl -s -o /dev/null -w "%{http_code}" http://localhost:9292/nonexistent` prints `404` (JSON 404 handler wired in S0-A is reachable)
- [ ] `curl -s -D - http://localhost:9292/nonexistent | grep -i "content-type"` contains `application/json` (US-002 AC: 404 body is JSON, not HTML)

---

### Gate: Phase 1 → Phase 2

Required sessions: [S1-A]
Non-blocking: [S3-A and S3-B spec runs if early-started in parallel — failures here do not block Phase 2]

- [ ] `bundle exec ruby -c app/store.rb` exits 0 (no syntax errors in Store module)
- [ ] `psql "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/canary_test}" -c "SELECT 1 FROM bookmarks LIMIT 0; SELECT 1 FROM bookmark_tags LIMIT 0;"` exits 0 (both tables provisioned by spec_helper schema block)
- [ ] `bundle exec rspec tests/integration/store_spec.rb` exits 0 and output contains `0 failures`
- [ ] `bundle exec rspec tests/integration/store_spec.rb --format documentation` output includes a passing example for each of: create, find-by-id, list-all, and delete (confirms all four CRUD operations exercised, not just partial coverage)
- [ ] `bundle exec rspec tests/integration` exits 0 (harness spec still green; no regressions from Store addition)

---

### Gate: Phase 2 → Phase 3

Required sessions: [S2-A, S2-B]
Non-blocking: [S3-A and S3-B spec runs if already merged via early-start — their failures do not gate this transition]

- [ ] `bundle exec ruby -c app/routes/bookmarks.rb` exits 0 (no syntax errors)
- [ ] `bundle exec ruby -c app/routes/tags.rb` exits 0 (no syntax errors)
- [ ] `bundle exec rspec tests/integration/bookmarks_spec.rb` exits 0 and output contains `0 failures`
- [ ] `bundle exec rspec tests/integration/tags_spec.rb` exits 0 and output contains `0 failures`
- [ ] App started via `bundle exec rackup -p 9292`; `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9292/bookmarks -H "Content-Type: application/json" -d '{}'` prints `422` (missing `url` field rejected with correct status)
- [ ] `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:9292/bookmarks/00000000-0000-0000-0000-000000000000` prints `404` (delete of nonexistent ID returns correct status)
- [ ] `curl -s -X POST http://localhost:9292/bookmarks -H "Content-Type: application/json" -d '{"url":"https://example.com","title":"Smoke"}' | ruby -e "require 'json'; d=JSON.parse(STDIN.read); abort 'missing id' unless d['id']"` exits 0 (create returns JSON body with `id` field)
- [ ] `curl -s -X POST http://localhost:9292/bookmarks -H "Content-Type: application/json" -d '{"url":"https://example.com","title":"Tag smoke"}' | ruby -e "require 'json'; puts JSON.parse(STDIN.read)['id']"` emits a UUID; then `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9292/bookmarks/<emitted-uuid>/tags -H "Content-Type: application/json" -d '{"name":"smoke"}'` prints `201` (tag creation end-to-end)

---

### Gate: Phase 3 → Complete

Required sessions: [S3-A, S3-B]
Non-blocking: none

- [ ] `bundle exec ruby -c app/routes/health.rb` exits 0 (no syntax errors)
- [ ] `bundle exec ruby -c app/routes/status.rb` exits 0 (no syntax errors)
- [ ] App started via `bundle exec rackup -p 9292`; `curl -s -o /dev/null -w "%{http_code}" http://localhost:9292/health` prints `200`
- [ ] `curl -s http://localhost:9292/health | ruby -e "require 'json'; d=JSON.parse(STDIN.read); abort 'missing status key' unless d.key?('status')"` exits 0 (health response is JSON with a `status` field)
- [ ] `curl -s http://localhost:9292/status | ruby -e "require 'json'; d=JSON.parse(STDIN.read); abort 'missing color key' unless d.key?('color')"` exits 0 (status response is JSON with a `color` field)
- [ ] `curl -s -D - http://localhost:9292/health | grep -i "content-type"` contains `application/json` (health route honours global content-type contract)
- [ ] `curl -s -w "\n%{http_code}" http://localhost:9292/nonexistent` last line is `404` and body parses as JSON (US-002 AC confirmed with full route table loaded)
- [ ] `bundle exec rspec tests/integration/health_spec.rb` exits 0 and output contains `0 failures`
- [ ] `bundle exec rspec tests/integration/status_spec.rb` exits 0 and output contains `0 failures`
- [ ] `bundle exec rspec tests/integration` exits 0 and output contains `0 failures` (complete suite — all six sessions green simultaneously)