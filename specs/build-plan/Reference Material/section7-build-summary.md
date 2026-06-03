## Build Summary

### Phase Table

| Phase | Sessions | Max parallel | Gate requirement | Est. Claude Code hours |
|-------|----------|-------------|-----------------|----------------------|
| 0 | S0-A | 1 | `bundle exec rspec tests/integration` exits 0 on harness spec | 1.5 |
| 1 | S1-A | 1 | Store CRUD integration specs green | 3.0 |
| 2 | S2-A, S2-B | 2 | Both sessions merged; all Phase 2 specs green | 3.0 |
| 3 | S3-A, S3-B | 2 | All specs green across full suite | 1.5 |
| **Total** | **6** | — | — | **9.0 hrs** |

> Phase 2 wall-clock = 1.5 hr (parallel); Phase 3 wall-clock = 0.75 hr (parallel). Claude Code hours column reflects total work, not wall-clock.

---

### Calendar Time

Assuming 0.5 hr same-day human gate review between each phase transition:

**Standard execution (no early-start):**
`1.5 + 0.5 + 3.0 + 0.5 + 1.5 + 0.5 + 0.75 ≈ **8.25 hr**`

**With early-start optimization** (S3-A + S3-B launched in parallel with S1-A immediately after Phase 0 gate):
`1.5 + 0.5 + max(3.0, 0.75) + 0.5 + 1.5 + 0.5 ≈ **7.5 hr**`
_(saves ~45 min; S3-A/S3-B are pre-built and waiting to merge after Phase 2 gate)_

---

### Critical Path

**Chain:** S0-A → S1-A → S2-A (or S2-B) → S3-A/S3-B

| Segment | Duration |
|---------|----------|
| S0-A (M) | 1.5 hr |
| Gate 0→1 | 0.5 hr |
| S1-A (L) | 3.0 hr |
| Gate 1→2 | 0.5 hr |
| S2-A (M) — longest Phase 2 session | 1.5 hr |
| Gate 2→3 | 0.5 hr |
| S3-A (S) — longest Phase 3 session | 0.75 hr |
| **Critical path total** | **8.25 hr** |

S1-A is the single largest block (3.0 hr) and cannot be parallelized — it dominates the schedule.

---

### Cost Estimate

| Session | Complexity | Est. cost |
|---------|-----------|-----------|
| S0-A | M | $1–2 |
| S1-A | L | $2–4 |
| S2-A | M | $1–2 |
| S2-B | M | $1–2 |
| S3-A | S | $0.50–1 |
| S3-B | S | $0.50–1 |
| **Total** | | **$6.50–13** (midpoint ~$9) |

---

### Risk Summary

| Session | Risk factor | Detail |
|---------|------------|--------|
| **S1-A** | 🔴 Critical path + highest complexity | Sole blocker for Phase 2. Schema, connection pooling, error-handling, and all CRUD logic concentrated here. A regression or schema mismatch cascades to S2-A, S2-B. |
| **S0-A** | 🟠 Critical path + most dependents | Every other session reopens `Bookmarks::App` or inherits the harness. A broken `Gemfile`, wrong `spec_helper` DB URL, or missing `require` chain silently breaks all downstream sessions. |
| **S2-A / S2-B** | 🟡 Parallel but both on critical path fan-in | Both must merge before the Phase 2 gate clears. If S2-B runs long, it holds S3-A/S3-B's formal merge even though their code is ready. |
| **S3-A / S3-B** | 🟢 Low risk | No store dependency, minimal logic (health/status endpoints). Failure is isolated and fast to fix. |

**Highest dependency count:** S0-A (all 5 downstream sessions depend on it directly or transitively).

**Highest complexity:** S1-A (L) — database schema provisioning, PG connection management, full CRUD surface, and error-contract correctness all live here.

---

### Recommended Execution Strategy

**Stagger, don't blast all at once.**

1. **Phase 0:** Run S0-A alone. Validate the harness gate before touching anything else — a broken scaffold wastes every parallel session.
2. **After Phase 0 gate clears:** Launch S1-A **and** simultaneously launch S3-A + S3-B as early-start sessions (they only need S0-A). This reclaims ~45 min of calendar time at zero risk since their file sets are fully disjoint from S1-A.
3. **After Phase 1 gate clears:** Launch S2-A and S2-B in parallel. S3-A/S3-B should already be complete and waiting.
4. **After Phase 2 gate clears:** Merge S3-A/S3-B (work already done) and run the full suite.

Do **not** run all 6 sessions simultaneously — S1-A's store interface is a hard dependency for S2-A/S2-B, and S0-A's scaffold is a hard dependency for everything. Premature parallel launch would require speculative interface assumptions and likely force rewrites.