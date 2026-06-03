## Build Summary — Canary Bookmarks API

### Phase Table

| Phase | Sessions | Max parallel | Gate requirement | Est. Claude Code hours |
|-------|----------|-------------|-----------------|----------------------|
| 0 | S0-A | 1 | Smoke spec exits 0; `Gemfile` lists all 4 gems; `app/app.rb` uses glob require | 2.0 |
| 1 | S1-A | 1 | `Store#create/#all/#find/#delete` defined; `store_spec.rb` exits 0 | 2.0 |
| 2 | S2-A, S2-B, S2-C, S2-D | 4 | All 4 sessions merged; full suite green; manual sign-off on `brand_color: "#ff5d8f"` | 6.0 (2.0 wall-clock) |
| **Total** | **6** | — | — | **10.0** |

> Phase 2 wall-clock is **2.0 hrs** (bottlenecked by the two M-complexity sessions run in parallel; S2-C and S2-D finish in ~1 hr and sit idle until gate).

---

### Calendar Time Estimate

Assuming same-day human gate reviews of ~30 min each, and the Phase 2 final gate includes a manual sign-off step (~30 min on top of automated checks):

| Segment | Duration |
|---------|----------|
| Phase 0 execution | 2.0 hrs |
| Gate 0→1 review | 0.5 hrs |
| Phase 1 execution | 2.0 hrs |
| Gate 1→2 review | 0.5 hrs |
| Phase 2 execution (parallel wall-clock) | 2.0 hrs |
| Final gate + manual sign-off | 1.0 hr |
| **Estimated calendar total** | **8.0 hrs** |

A single working day is realistic assuming reviews are not deferred.

---

### Critical Path

**S0-A → S1-A → S2-A** = 2 + 2 + 2 = **6.0 Claude Code hours**
Plus 2 gate reviews = **~7.0 hrs calendar** on the critical path.

---

### Cost Estimate

| Session | Complexity | Est. cost |
|---------|-----------|-----------|
| S0-A | M | $1.00–2.00 |
| S1-A | M | $1.00–2.00 |
| S2-A | M | $1.00–2.00 |
| S2-B | M | $1.00–2.00 |
| S2-C | S | $0.50–1.00 |
| S2-D | S | $0.50–1.00 |
| **Total** | | **$5.00–10.00** |

Midpoint estimate: **~$7.50**

---

### Risk Summary

| Risk | Sessions affected | Notes |
|------|------------------|-------|
| **Critical path** | S0-A, S1-A, S2-A | Any slip in S0-A or S1-A delays the entire project; S2-A is the largest Phase 2 surface and the phase 2 critical-path bottleneck |
| **Highest dependency count** | S0-A | Directly or transitively required by all 5 downstream sessions; a malformed glob require in `app/app.rb` will break all Phase 2 route loading |
| **Highest complexity relative to risk** | S1-A | Single session; no parallelism in Phase 1 to absorb a delay; DB wiring (Postgres connection, schema migrations) is the most likely source of environment-specific failures |
| **Manual gate risk** | S2-D | Final gate requires human sign-off on a specific hex color value — a typo or env-var misconfiguration in `brand_color` will block merge of all Phase 2 work even if all specs are green |
| **Low risk** | S2-C, S2-D | Small surface, no Store dependency at runtime, isolated files; most likely to finish well ahead of S2-A/B |

---

### Recommended Execution Strategy

**Stagger Phase 2 — do not fire all four sessions simultaneously.**

1. **Launch S2-A and S2-B together first.** They are M-complexity, share the most Store surface, and define the largest test files. Getting them started immediately maximizes use of the parallel window.
2. **Launch S2-C and S2-D ~15 minutes later**, after confirming the Phase 2 gate branch is stable and there are no merge-conflict risks on `app/app.rb`. These are S-complexity and will finish ~1 hr earlier than S2-A/B regardless, so the delay is negligible and avoids a situation where a thrashing early commit to a shared file (e.g., a route registration conflict in `app.rb`) forces a re-do.
3. **Do not early-start S2-C/D against a pre-gate S1-A.** The note in the decomposition is correct that it is technically possible, but the Phase 1 gate is fast (~2 hrs total) and the added coordination overhead of tracking a partial-gate state outweighs the ~0 calendar savings.
4. **Pin the `brand_color` env var** in CI before Phase 2 begins so the manual sign-off step at the final gate is a confirmation, not a debugging session.