# HyperSpeed Build Plan — Supervised Runner (Claude Code)

> **Scope note.** This runner is the *supervised entry surface*. All parallelism happens in the Node child process — Claude Code does **not** spawn sub-agents (the Agent tool would silently serialize above ~5 concurrent sessions and flood this context with their output). Every wave of session work runs by shelling out to `node build-plan/run-build.mjs --wave N` via the **Bash tool**.

You are driving an autonomous parallel build. The plan lives in `build-plan/run-manifest.json` next to this file. The user is your supervisor — keep them in the loop, summarize wave-by-wave, surface failures and `[MANUAL]` sign-offs as they happen.

## Pre-flight

Before the first wave, do these in parallel via the Bash tool:

1. `cat build-plan/run-manifest.json` — confirm the file exists and parses. Report to the user: total wave count, the integration command, and a one-line summary per wave (feature waves: number of sessions; integration waves: just the command).
2. `node build-plan/run-build.mjs --dry-run` — confirm the runner agrees with what you read.
3. Run `node build-plan/run-build.mjs --check-env` via the Bash tool. Report each line to the user — lines starting with `✓` are passing checks, lines starting with `✗` are failures. If any check fails, **stop and tell the user before invoking the runner**, surfacing the specific failure and the fix hint shown in the output. Do not proceed past a failed preflight.
   - **Greenfield case (#109):** if `--check-env` reports `Greenfield repo: "<base>" has no <manifest> … run --seed-base`, the base branch is missing the project manifest. Tell the user, then (with their confirmation, on the base branch) run `node build-plan/run-build.mjs --seed-base` via the Bash tool to seed the manifest + lockfile onto the base branch. Re-run `--check-env` and confirm the greenfield line now reads `Project manifest present on "<base>"` before proceeding. Do this before branch protection is enabled (it pushes directly to the base branch).

If `build-plan/run-state.json` already exists, you're resuming. `cat` it, summarize which sessions are `done` (will be skipped) and which are `failed`/`interrupted` (will have their worktrees cleaned and retried). Ask the user to confirm before proceeding.

## Per-wave loop

For each wave `N` in `0..manifest.waves.length`:

1. **Announce.** Tell the user which wave you're about to execute and what it contains (feature: list session IDs; integration: print the command).
2. **Invoke the runner.** Run this exact command via the Bash tool — **not** the Agent tool, not a Task tool:
   ```bash
   node build-plan/run-build.mjs --wave N
   ```
   Stream the output to the user as it arrives. The runner prints `✗ <id> failed at <Mm><Ss> …` lines mid-wave the moment a session fails — surface these to the user as they appear, do not buffer them. Reserve the "do not summarize" rule for the end-of-wave summary once the command exits.
3. **On success (exit 0).**
   - Read the updated `build-plan/run-state.json` and report which sessions completed in this wave with their PR URLs.
   - Sessions with **no** manual ACs (`requiresHumanReview: false`) have auto-merge enabled — they self-merge once CI is green, and the runner waits for them to land and fast-forwards the local base branch before returning. You do nothing for these.
   - For each PR **with** `manualAcs[]` / `requiresHumanReview: true` (look at the corresponding session in `run-manifest.json`), surface the PR URL to the user and list the manual ACs as checkboxes. Instruct them to tick the boxes in the PR description **before merging** — the runner left these PRs open on purpose.
   - Ask the user whether to proceed to the next wave.
4. **On failure (non-zero exit).**
   - Read `build-plan/wave-N-failure-report.json`. If a `build-plan/escalation-N.json` exists alongside it, read that too — the runner wrote it to hand you full halt context (this is your job: you are the exception handler at the halt boundary, not the main loop). A `stalled` error class means the per-session watchdog killed a stuck `claude` after no output/file-change for the timeout — treat it as "genuinely stuck", and on retry consider whether the brief is ambiguous rather than blindly re-running.
   - Summarize each failure to the user: session id, status, PR URL (or "no PR opened"), test exit code, last few lines of stdout, error message.
   - Ask: **retry this wave** (re-invoke `--wave N`; the runner will skip `done` sessions and force-clean failed worktrees) or **abort the build** (stop the loop here; user will fix and re-run later).
   - **If a session's PR opened but its CI later went red**, the fix loop is out-of-band: the user pushes a fix to `bp/<run-id>/<session-id>`, waits for CI green, then runs `node build-plan/run-build.mjs --resume-from-pr <session-id>` (which verifies the PR is green and marks the session `done`). Re-invoke `--wave N` afterwards to advance — the now-`done` session is skipped.
   - Do not advance past a failed wave automatically.

After the last wave, read the final `run-state.json` and report the overall summary table to the user (sessions done, total PRs opened, any `[MANUAL]` items still un-ticked across all PRs).

## Things to do explicitly

- **Use Bash, never the Agent tool, to invoke the runner.** This is the entire point of the hybrid architecture. The Node child process owns all parallelism.
- **Stream runner output verbatim.** The runner prints Diamond-by-Diamond progress (per-session start/PR/done/fail lines); the user wants to see those as they happen, not a post-hoc summary.
- **Tell the user before running the runner**, every time. They should know which wave is about to fire and roughly how many sessions it will spawn.
- **Honor `[MANUAL]` sign-offs.** A `done` session is mergeable but not necessarily merge-*worthy*; only the human can sign off on `[MANUAL]` ACs. If you spot a session whose PR has manual checkboxes, surface them.
- **Inspect a live session's progress** by running `tail -n 50 .bp-worktrees/<run-id>/<session-id>/session.log` via the Bash tool and summarizing the recent activity. The run-id is printed at the start of the runner output; session-ids are in `run-manifest.json`.
- **Tune fan-out if the user's machine is slow** or sessions are timing out: suggest re-running with `node build-plan/run-build.mjs --max-concurrent-sessions 2` (or setting `HS_MAX_CONCURRENT_SESSIONS=2`). Default is 4 parallel sessions; `0` = unlimited.
- **Surface running cost as it accumulates.** Each session-complete and session-fail line includes `$X.XX (run total $Y.YY)`. Echo the running total to the user so they have continuous spend visibility. If the runner halts with a `✗ Refusing to start wave N — projected total cost ...` message, the cap was hit — surface the full message and ask the user whether to raise `--max-cost` or stop.
- **If the user wants unattended overnight runs**, tell them the supervised driver (this file) isn't the right surface — they should run `node build-plan/run-build.mjs --auto-advance always` directly in their terminal. The supervised loop is for interactive use.
- **If the user asks which model is building the code**, read `manifest.intendedBuildModel` from `build-plan/run-manifest.json` and report it. The runner injects `--model <id>` on every claude spawn unless `HS_CLAUDE_CLI_ARGS` already contains `--model` (in which case the env override wins — `--check-env` shows a `⚠` line when that happens).

## Things NOT to do

- Do not spawn sub-agents to parallelize sessions. The Node runner already does this — using the Agent tool on top would either duplicate work or silently serialize.
- Do not read the briefs (`section5-briefs/*.md`) into your own context. Each spawned `claude` child reads only its own brief; mirroring them here would waste tokens and risk context contamination.
- Do not modify `run-manifest.json` mid-build. Plan changes belong in a new build-plan generation, not an in-flight runner.
- Do not retry more than ~3 times across a session boundary without surfacing the failure to the user. If the same wave fails repeatedly with the same error, that's a planning bug; bring the user in.

## Quick reference

| Want to... | Command |
| --- | --- |
| Preview the plan | `node build-plan/run-build.mjs --dry-run` |
| Run preflight checks | `node build-plan/run-build.mjs --check-env` |
| Execute a single wave (this file's loop) | `node build-plan/run-build.mjs --wave N` |
| Execute everything end-to-end (headless mode, no CC needed) | `node build-plan/run-build.mjs` |
| Inspect state mid-build | `cat build-plan/run-state.json` |
| Inspect a halt | `cat build-plan/wave-N-failure-report.json` |
| Resume a session after its PR went green out-of-band | `node build-plan/run-build.mjs --resume-from-pr <id>` |
| Inspect a live session | `tail -n 50 .bp-worktrees/<run-id>/<id>/session.log` |
| Tune fan-out | `node build-plan/run-build.mjs --max-concurrent-sessions N` |
| Set a budget cap | `node build-plan/run-build.mjs --max-cost N` |
| Run unattended (no CC needed) | `node build-plan/run-build.mjs --auto-advance always` |

## What just happened in this prompt

You loaded this markdown file. The build-plan manifest is next to it. Start with the pre-flight checks above, then walk wave-by-wave with the user.
