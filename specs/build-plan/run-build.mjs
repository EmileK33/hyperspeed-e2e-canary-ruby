#!/usr/bin/env node
/**
 * HyperSpeed Build Plan — Node Runner (Track B, issue #37)
 *
 * Executes a `run-manifest.json` wave-by-wave. Each feature wave fans out
 * sessions up to the configured concurrency limit (bounded fan-out via
 * `runWithConcurrency`; see `--max-concurrent-sessions`). Each integration
 * wave runs a single project-level test command and gates downstream waves.
 *
 * Resumability via `run-state.json` (per-session status persisted to disk;
 * `done` sessions skipped on restart, `failed` sessions get their worktree
 * force-cleaned before retry). SIGINT/SIGTERM trap writes `interrupted`
 * state and force-removes in-progress worktrees before exit.
 *
 * Usage:
 *   node build-plan/run-build.mjs              # execute all waves
 *   node build-plan/run-build.mjs --wave 0     # execute a single wave (CC entry surface)
 *   node build-plan/run-build.mjs --dry-run    # print the wave plan, exit
 *
 * Pre-requisites for the runner's PR-gating guarantee — see README.md.
 *
 * Read-only deps: Node stdlib + `gh` CLI + `claude` CLI. No npm deps.
 */

import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// #125 Item 1: a maintained TOML parser is vendored alongside this runner (the
// runner ships standalone with zero npm deps, so it cannot `import 'smol-toml'`
// from a node_modules that python-only projects never install). createRequire
// loads the bundled CJS build by relative path.
const _require = createRequire(import.meta.url);

// ─── Constants ───────────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(SCRIPT_DIR, 'run-manifest.json');
const STATE_PATH = path.join(SCRIPT_DIR, 'run-state.json');
const STDOUT_TAIL_LINES = 50;
const GH_RETRY_DELAYS_MS = [5_000, 15_000, 45_000]; // 3 attempts (initial + 2 retries-after)
const GH_RETRY_CODES = new Set([403, 429]);
// #127: bounded escalating backoff for transient filesystem / git-worktree
// locks (antivirus, indexer, OneDrive/Dropbox/iCloud sync). One delay per
// retry-after-failure → 1 initial attempt + 4 retries before giving up. Short
// enough to stay responsive, long enough to outlast a sub-second sync lock.
const FS_RETRY_DELAYS_MS = [50, 150, 450, 1000];
// Transient Windows lock codes worth retrying on an atomic rename. ENOENT and
// other hard errors are NOT here — they propagate immediately.
const RENAME_TRANSIENT_CODES = new Set(['EPERM', 'EEXIST', 'EACCES', 'EBUSY']);
// #137 Phase 4: per-feature-wave concurrency defaults. Windows defaults lower to
// reduce the `.git/config` lock race on concurrent `git worktree add` (see
// resolveConcurrency). Both overridable via --max-concurrent-sessions / env.
const DEFAULT_CONCURRENCY = 4;
const WINDOWS_DEFAULT_CONCURRENCY = 2;
const CLAUDE_CLI = process.env.HS_CLAUDE_CLI || 'claude';
// Tokenize HS_CLAUDE_CLI_ARGS like a tiny shell — supports `"double-quoted args"`
// so paths with spaces (common on Windows) survive. parseShellCmd is defined
// later in this file; we inline its regex here to avoid a forward-reference.
const CLAUDE_CLI_ARGS = (() => {
  const raw = process.env.HS_CLAUDE_CLI_ARGS || '--dangerously-skip-permissions -p';
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) out.push(m[1] ?? m[2]);
  return out;
})();
const REPO_ROOT = process.env.HS_REPO_ROOT || process.cwd();

// ─── #136 defect 2: scope every gh call to the build's repo ───────────────────
//
// All `git` calls already pass `{cwd: repoRoot}`, but `gh` resolves the target
// repo from process.cwd() unless told otherwise. When the runner is invoked from
// a source directory with `HS_REPO_ROOT` pointing elsewhere (the #132 G
// guidance), cwd ≠ the target repo → gh targets the WRONG repo (false preflight
// readiness, PRs opened against the wrong remote). Fix (tenet 1, reproducibility):
// resolve the owner/repo slug ONCE (resolveRepoSlug) and scope every gh call with
// `-R <owner/repo>`. The slug is also honored via HS_REPO / GH_REPO env overrides.
let RESOLVED_REPO = process.env.HS_REPO || process.env.GH_REPO || null;
export function setResolvedRepo(slug) { RESOLVED_REPO = slug || null; }
export function getResolvedRepo() { return RESOLVED_REPO; }
/** Prepend `-R <owner/repo>` to a gh argv when the repo slug is known. Bare
 *  (back-compat) when it is not — gh then falls back to cwd-based resolution. */
export function ghArgsFor(args, repo = RESOLVED_REPO) {
  return repo ? ['-R', repo, ...args] : args;
}
/** Parse an `owner/repo` slug from a git remote URL (https or ssh, with/without
 *  a trailing `.git`). Returns null when the URL is not a recognizable GitHub
 *  remote. Pure — unit-tested. */
export function parseRepoSlugFromRemote(url) {
  if (typeof url !== 'string') return null;
  const s = url.trim().replace(/\.git$/, '');
  // git@github.com:owner/repo  |  ssh://git@github.com/owner/repo
  let m = s.match(/[:/]([^/:\s]+)\/([^/\s]+)$/);
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}
/** Resolve the build repo's `owner/repo` slug. Prefers gh's own resolution
 *  (honors gh config + GH_REPO), scoped to repoRoot; falls back to parsing the
 *  `origin` remote. Returns null if neither works (caller then uses bare gh).
 *  Never throws. */
export async function resolveRepoSlug(deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  try {
    const viaGh = await exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: repoRoot });
    if (viaGh && viaGh.exitCode === 0) {
      const slug = (viaGh.stdout || '').trim();
      if (/^[^/\s]+\/[^/\s]+$/.test(slug)) return slug;
    }
  } catch { /* gh missing / errored — fall through to git remote */ }
  try {
    const remote = await exec('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot });
    if (remote && remote.exitCode === 0) {
      const slug = parseRepoSlugFromRemote(remote.stdout || '');
      if (slug) return slug;
    }
  } catch { /* no origin remote — give up, use bare gh */ }
  return null;
}

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * @typedef {'pending' | 'in_progress' | 'done' | 'failed' | 'interrupted'} SessionStatus
 * @typedef {{
 *   status: SessionStatus;
 *   prUrl: string | null;
 *   worktreePath: string | null;
 *   branch: string | null;
 *   startedAt: string | null;
 *   completedAt: string | null;
 *   attempt: number;
 *   testExitCode: number | null;
 *   error: string | null;
 * }} SessionState
 * @typedef {{ runId: string; createdAt: string; sessions: Record<string, SessionState> }} RunState
 */

/** @returns {Promise<RunState | null>} */
export async function loadState(statePath = STATE_PATH) {
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.runId === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** @param {RunState} state */
export async function saveState(state, statePath = STATE_PATH) {
  // Per-call unique tmp suffix. Parallel saveState across concurrent sessions
  // (Promise.all over the feature wave) would otherwise race on a single
  // `.tmp` path: A writes, B writes (overwrites), A renames (clears tmp),
  // B renames → ENOENT. Track D Session 2 finding. PID + timestamp +
  // counter is enough — none of these are reused across processes.
  const tmp = `${statePath}.${process.pid}.${Date.now()}.${_saveCounter++}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await renameAtomic(tmp, statePath);
}
let _saveCounter = 0;

/**
 * Cross-platform atomic-ish rename. On POSIX, fs.rename overwrites the
 * destination. On Windows, fs.rename can fail with EPERM/EBUSY/EACCES/EEXIST
 * when the destination exists and any other process (antivirus, indexer, a
 * stale handle from this runner, or a OneDrive/Dropbox/iCloud sync agent) has
 * it briefly open. On those transient codes we unlink the destination and retry
 * with a bounded escalating backoff (#127) — a single immediate retry is not
 * enough when a cloud-sync lock outlives the sub-millisecond rename window. This
 * loses true atomicity in the failure window (gap between unlink and rename),
 * which is acceptable for run-state.json — a partial state file is recoverable
 * by deleting it. Non-transient errors (e.g. ENOENT) propagate immediately, and
 * the retry count is bounded so a permanent lock surfaces rather than hangs.
 *
 * `deps` lets tests inject a rename/unlink/sleep that simulate locks instantly.
 *
 * @param {string} from
 * @param {string} to
 * @param {{
 *   rename?: (from: string, to: string) => Promise<void>,
 *   unlink?: (p: string) => Promise<void>,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [deps]
 */
export async function renameAtomic(from, to, deps = {}) {
  const rename = deps.rename ?? fs.rename.bind(fs);
  const unlink = deps.unlink ?? fs.unlink.bind(fs);
  const sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  // attempt 0 = the initial rename; attempts 1..N = retries after a transient
  // lock, each preceded by a destination unlink + an escalating sleep.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
      // Non-transient error, or out of retries → propagate.
      if (!RENAME_TRANSIENT_CODES.has(code) || attempt >= FS_RETRY_DELAYS_MS.length) throw e;
    }
    // Transient lock: unlink the destination (best-effort — it may not exist),
    // back off, then retry.
    try { await unlink(to); } catch { /* dest may not exist; the next rename surfaces a real error */ }
    await sleep(FS_RETRY_DELAYS_MS[attempt]);
  }
}

export function makeEmptySessionState() {
  return {
    status: /** @type {SessionStatus} */ ('pending'),
    prUrl: null,
    worktreePath: null,
    branch: null,
    startedAt: null,
    completedAt: null,
    attempt: 0,
    testExitCode: null,
    error: null,
    costUsd: /** @type {number | null} */ (null), // B3 (#95)
    // #115: true once the runner has enabled GitHub auto-merge on this
    // session's PR (only for sessions with no manual ACs). Drives the
    // wait-for-merge step before the integration gate / next wave.
    autoMergeEnabled: false,
  };
}

/** @param {string} runId */
export function makeFreshState(runId) {
  return /** @type {RunState} */ ({
    runId,
    createdAt: new Date().toISOString(),
    sessions: {},
    totalCostUsd: 0, // B3 (#95): sum of completed session costs (recomputed on every save)
  });
}

// ─── B3 (#95): cost parsing ───────────────────────────────────────────────────

/**
 * Parse the cost emitted by the `claude` CLI from its stdout/stderr.
 * Robust to format drift — tries multiple patterns, returns `null` on no match,
 * never throws.
 *
 * Known patterns:
 *   "Total cost: $1.42"
 *   "Total cost: 1.42"
 *   "Cost: $0.87"
 *
 * @param {string | null | undefined} stdout
 * @param {string | null | undefined} stderr
 * @returns {number | null}
 */
export function parseClaudeCost(stdout, stderr) {
  try {
    const haystack = `${stdout ?? ''}\n${stderr ?? ''}`;
    // Number sub-pattern allows thousands separators ("$12,345.67"); we strip
    // commas before parseFloat so a separator never truncates the value.
    const NUM = '\\$?([\\d,]+(?:\\.\\d+)?)';
    const toNum = (s) => {
      const n = parseFloat(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    // Primary: "Total cost: $1.42" / "Total cost: 1.42" / "Total cost: $12,345.67"
    const primary = haystack.match(new RegExp(`Total\\s+cost:\\s*${NUM}`, 'i'));
    if (primary) return toNum(primary[1]);
    // Alternate: a bare "Cost: $0.87" with no "Total" prefix.
    const alt = haystack.match(new RegExp(`\\bCost:\\s*${NUM}`, 'i'));
    if (alt) return toNum(alt[1]);
    return null;
  } catch {
    return null;
  }
}

// ─── B1 (#95): claude CLI args resolution ─────────────────────────────────────

/**
 * Resolve the effective claude CLI args for a session spawn.
 *
 * Rule: if the user's `HS_CLAUDE_CLI_ARGS` already contains an explicit
 * `--model`, their choice wins and is left untouched. Otherwise, when the
 * manifest declares an `intendedBuildModel`, append `--model <id>` so the spawn
 * is reproducible regardless of the machine's `ANTHROPIC_MODEL` / settings.json.
 *
 * @param {string[]} baseArgs           Tokenized CLAUDE_CLI_ARGS (already parsed).
 * @param {string | null | undefined} envRawArgs  Raw HS_CLAUDE_CLI_ARGS string (or undefined).
 * @param {string | null | undefined} manifestModel  manifest.intendedBuildModel.
 * @returns {string[]}
 */
export function resolveClaudeArgs(baseArgs, envRawArgs, manifestModel) {
  const hasModelInEnv = /--model\b/.test(envRawArgs || '');
  if (!hasModelInEnv && manifestModel) {
    return [...baseArgs, '--model', manifestModel];
  }
  return [...baseArgs];
}

// ─── gh exponential backoff ──────────────────────────────────────────────────

/**
 * Run a `gh` mutation command with exponential backoff on rate-limit codes.
 * 3 attempts total (initial + 2 retries) at 5s/15s/45s. Retries only on 403/429.
 *
 * The sleeper is injectable for tests; the runner exec is also injectable so
 * we can validate retry behavior without spawning real gh.
 *
 * @param {string[]} args
 * @param {{ sleep?: (ms: number) => Promise<void>, exec?: typeof runProcess, repo?: string|null, repoRoot?: string }} [deps]
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string; attempts: number }>}
 */
export async function ghWithBackoff(args, deps = {}) {
  const sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  const exec = deps.exec ?? runProcess;
  // #136 defect 2: scope to the build repo (`-R <owner/repo>`) and run from
  // repoRoot, so a runner invoked from a different cwd never targets the wrong repo.
  const ghArgs = ghArgsFor(args, deps.repo ?? RESOLVED_REPO);
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  let lastResult = null;
  for (let attempt = 0; attempt < GH_RETRY_DELAYS_MS.length; attempt++) {
    /** @type {{ exitCode: number; stdout: string; stderr: string }} */
    const result = await exec('gh', ghArgs, { cwd: repoRoot });
    lastResult = result;
    if (result.exitCode === 0) {
      return { ...result, attempts: attempt + 1 };
    }
    const code = parseGhHttpCode(result.stderr) ?? parseGhHttpCode(result.stdout);
    if (code === null || !GH_RETRY_CODES.has(code)) {
      return { ...result, attempts: attempt + 1 };
    }
    if (attempt < GH_RETRY_DELAYS_MS.length - 1) {
      await sleep(GH_RETRY_DELAYS_MS[attempt]);
    }
  }
  return { ...lastResult, attempts: GH_RETRY_DELAYS_MS.length };
}

/** Extract HTTP status code from gh stderr/stdout. */
export function parseGhHttpCode(text) {
  if (!text) return null;
  // gh emits things like "HTTP 403:" or "HTTP/2.0 429" or "gh: ... (HTTP 429)"
  const m = text.match(/HTTP[/\d.]*\s+(\d{3})/i) ?? text.match(/\((\d{3})\)/);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Windows binary resolution ───────────────────────────────────────────────

/**
 * On Windows, Node 20+ refuses to `spawn` a `.cmd`/`.bat` file directly with
 * `shell: false` (EINVAL, post CVE-2024-27980). Using `shell: true` works
 * but concatenates args without quoting, which mangles anything with a
 * space (e.g. PR titles, multi-line bodies).
 *
 * The robust pattern is what cross-spawn does: resolve the bare command
 * to its absolute path with extension, and if it's a `.cmd`/`.bat`, wrap
 * with `cmd.exe /d /s /c` and pre-quote each arg per cmd's rules. The
 * result spawns with `shell: false` and arg boundaries are preserved.
 *
 * Cache the `where` lookup per command — `spawnSync` is non-trivial cost.
 *
 * @returns {{ cmd: string; args: string[] }} command + args ready for spawn
 */
const _binResolveCache = new Map();
export function resolveWindowsCommand(cmd, args) {
  // Bare command like `git`/`npm`/`gh`/`claude` — look it up with `where`.
  let resolvedPath = cmd;
  if (!cmd.includes(path.sep) && !cmd.includes('/')) {
    if (_binResolveCache.has(cmd)) {
      resolvedPath = _binResolveCache.get(cmd);
    } else {
      try {
        const r = spawnSync('where.exe', [cmd], { encoding: 'utf-8' });
        if (r.status === 0) {
          const lines = r.stdout.split(/\r?\n/).filter(Boolean);
          // Prefer .exe > .cmd > .bat (real binaries first).
          lines.sort((a, b) => {
            const w = (p) => /\.exe$/i.test(p) ? 0 : /\.cmd$/i.test(p) ? 1 : /\.bat$/i.test(p) ? 2 : 3;
            return w(a) - w(b);
          });
          resolvedPath = lines[0] || cmd;
        }
      } catch { /* fall through with bare cmd */ }
      _binResolveCache.set(cmd, resolvedPath);
    }
  }
  // .cmd/.bat shims need cmd.exe wrap; .exe and friends spawn directly.
  if (/\.(cmd|bat)$/i.test(resolvedPath)) {
    // Port of cross-spawn's escape — see https://github.com/moxystudio/node-cross-spawn
    // - The command path is only caret-escaped (no wrapping quotes) so cmd's
    //   parser treats it as one token; spaces in the path become `^ `.
    // - Each arg is quote-wrapped and then caret-escaped. CRT will dequote
    //   the wrapping `"` back to real argv on the called program's side.
    // - The whole line is wrapped in `"..."` so `cmd /s` strips them and
    //   parses the inner verbatim.
    const line = '"' + [escapeCmdCommand(resolvedPath), ...args.map(escapeCmdArgument)].join(' ') + '"';
    return {
      cmd: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', line],
      // Tell Node to pass these args verbatim to CreateProcess. Without
      // this Node would re-quote the line, breaking cmd's /s outer-strip.
      windowsVerbatimArguments: true,
    };
  }
  return { cmd: resolvedPath, args };
}

const _cmdMetaCharsRe = /([()\][%!^"`<>&|;, ])/g;
/** Cross-spawn escapeCommand — caret-escape metachars, no wrapping. */
export function escapeCmdCommand(cmd) {
  return String(cmd).replace(_cmdMetaCharsRe, '^$1');
}
/** Cross-spawn escapeArgument — CRT-quote then caret-escape metachars. */
export function escapeCmdArgument(arg) {
  let s = `${arg}`;
  s = s.replace(/(\\*)"/g, '$1$1\\"');   // escape embedded " + double preceding backslashes
  s = s.replace(/(\\*)$/, '$1$1');       // double trailing backslashes
  s = `"${s}"`;
  return s.replace(_cmdMetaCharsRe, '^$1');
}

// ─── Process exec helper ─────────────────────────────────────────────────────

/**
 * Spawn a process, capture stdout/stderr, return result. Inherits stdin only.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string, onStdout?: (chunk: string) => void }} [opts]
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string }>}
 */
export function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    // Windows binary resolution — see resolveWindowsCommand for the why.
    // Outside Windows we spawn the command directly with shell:false.
    const resolved = process.platform === 'win32'
      ? resolveWindowsCommand(cmd, args)
      : { cmd, args };
    const child = spawn(resolved.cmd, resolved.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      // #137 Phase 3: `detached` puts the child in its own process group on posix
      // (pgid === pid) so the watchdog can kill the whole tree via process.kill
      // (-pid). No-op semantics we want on win32 (taskkill /T handles the tree).
      detached: opts.detached ?? false,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments ?? false,
    });
    // #137 Phase 3: hand the live child to the caller so a watchdog can target
    // its PID for a stall kill. Best-effort — a throwing hook must not break exec.
    if (opts.onSpawn) { try { opts.onSpawn(child); } catch { /* ignore */ } }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on('error', (err) => {
      resolve({ exitCode: -1, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

// ─── [MANUAL] AC PR body template ────────────────────────────────────────────

/**
 * @param {{ id: string; name?: string; checkpoint: string; manualAcs: { id: string; text: string }[] }} session
 */
export function formatPrBody(session) {
  const lines = [];
  // #126: when the local independent test failed under test-policy=advisory, the
  // PR is opened anyway so CI re-runs the test as the authoritative gate. Mark it
  // loudly at the top so a reviewer never mistakes a red local test for green.
  if (session.testAdvisoryFailure) {
    lines.push(`> ⚠ **Local tests failed — CI is the authoritative gate.**`);
    lines.push(`>`);
    lines.push(
      `> The independent test exited non-zero in the build runner's worktree ` +
      `(\`--test-policy advisory\`). This PR was opened so CI re-runs the test as the ` +
      `authoritative check. Auto-merge stays armed and will merge only when CI is green — ` +
      `a genuinely broken change will not self-merge.`,
    );
    lines.push('');
  }
  lines.push(`## Checkpoint`);
  lines.push('');
  lines.push(session.checkpoint);
  lines.push('');
  if (session.manualAcs && session.manualAcs.length > 0) {
    lines.push(`## Manual sign-off required`);
    lines.push('');
    lines.push('The following acceptance criteria cannot be automatically verified. The reviewer must tick each box before merging.');
    lines.push('');
    for (const ac of session.manualAcs) {
      lines.push(`- [ ] [${ac.id}] ${ac.text}`);
    }
    lines.push('');
  }
  lines.push(`---`);
  lines.push(`Generated by HyperSpeed build runner for session **${session.id}**.`);
  return lines.join('\n');
}

// ─── #136 defect 7: idempotent PR creation (spine owns the PR invariant) ──────
//
// The per-session `claude` agent (spawned `--dangerously-skip-permissions -p`)
// sometimes runs `gh pr create` on its own branch mid-build. When the runner
// then reaches its own PR-create step, GitHub rejects the duplicate ("a pull
// request for branch … already exists") and the session was marked FAILED even
// though the work is done — and the agent's self-opened PR carries the agent's
// body, not the runner's Checkpoint / manual-AC checklist. Per #138 tenets 1 &
// 3, the deterministic spine must be authoritative + idempotent about its own
// invariant: on "already exists", ADOPT the PR and overwrite its body with the
// canonical template, rather than aborting. (The brief also now tells the agent
// the runner owns push/PR — belt-and-suspenders, since agents are nondeterministic.)

/** True when a `gh pr create` failure is the benign "PR already exists for this
 *  branch" case (vs. a real error worth failing the session). */
export function isPrAlreadyExistsError(text) {
  const s = text || '';
  if (/a pull request for branch .* already exists/i.test(s)) return true;
  return /already exists/i.test(s) && /pull request/i.test(s);
}

/** Extract a PR URL from `gh pr view --json url` output (JSON, with a regex
 *  fallback for older/non-JSON output). Returns null when none is present. */
export function extractPrUrl(stdout) {
  const s = stdout || '';
  try {
    const j = JSON.parse(s);
    if (j && typeof j.url === 'string') return j.url;
  } catch { /* not JSON — fall through to regex */ }
  const m = s.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

/**
 * Create the session PR, or adopt a pre-existing one (idempotent). Returns
 * `{ ok, prUrl, adopted }` on success (prUrl may be null if an adopted PR's URL
 * could not be read) or `{ ok:false, error }` on a genuine failure. Never throws.
 *
 * @returns {Promise<{ ok: boolean; prUrl?: string|null; adopted?: boolean; error?: string }>}
 */
export async function createOrAdoptPr(deps) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? (() => {});
  const repo = deps.repo ?? RESOLVED_REPO;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const base = deps.base ?? 'main';
  const { branch, title, bodyFile } = deps;

  const create = await ghWithBackoff(
    ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body-file', bodyFile],
    { exec, repo, repoRoot },
  );
  if (create.exitCode === 0) {
    return { ok: true, prUrl: extractPrUrl(create.stdout), adopted: false };
  }
  if (isPrAlreadyExistsError(create.stderr) || isPrAlreadyExistsError(create.stdout)) {
    // Adopt: look up the existing PR and rewrite its body to the canonical
    // runner template so the Checkpoint / manual-AC checklist is authoritative.
    const view = await exec('gh', ghArgsFor(['pr', 'view', branch, '--json', 'url'], repo), { cwd: repoRoot });
    const prUrl = view.exitCode === 0 ? extractPrUrl(view.stdout) : null;
    const target = prUrl ?? branch;
    const edit = await ghWithBackoff(['pr', 'edit', target, '--body-file', bodyFile], { exec, repo, repoRoot });
    if (edit.exitCode !== 0) {
      log(`    ⚠ adopted pre-existing PR for ${branch} but could not overwrite its body (${tailLines(edit.stderr, 2)}) — the runner's Checkpoint / manual-AC checklist may be missing on the PR`);
    } else {
      log(`    ↻ adopted pre-existing PR for ${branch} (agent self-opened it) and rewrote its body to the runner template`);
    }
    return { ok: true, prUrl, adopted: true };
  }
  return { ok: false, error: `gh pr create failed after ${create.attempts} attempt(s): ${tailLines(create.stderr, 10)}` };
}

// ─── Failure report ──────────────────────────────────────────────────────────

/**
 * @param {{ wave: { kind: string; phase: number | string }; failures: Array<{ sessionId: string; state: SessionState; stdoutTail: string }> }} input
 */
export function formatFailureReport(input) {
  return {
    wave: input.wave,
    generatedAt: new Date().toISOString(),
    failures: input.failures.map(f => ({
      sessionId: f.sessionId,
      status: f.state.status,
      prUrl: f.state.prUrl,
      testExitCode: f.state.testExitCode,
      worktreePath: f.state.worktreePath,
      error: f.state.error,
      stdoutTail: f.stdoutTail,
    })),
  };
}

export function tailLines(text, n = STDOUT_TAIL_LINES) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

/**
 * Format an elapsed millisecond count as `<M>m<S>s` for the failure line.
 * @param {number} ms
 */
export function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s}s`;
}

// ─── A1 (#85): host-binary detection & worktree bootstrap ────────────────────

/**
 * Default install hints for host binaries we ship the runner with. Plans MAY
 * add manifest-side hints later (#86 expands this); for now we keep a small
 * map so the halt message is actionable for common tools.
 */
const HOST_BIN_HINTS = {
  git:     'https://git-scm.com/downloads',
  gh:      'https://cli.github.com/manual/installation',
  claude:  'https://docs.claude.com/en/docs/claude-code/overview',
  node:    'https://nodejs.org/en/download',
  npm:     'bundled with Node.js — https://nodejs.org/en/download',
  python:  'https://www.python.org/downloads/',
  python3: 'https://www.python.org/downloads/',
  poetry:  'https://python-poetry.org/docs/#installation',
  uv:      'https://docs.astral.sh/uv/getting-started/installation/',
  pnpm:    'https://pnpm.io/installation',
  yarn:    'https://classic.yarnpkg.com/en/docs/install',
  docker:  'https://docs.docker.com/get-docker/',
  go:      'https://go.dev/doc/install',
  cargo:   'https://www.rust-lang.org/tools/install',
  rustc:   'https://www.rust-lang.org/tools/install',
  ruby:    'https://www.ruby-lang.org/en/documentation/installation/',
  bundle:  'bundled with Ruby — https://www.ruby-lang.org/en/documentation/installation/',
};

/**
 * Probe PATH for a binary. Uses `where.exe` on Windows, `command -v` elsewhere.
 * Returns true iff the binary resolves to an existing path.
 *
 * @param {string} name
 * @param {(cmd: string, args: string[]) => Promise<{exitCode: number; stdout: string; stderr: string}>} [exec]
 */
export async function isBinaryOnPath(name, exec = runProcess) {
  if (!name || typeof name !== 'string') return false;
  if (process.platform === 'win32') {
    const r = await exec('where.exe', [name]);
    return r.exitCode === 0 && r.stdout.trim().length > 0;
  }
  const r = await exec('sh', ['-c', `command -v ${JSON.stringify(name)}`]);
  return r.exitCode === 0 && r.stdout.trim().length > 0;
}

/**
 * Check every entry in `requirements.hostBinaries[]` is present on PATH.
 * NEVER installs. On any miss, returns `{ ok: false, missing: [...] }` with
 * one line per missing binary, including an install hint.
 *
 * @param {{ hostBinaries?: string[] }} requirements
 * @param {{ exec?: typeof runProcess }} [deps]
 */
export async function checkHostBinaries(requirements, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const bins = requirements?.hostBinaries ?? [];
  const missing = [];
  for (const bin of bins) {
    const present = await isBinaryOnPath(bin, exec);
    if (!present) {
      const hint = HOST_BIN_HINTS[bin.toLowerCase()] ?? 'install from its official source';
      missing.push(`${bin} — install from ${hint}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

// ─── A2 (#86): runtime version check ─────────────────────────────────────────

/**
 * Probe a runtime's `--version` output and compare against the declared spec.
 *
 * v1 limitation: this is NOT a real semver comparator. The declared spec is
 * read as `major[.minor]` and compared as floor (>= major; if minor declared,
 * exact-major and >= minor). Range syntax like `^20`, `>=3.11`, or `~1.2.3`
 * is not supported — projects should declare a plain number string. Upgrade
 * to a real semver lib if richer ranges are needed.
 *
 * @param {{ name: string, version: string }} runtime
 * @param {typeof runProcess} [exec]
 * @returns {Promise<{ ok: boolean, actual: string | null, message: string }>}
 */
export async function checkRuntimeVersion(runtime, exec = runProcess) {
  const name = runtime?.name;
  const expected = runtime?.version;
  if (!name || !expected) {
    return { ok: false, actual: null, message: `Runtime entry malformed: ${JSON.stringify(runtime)}` };
  }
  // Python's `python --version` historically wrote to stderr on Python 2;
  // every other common runtime writes to stdout. We concat both to be robust.
  const res = await exec(name, ['--version']);
  if (res.exitCode !== 0) {
    const hint = HOST_BIN_HINTS[name.toLowerCase()] ?? 'install from its official source';
    return {
      ok: false,
      actual: null,
      message: `Runtime ${name} not on PATH or \`${name} --version\` failed — install ${name} ${expected} (${hint})`,
    };
  }
  const text = `${res.stdout}\n${res.stderr}`.trim();
  const m = text.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) {
    return {
      ok: false,
      actual: null,
      message: `Runtime ${name}: could not parse version from "${text.slice(0, 80)}"`,
    };
  }
  const actualMajor = parseInt(m[1], 10);
  const actualMinor = parseInt(m[2], 10);
  const actual = `${m[1]}.${m[2]}${m[3] ? '.' + m[3] : ''}`;
  const expM = expected.match(/(\d+)(?:\.(\d+))?/);
  if (!expM) {
    return { ok: false, actual, message: `Runtime ${name}: declared version "${expected}" unparseable` };
  }
  const expMajor = parseInt(expM[1], 10);
  const expMinor = expM[2] !== undefined ? parseInt(expM[2], 10) : null;
  if (actualMajor < expMajor || (actualMajor === expMajor && expMinor !== null && actualMinor < expMinor)) {
    return {
      ok: false,
      actual,
      message: `Runtime ${name} ${actual} does not satisfy declared ${expected} — upgrade ${name} to ${expected}+`,
    };
  }
  return { ok: true, actual, message: `Runtime ${name} ${actual} satisfies declared ${expected}` };
}

// ─── C1-4 (#99): integration-cmd binary classification ───────────────────────

/**
 * Classify `manifest.integrationCmd` for the preflight binary probe.
 *
 * Returns an action + (when `action === 'check'`) the leading binary to probe
 * on PATH. Skips the check for the empty string, inline shell scripts
 * (`bash -c …`), and path-style commands (`./scripts/integration.sh`). Defers
 * to the existing runtime check for the npm family (`npm`/`yarn`/`pnpm`/`npx`)
 * so node-based integration commands are not double-reported.
 *
 * Pure — exported for unit testing.
 *
 * @param {string | null | undefined} integrationCmd
 * @returns {{ action: 'check' | 'skip-empty' | 'skip-inline' | 'skip-path' | 'defer-runtime', binary: string | null }}
 */
export function classifyIntegrationCmd(integrationCmd) {
  if (!integrationCmd || !integrationCmd.trim()) {
    return { action: 'skip-empty', binary: null };
  }
  const tokens = parseShellCmd(integrationCmd.trim());
  const lead = tokens[0] ?? '';
  if (!lead) return { action: 'skip-empty', binary: null };
  // Inline shell script: `bash -c "..."`, `sh -c "..."`, etc.
  if (/^(bash|sh|zsh|cmd|powershell|pwsh)$/i.test(lead) && tokens.includes('-c')) {
    return { action: 'skip-inline', binary: null };
  }
  // Path-style command — file existence is a separate concern.
  if (lead.includes('/') || lead.includes('\\') || lead.startsWith('.')) {
    return { action: 'skip-path', binary: null };
  }
  // npm family is already covered by the node runtime check.
  if (/^(npm|yarn|pnpm|npx)$/i.test(lead)) {
    return { action: 'defer-runtime', binary: lead };
  }
  return { action: 'check', binary: lead };
}

// ─── C1-5 (#99): Phase 0 harness structural re-check ─────────────────────────

const PROJECT_MANIFEST_RE = /(^|[\\/])(package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|Gemfile)$/i;
const INTEGRATION_DIR_RE = /tests[\\/]integration/i;

/**
 * Structural sanity re-check of a loaded manifest's Phase 0 harness. The
 * generator already runs validatePhaseZeroHarness, but a hand-edited or
 * partially-regenerated-and-merged manifest can drift; this is the user-facing
 * safety net. Three sub-checks:
 *   1. Exactly one Phase 0 session owns a project manifest (package.json/etc).
 *   2. At least one Phase 0 session owns a tests/integration-style path.
 *   3. manifest.integrationCmd is non-empty.
 *
 * Returns `{ applicable, checks }`. `applicable` is false when the manifest has
 * no feature waves at all (degenerate/preview manifest) — the caller skips
 * emitting lines in that case. Pure — exported for unit testing.
 *
 * @param {object} manifest
 * @returns {{ applicable: boolean, checks: Array<{ pass: boolean, message: string }> }}
 */
export function checkPhaseZeroHarness(manifest) {
  const featureWaves = (manifest?.waves ?? []).filter(w => w && w.kind === 'feature');
  if (featureWaves.length === 0) {
    return { applicable: false, checks: [] };
  }
  const phaseZero = featureWaves
    .filter(w => w.phase === 0)
    .flatMap(w => w.sessions ?? []);

  const checks = [];

  // 1) exactly one Phase 0 session owns a project manifest
  const manifestOwners = phaseZero.filter(s =>
    (s.ownedFiles ?? []).some(f => PROJECT_MANIFEST_RE.test(String(f).trim())));
  if (manifestOwners.length === 1) {
    checks.push({ pass: true, message: `Phase 0 integration-harness session owns the project manifest (${manifestOwners[0].id})` });
  } else if (manifestOwners.length === 0) {
    checks.push({ pass: false, message: `Phase 0 has no integration-harness session — no Phase 0 session owns a project manifest (package.json/pyproject.toml/go.mod/Cargo.toml/Gemfile)` });
  } else {
    checks.push({ pass: false, message: `Phase 0 has ${manifestOwners.length} sessions owning a project manifest (${manifestOwners.map(s => s.id).join(', ')}) — exactly one must` });
  }

  // 2) at least one Phase 0 session owns a tests/integration-style path
  const harnessOwners = phaseZero.filter(s =>
    (s.ownedFiles ?? []).some(f => INTEGRATION_DIR_RE.test(String(f).trim())));
  if (harnessOwners.length >= 1) {
    checks.push({ pass: true, message: `Phase 0 owns an integration test directory (${harnessOwners.map(s => s.id).join(', ')})` });
  } else {
    checks.push({ pass: false, message: `Phase 0 owns no tests/integration-style path — the integration harness is missing` });
  }

  // 3) integrationCmd non-empty
  if (manifest.integrationCmd && String(manifest.integrationCmd).trim()) {
    checks.push({ pass: true, message: `manifest.integrationCmd is set ("${manifest.integrationCmd}")` });
  } else {
    checks.push({ pass: false, message: `manifest.integrationCmd is empty — the wave-boundary gate has no command to run` });
  }

  return { applicable: true, checks };
}

// ─── #109: Greenfield base-branch seeding ────────────────────────────────────

/**
 * Resolve the repo-relative path of the project manifest a Phase 0 session owns.
 * Prefers the stub's declared path; falls back to scanning feature-wave sessions'
 * ownedFiles for a project-manifest basename. Returns null if none is owned.
 */
export function findOwnedManifestPath(manifest) {
  if (manifest?.projectManifestStub?.path) return manifest.projectManifestStub.path;
  for (const w of manifest?.waves ?? []) {
    if (w.kind !== 'feature') continue;
    for (const s of w.sessions ?? []) {
      for (const f of s.ownedFiles ?? []) {
        if (PROJECT_MANIFEST_RE.test(String(f).trim())) return String(f).trim();
      }
    }
  }
  return null;
}

/**
 * Detect whether the base branch is missing the owned project manifest — the
 * greenfield chicken-and-egg of #109. Uses `git cat-file -e <base>:<path>` so it
 * works without a checkout/worktree.
 *
 * Returns one of:
 *   - { state: 'not-applicable' }          — no project manifest is owned
 *   - { state: 'seeded', manifestPath }    — manifest already present on base
 *   - { state: 'needs-seed', manifestPath, hasStub } — greenfield; must seed
 */
export async function detectGreenfield(manifest, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const baseBranch = deps.baseBranch ?? process.env.HS_BASE_BRANCH ?? 'main';
  const manifestPath = findOwnedManifestPath(manifest);
  if (!manifestPath) return { state: 'not-applicable' };

  const present = await exec('git', ['cat-file', '-e', `${baseBranch}:${manifestPath}`], { cwd: repoRoot });
  if (present.exitCode === 0) {
    return { state: 'seeded', manifestPath };
  }
  return { state: 'needs-seed', manifestPath, hasStub: !!manifest?.projectManifestStub };
}

/**
 * #136 defect 3: the canonical base `.gitignore` seeded onto a greenfield base
 * branch. Without it, the per-session `git add -A` auto-commit swallows the
 * whole `node_modules` tree (observed: 33k+ files) into the PR — bloating it and
 * (before the in-loop compat lint was deleted) crashing the wave via a Windows
 * `ENAMETOOLONG` argv overflow. Negates committed `*.example/*.sample/*.template`
 * files so a project's `.env.example` (often under test) is NOT ignored.
 */
export function renderBaseGitignore() {
  return [
    `# Seeded by HyperSpeed --seed-base (#136 defect 3) — keep build artifacts and`,
    `# secrets out of session commits. Committed example templates are negated below.`,
    ``,
    `# Node`,
    `node_modules/`,
    `dist/`,
    `build/`,
    `.next/`,
    `coverage/`,
    ``,
    `# Python`,
    `.venv/`,
    `__pycache__/`,
    `*.py[cod]`,
    `*.egg-info/`,
    ``,
    `# Environment (never commit real secrets; DO commit the example templates)`,
    `.env`,
    `.env.*`,
    `!.env.example`,
    `!.env.sample`,
    `!.env.template`,
    ``,
    `# HyperSpeed runner artifacts`,
    `.bp-worktrees/`,
    `run-state.json`,
    `wave-*-failure-report.json`,
    `.bp-services.compose.yml`,
    ``,
  ].join('\n');
}

/**
 * Seed a complete project manifest + lockfile onto the base branch so every
 * greenfield Wave 0 worktree can install before its session runs (#109).
 *
 * Steps (all on the base branch in the repo root — no worktree):
 *   1. refuse if the manifest already exists on base (idempotent / non-destructive)
 *   2. write the stub manifest to its path
 *   2b. seed a base `.gitignore` if absent (#136 defect 3 — keep node_modules /
 *      secrets out of every session's auto-commit; never clobber an existing one)
 *   3. run the stub's seedInstallCmd to resolve deps and produce the lockfile
 *   4. `git add` the manifest + lockfile (+ .gitignore), commit, and push to origin
 *
 * Returns { ok, lines } — never throws for an expected condition; lines are
 * printed by the caller.
 */
export async function seedBase(manifest, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const baseBranch = deps.baseBranch ?? process.env.HS_BASE_BRANCH ?? 'main';
  const scriptDir = deps.scriptDir ?? SCRIPT_DIR;
  const writeFile = deps.writeFile ?? ((p, c) => fs.writeFile(p, c, 'utf-8'));
  const readFile = deps.readFile ?? ((p) => fs.readFile(p, 'utf-8'));
  const push = deps.push ?? true;
  const lines = [];
  const log = (m) => lines.push(m);

  const stub = manifest?.projectManifestStub;
  if (!stub) {
    log(`✗ --seed-base: this plan has no projectManifestStub (run-manifest.json). Nothing to seed — regenerate the build plan, or commit a manifest manually.`);
    return { ok: false, lines };
  }

  // Must be on the base branch so the commit lands where Wave 0 worktrees branch from.
  const branchRes = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
  const currentBranch = branchRes.stdout.trim();
  if (branchRes.exitCode !== 0) {
    log(`✗ --seed-base: ${repoRoot} is not a git repo with a checked-out branch.`);
    return { ok: false, lines };
  }
  if (currentBranch !== baseBranch) {
    log(`✗ --seed-base: current branch is "${currentBranch}", expected base "${baseBranch}". Checkout ${baseBranch} (or set HS_BASE_BRANCH) and retry.`);
    return { ok: false, lines };
  }

  // Idempotent: never overwrite an existing committed manifest.
  const present = await exec('git', ['cat-file', '-e', `${baseBranch}:${stub.path}`], { cwd: repoRoot });
  if (present.exitCode === 0) {
    log(`✓ --seed-base: ${stub.path} already exists on ${baseBranch} — nothing to seed.`);
    return { ok: true, lines };
  }

  // 1) Write the stub manifest. Prefer the on-disk bootstrap/ copy (identical
  //    content) so a hand-edited stub is honoured; fall back to manifest content.
  const target = path.join(repoRoot, stub.path);
  await fs.mkdir(path.dirname(target), { recursive: true }).catch(() => {});
  let content = stub.content;
  try {
    const onDisk = await readFile(path.join(scriptDir, 'bootstrap', stub.path));
    if (onDisk && onDisk.trim()) content = onDisk;
  } catch { /* use manifest content */ }
  await writeFile(target, content);
  log(`→ Wrote ${stub.path} (${stub.dependencyCount} deps)`);

  // 2b) Seed a base .gitignore if the repo has none (#136 defect 3). Idempotent
  //     and non-destructive: an existing .gitignore is left untouched so we never
  //     clobber a project's own rules. Written before the install so node_modules
  //     never becomes a candidate for the per-session auto-commit.
  let seededGitignore = false;
  const gitignorePath = path.join(repoRoot, '.gitignore');
  let existingGitignore = '';
  try { existingGitignore = await readFile(gitignorePath); } catch { /* none */ }
  if (!existingGitignore || !existingGitignore.trim()) {
    await writeFile(gitignorePath, renderBaseGitignore());
    seededGitignore = true;
    log(`→ Wrote .gitignore (node_modules / secrets excluded; .env.example negated)`);
  } else {
    log(`→ .gitignore already present — leaving it untouched`);
  }

  // 2) Resolve dependencies → lockfile.
  if (stub.seedInstallCmd && stub.seedInstallCmd.trim()) {
    const [cmd, ...cmdArgs] = parseShellCmd(stub.seedInstallCmd);
    log(`→ Running "${stub.seedInstallCmd}" to resolve dependencies and write the lockfile...`);
    const installRes = await exec(cmd, cmdArgs, { cwd: repoRoot });
    if (installRes.exitCode !== 0) {
      log(`✗ --seed-base: "${stub.seedInstallCmd}" exited ${installRes.exitCode} — ${tailLines(installRes.stderr || installRes.stdout, 15)}`);
      return { ok: false, lines };
    }
  } else {
    log(`→ No seedInstallCmd declared — committing the manifest without a lockfile.`);
  }

  // 3) Stage manifest + lockfile (+ seeded .gitignore), commit, push.
  const toAdd = [stub.path];
  if (stub.lockfile) toAdd.push(stub.lockfile);
  if (seededGitignore) toAdd.push('.gitignore');
  const addRes = await exec('git', ['add', '-f', ...toAdd], { cwd: repoRoot });
  if (addRes.exitCode !== 0) {
    log(`✗ --seed-base: \`git add\` failed — ${tailLines(addRes.stderr, 10)}`);
    return { ok: false, lines };
  }
  const commitRes = await exec('git', ['commit', '-m', `chore: seed project manifest for greenfield build plan (#109)`], { cwd: repoRoot });
  if (commitRes.exitCode !== 0) {
    log(`✗ --seed-base: \`git commit\` failed — ${tailLines(commitRes.stderr || commitRes.stdout, 10)}`);
    return { ok: false, lines };
  }
  log(`✓ Committed ${toAdd.join(' + ')} to ${baseBranch}`);

  if (push) {
    const pushRes = await exec('git', ['push', 'origin', baseBranch], { cwd: repoRoot });
    if (pushRes.exitCode !== 0) {
      log(`⚠ --seed-base: committed locally but \`git push\` failed — ${tailLines(pushRes.stderr, 10)}`);
      log(`  Push ${baseBranch} manually before running Wave 0 (worktrees branch off the remote base).`);
      return { ok: false, lines };
    }
    log(`✓ Pushed ${baseBranch} to origin — base branch is seeded. You can now run \`--check-env\` then \`--wave 0\`.`);
  }
  return { ok: true, lines };
}

// ─── #127 Slice A: cloud-sync path detection ─────────────────────────────────

/**
 * Detect whether an absolute path sits inside a known cloud-sync folder
 * (OneDrive / Dropbox / iCloud / Google Drive). Pure + segment-based: matches a
 * path *segment* equal to (or, for OneDrive Business, starting with) the
 * provider marker, so an unrelated folder like `MyOneDriveBackup` is not a false
 * positive. Cloud sync agents lock files mid-build (npm install, git worktree
 * remove, run-state.json writes) and were a repeated cause of wave-0 hangs and
 * mid-flight crashes (#102 field feedback). We warn loudly in preflight; we do
 * not refuse to run (legitimate setups live in synced folders).
 *
 * @param {string} absPath
 * @returns {{ provider: 'OneDrive' | 'Dropbox' | 'iCloud' | 'Google Drive' } | null}
 */
export function detectCloudSyncPath(absPath) {
  const segments = String(absPath ?? '').split(/[\\/]+/).filter(Boolean);
  for (const seg of segments) {
    // OneDrive personal (`OneDrive`) or business (`OneDrive - Contoso`).
    if (/^OneDrive($|[ -])/i.test(seg)) return { provider: 'OneDrive' };
    if (/^Dropbox$/i.test(seg)) return { provider: 'Dropbox' };
    if (/^iCloud Drive$/i.test(seg) || seg === 'com~apple~CloudDocs') return { provider: 'iCloud' };
    if (/^Google ?Drive$/i.test(seg) || /^My Drive$/i.test(seg)) return { provider: 'Google Drive' };
  }
  return null;
}

// ─── A2 (#86): preflight environment check ───────────────────────────────────

/**
 * Run every prerequisite check declared in the issue and return a pass/fail
 * line per check. Backs BOTH the `--check-env` subcommand and the
 * auto-invocation at the start of `main()`. Pure-ish — only side effect is
 * shelling out via `deps.exec`. Never creates a worktree, never touches state.
 *
 * @param {object} manifest                       — parsed run-manifest.json
 * @param {{
 *   exec?: typeof runProcess,
 *   repoRoot?: string,
 *   baseBranch?: string,
 *   scriptDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   access?: (p: string) => Promise<unknown>,
 * }} [deps]
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
/**
 * #132 F — pure verdict for the preflight auto-merge readiness line. The
 * unattended self-merge path (#115) needs BOTH "Allow auto-merge" enabled AND a
 * plan/visibility that permits required-status-check branch protection. On a
 * PRIVATE repo under the Free plan neither auto-merge nor branch protection can
 * be turned on — so when auto-merge reads OFF on a private repo, say *why* and
 * what to do, instead of the generic "flip the toggle" hint (which won't work).
 *
 * @param {{ allowAutoMerge: boolean, visibility: string, autoMergeableCount: number }} input
 * @returns {{ level: 'pass' | 'info', message: string }}
 */
export function describeAutoMergeReadiness({ allowAutoMerge, visibility, autoMergeableCount }) {
  const n = autoMergeableCount;
  if (allowAutoMerge) {
    return { level: 'pass', message: `Repo allows auto-merge (${n} session(s) will self-merge on green CI)` };
  }
  if ((visibility || '').toLowerCase() === 'private') {
    return {
      level: 'info',
      message:
        `"Allow auto-merge" is OFF and this repo is PRIVATE — ${n} no-manual-AC PR(s) will stay open. ` +
        `Note: on the GitHub Free plan a private repo can enable NEITHER auto-merge NOR required-status-check ` +
        `branch protection. For the unattended self-merge path (#115), make the repo public ` +
        `(gh repo edit --visibility public) or upgrade to a paid plan (Pro/Team) — otherwise run supervised and merge by hand.`,
    };
  }
  return {
    level: 'info',
    message:
      `"Allow auto-merge" is OFF for this repo — ${n} no-manual-AC PR(s) will stay open. ` +
      `Enable it in Settings → General → "Allow auto-merge" for unattended runs.`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// #137 — host-environment / runtime-isolation hardening
//
// Framed by #138: the deterministic spine owns invariants and must MAKE PROGRESS
// (tenet 1), and the agent is the exception handler at the halt boundary (tenet
// 3). The helpers below are all PURE (or take injected exec/stat/now/kill) so the
// preflight, fixture-lifecycle, and watchdog logic is unit-testable without a
// real host. They extend the existing #127/#132 machinery (detectCloudSyncPath,
// startFixtureServices, the FS-retry helpers, startHeartbeat) — never duplicate it.
// ════════════════════════════════════════════════════════════════════════════

// ─── #137 service connection contract (env-contract gap, Wave-1 canary) ───────
//
// The runner brings declared `requirements.services` up (#132-B) and CI renders
// them as `services:`, but NOTHING exported their connection strings into the
// test process. Service-dependent code that read `process.env.DATABASE_URL`
// without a fallback connected with `connectionString: undefined` → pg's
// `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` (10 tests
// in the canary). The contract must be PROVIDED by the spine, not left to each
// code path. `deriveServiceConnectionEnv` is the single source of truth, used by
// both the runner (process.env injection) and the CI workflow (job-level env:).

/** Classify a docker image into a known service family, or null. Mirrors the
 *  image-family detection in composeHealthcheckTest / nativeHealthCmd. */
export function serviceKind(image) {
  const i = String(image ?? '').toLowerCase();
  if (i.startsWith('postgres')) return 'postgres';
  if (i.startsWith('redis')) return 'redis';
  if (i.startsWith('mysql') || i.startsWith('mariadb')) return 'mysql';
  if (i.startsWith('mongo')) return 'mongo';
  return null;
}

/** Extract the published HOST port from a docker port mapping. Handles the three
 *  compose/`-p` forms: `"5432"`, `"5432:5432"`, `"127.0.0.1:5432:5432"`. The host
 *  port is the segment mapped to the container (the second-to-last when an IP is
 *  present, the first of a `HOST:CONTAINER` pair, or the bare value). Returns a
 *  number, or null when unparseable. Pure. */
export function parseHostPort(mapping) {
  if (mapping === undefined || mapping === null) return null;
  const parts = String(mapping).split(':').map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length === 0) return null;
  // `HOST:CONTAINER` or `IP:HOST:CONTAINER` → host port is parts[length-2];
  // a bare `PORT` → parts[0].
  const raw = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Derive the connection-env contract a service-dependent test process needs from
 * the declared `requirements.services[]`. The spine provides this so code-under-
 * test never depends on whether its author happened to hardcode a fallback URL.
 *
 * Precedence per service: an explicit `connectionEnv` map on the service wins
 * verbatim; otherwise standard vars are derived from the image family + the
 * container env (`POSTGRES_USER`/`POSTGRES_PASSWORD`/…) + the published host port.
 * Across services the FIRST writer of a shared key (e.g. `DATABASE_URL`) wins, so
 * a primary store declared first is authoritative. Pure + deterministic.
 *
 * @param {Array<{ image: string, env?: Record<string,string>, ports?: string[], connectionEnv?: Record<string,string> }>} services
 * @returns {Record<string,string>}
 */
export function deriveServiceConnectionEnv(services) {
  /** @type {Record<string,string>} */
  const out = {};
  const set = (k, v) => { if (out[k] === undefined) out[k] = v; };
  for (const svc of services ?? []) {
    if (svc && svc.connectionEnv && typeof svc.connectionEnv === 'object') {
      for (const [k, v] of Object.entries(svc.connectionEnv)) set(k, String(v));
      continue;
    }
    const kind = serviceKind(svc?.image);
    const e = svc?.env ?? {};
    const port = parseHostPort((svc?.ports ?? [])[0]);
    if (kind === 'postgres') {
      const user = e.POSTGRES_USER ?? 'postgres';
      const pass = e.POSTGRES_PASSWORD ?? 'postgres';
      const db = e.POSTGRES_DB ?? user;
      const p = port ?? 5432;
      const url = `postgresql://${user}:${pass}@localhost:${p}/${db}`;
      set('DATABASE_URL', url); set('POSTGRES_URL', url);
      set('PGHOST', 'localhost'); set('PGPORT', String(p));
      set('PGUSER', user); set('PGPASSWORD', pass); set('PGDATABASE', db);
    } else if (kind === 'redis') {
      const p = port ?? 6379;
      const pass = e.REDIS_PASSWORD;
      const url = pass ? `redis://:${pass}@localhost:${p}` : `redis://localhost:${p}`;
      set('REDIS_URL', url);
    } else if (kind === 'mysql') {
      const p = port ?? 3306;
      const user = e.MYSQL_USER ?? 'root';
      const pass = e.MYSQL_USER ? (e.MYSQL_PASSWORD ?? '') : (e.MYSQL_ROOT_PASSWORD ?? '');
      const db = e.MYSQL_DATABASE ?? '';
      const url = `mysql://${user}:${pass}@localhost:${p}/${db}`;
      set('DATABASE_URL', url); set('MYSQL_URL', url);
    } else if (kind === 'mongo') {
      const p = port ?? 27017;
      const url = `mongodb://localhost:${p}`;
      set('DATABASE_URL', url); set('MONGO_URL', url); set('MONGODB_URI', url);
    }
  }
  return out;
}

/**
 * Apply the derived connection env onto `env` (default process.env), NON-
 * clobbering (`??=` semantics) so an operator who exported their own
 * DATABASE_URL/REDIS_URL — or a different-port stack — is never overwritten.
 * Returns the keys actually set, for logging. The spine calls this once when
 * services are declared (whether the runner started them or HS_SKIP_FIXTURE_
 * SERVICES delegated to an operator stack) so the env contract holds at test time.
 *
 * @returns {{ applied: string[] }}
 */
export function applyServiceConnectionEnv(services, env = process.env) {
  const derived = deriveServiceConnectionEnv(services);
  const applied = [];
  for (const [k, v] of Object.entries(derived)) {
    if (env[k] === undefined || env[k] === '') { env[k] = v; applied.push(k); }
  }
  return { applied };
}

// ─── #137 Phase 1: fixture port / leftover-container preflight ────────────────

/** Every declared service's host port, paired with its service name + image.
 *  Skips services with no published port. Pure. */
export function collectServicePorts(services) {
  const out = [];
  for (const svc of services ?? []) {
    for (const mapping of (svc?.ports ?? [])) {
      const port = parseHostPort(mapping);
      if (port !== null) out.push({ port, name: svc?.name ?? '(unnamed)', image: svc?.image ?? '' });
    }
  }
  return out;
}

/** Find the docker container (if any) publishing `port`, from the tab-separated
 *  output of `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'`. Returns
 *  `{ name, image }` or null. Pure — the host-side parser for checkPortConflicts. */
export function findContainerPublishingPort(psStdout, port) {
  const re = new RegExp(`(^|[^0-9])${port}->`); // matches `0.0.0.0:5432->5432/tcp`, `:::5432->…`
  for (const line of String(psStdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, image, ports] = line.split('\t');
    if (ports && re.test(ports)) return { name: (name ?? '').trim(), image: (image ?? '').trim() };
  }
  return null;
}

/** Parse the listening PID holding `port` from `netstat -ano` (win32) or
 *  `lsof -nP -iTCP -sTCP:LISTEN` / `ss -ltnp` (posix) output. Returns the first
 *  PID string found, or null. Pure — tolerant of all three formats. */
export function parseListeningPid(stdout, port, platform = process.platform) {
  const text = String(stdout ?? '');
  if (platform === 'win32') {
    // `  TCP    0.0.0.0:5432   0.0.0.0:0   LISTENING   1234`
    for (const line of text.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      if (!new RegExp(`[:.]${port}\\b`).test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const pid = cols[cols.length - 1];
      if (/^\d+$/.test(pid)) return pid;
    }
    return null;
  }
  // lsof: `postgres 1234 user ... TCP *:5432 (LISTEN)`  → PID is column 2.
  // ss:   `LISTEN 0 244 *:5432 *:* users:(("postgres",pid=1234,fd=7))`.
  for (const line of text.split(/\r?\n/)) {
    if (!new RegExp(`[:.]${port}\\b`).test(line)) continue;
    // ss carries an explicit `pid=`; prefer it (its column 2 is Recv-Q, a red
    // herring for the lsof heuristic below).
    const m = line.match(/pid=(\d+)/);
    if (m) return m[1];
    const lsof = line.trim().split(/\s+/);
    if (/^\d+$/.test(lsof[1] ?? '')) return lsof[1];
  }
  return null;
}

/**
 * Check whether any declared service's host port is already bound. Distinguishes
 * a RECOVERABLE conflict (a leftover `bp-fixtures*` container the fixture
 * lifecycle will auto-reconcile at bring-up → warn) from an UNRECOVERABLE one (a
 * foreign container or a non-docker process the runner cannot clean → fail).
 *
 * @returns {Promise<{ conflicts: Array<{ port:number, name:string, holder:string, recoverable:boolean }> }>}
 */
export async function checkPortConflicts(services, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const platform = deps.platform ?? process.platform;
  const ports = collectServicePorts(services);
  const conflicts = [];
  if (ports.length === 0) return { conflicts };
  // One `docker ps` for all ports (cheap; tolerate docker absent/daemon-down).
  let psOut = '';
  try {
    if (await isBinaryOnPath('docker', exec)) {
      const ps = await exec('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}']);
      if (ps.exitCode === 0) psOut = ps.stdout || '';
    }
  } catch { /* docker probe best-effort */ }
  for (const { port, name } of ports) {
    const container = findContainerPublishingPort(psOut, port);
    if (container) {
      const recoverable = /^bp-fixtures/.test(container.name);
      conflicts.push({
        port, name,
        holder: `container ${container.name} (${container.image})`,
        recoverable,
      });
      continue;
    }
    // No docker container — probe the OS for a listening process.
    let pid = null;
    try {
      const probe = platform === 'win32'
        ? await exec('netstat', ['-ano', '-p', 'tcp'])
        : await exec('sh', ['-c', `lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || ss -ltnp 2>/dev/null`]);
      if (probe.exitCode === 0) pid = parseListeningPid(probe.stdout, port, platform);
    } catch { /* probe best-effort */ }
    if (pid) {
      conflicts.push({ port, name, holder: `process PID ${pid}`, recoverable: false });
    }
  }
  return { conflicts };
}

/** List leftover fixture containers from a prior run (`bp-fixtures*`), via
 *  `docker ps -a --filter name=bp-fixtures`. These are auto-reconciled at
 *  bring-up; preflight only surfaces them. Never throws. */
export async function detectLeftoverFixtureContainers(deps = {}) {
  const exec = deps.exec ?? runProcess;
  try {
    if (!(await isBinaryOnPath('docker', exec))) return [];
    const r = await exec('docker', ['ps', '-a', '--filter', 'name=bp-fixtures', '--format', '{{.Names}}']);
    if (r.exitCode !== 0) return [];
    return (r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

/** True iff the docker daemon is reachable (`docker info` exit 0). Distinct from
 *  `docker` being on PATH (a stopped Docker Desktop still has the CLI). */
export async function dockerDaemonReachable(deps = {}) {
  const exec = deps.exec ?? runProcess;
  try {
    if (!(await isBinaryOnPath('docker', exec))) return false;
    const r = await exec('docker', ['info', '--format', '{{.ServerVersion}}']);
    return r.exitCode === 0;
  } catch { return false; }
}

// ─── #137 Phase 1: shallow-repo detection + auto-unshallow (#5 residual) ──────
//
// #139 deleted the runner's own shallow fetches, so the runner can no longer
// self-inflict a shallow store. The remaining case (deferred from #139) is a repo
// the user shallow-cloned (a depth-limited clone) BEFORE invoking the runner: a
// plain `git fetch` doesn't deepen it, so reconcileWorktreeWithBase's `git merge origin/<base>`
// fails "refusing to merge unrelated histories". Per #138 tenet 1 (make progress)
// and #139's handoff suggestion, preflight AUTO-unshallows; it only hard-fails if
// the unshallow itself fails.

/** True iff `git rev-parse --is-shallow-repository` reports true. Never throws. */
export async function isShallowRepo(deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  try {
    const r = await exec('git', ['rev-parse', '--is-shallow-repository'], { cwd: repoRoot });
    return r.exitCode === 0 && r.stdout.trim() === 'true';
  } catch { return false; }
}

/**
 * Detect a shallow repo and, when found, auto-deepen it with `git fetch
 * --unshallow`. Returns a structured verdict the preflight renders:
 *   - { state: 'not-shallow' }            → nothing to do.
 *   - { state: 'unshallowed' }            → was shallow, now fully deepened (pass).
 *   - { state: 'unshallow-failed', error }→ still shallow (hard fail + guidance).
 *
 * @returns {Promise<{ state: 'not-shallow'|'unshallowed'|'unshallow-failed', error?: string }>}
 */
export async function ensureNotShallow(deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const log = deps.log ?? (() => {});
  if (!(await isShallowRepo({ exec, repoRoot }))) return { state: 'not-shallow' };
  log('  ↻ shallow repository detected — running `git fetch --unshallow` to deepen it (#137 / #5 residual)');
  const r = await exec('git', ['fetch', '--unshallow'], { cwd: repoRoot });
  if (r.exitCode === 0 && !(await isShallowRepo({ exec, repoRoot }))) {
    return { state: 'unshallowed' };
  }
  return { state: 'unshallow-failed', error: tailLines(r.stderr, 4) || 'unshallow did not deepen the store' };
}

// ─── #137 Phase 1 + 4: non-native Node / runtime-contract detection ───────────

/**
 * Detect a Node that may not be able to egress to api.anthropic.com — the
 * tribal-knowledge trap where the runner is launched under WSL or git-bash Node
 * on a Windows host (the spawned `claude` then cannot reach the API). Pure: reads
 * platform + an optionally-injected `/proc/version` string + env. Low-confidence
 * → callers WARN, never fail.
 *
 * @param {{ platform?: string, procVersion?: string|null, env?: NodeJS.ProcessEnv }} [input]
 * @returns {{ nonNative: boolean, reason: string|null }}
 */
export function detectNonNativeNode(input = {}) {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const procVersion = input.procVersion ?? null;
  if (platform === 'linux' && procVersion && /microsoft|wsl/i.test(procVersion)) {
    return { nonNative: true, reason: 'running under WSL (Linux Node on a Windows host)' };
  }
  if (env.MSYSTEM || env.MINGW_PREFIX) {
    return { nonNative: true, reason: `running under git-bash/MSYS (${env.MSYSTEM ?? 'MSYS'})` };
  }
  return { nonNative: false, reason: null };
}

// ─── #137 Phase 3: per-session watchdog (liveness timeout) ────────────────────
//
// The canary's S1-B ran 30+ minutes with a 28-minute session.log silence and
// nothing bounded it — the README's only remedy was a human Ctrl-C, which an
// unattended overnight build cannot assume. The watchdog REUSES the heartbeat's
// data (session.log mtime + `git status --short` file count): when a session
// shows no log write AND no file change for N minutes, it kills that session's
// claude process tree (one known child PID — not a blanket claude kill), so the
// session fails `stalled` and the wave continues / retries (tenet 1: make
// progress; tenet 3: the stall becomes an escalate-to-agent halt).

/** Resolve the stall threshold (ms). HS_SESSION_STALL_MS overrides the 15-minute
 *  default; non-positive / non-numeric values fall back to the default. `0` via
 *  HS_DISABLE_WATCHDOG disables the watchdog (handled by the caller). */
export function resolveStallThresholdMs(env = process.env) {
  const raw = env.HS_SESSION_STALL_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}

/**
 * Advance a per-session progress tracker with a fresh liveness sample. Progress =
 * the session.log mtime advanced OR the touched-file count changed. Pure: returns
 * the next tracker + whether the session has now been stalled past `thresholdMs`.
 *
 * @param {{ lastLogMtimeMs:number, lastFileCount:number, lastProgressAt:number }|null} tracker
 * @param {{ logMtimeMs:number, fileCount:number }} sample
 * @param {number} now
 * @param {number} thresholdMs
 * @returns {{ tracker: object, stalled: boolean, idleMs: number }}
 */
export function updateStallTracker(tracker, sample, now, thresholdMs) {
  if (!tracker) {
    return {
      tracker: { lastLogMtimeMs: sample.logMtimeMs, lastFileCount: sample.fileCount, lastProgressAt: now },
      stalled: false,
      idleMs: 0,
    };
  }
  const progressed = sample.logMtimeMs > tracker.lastLogMtimeMs || sample.fileCount !== tracker.lastFileCount;
  const lastProgressAt = progressed ? now : tracker.lastProgressAt;
  const idleMs = now - lastProgressAt;
  return {
    tracker: { lastLogMtimeMs: sample.logMtimeMs, lastFileCount: sample.fileCount, lastProgressAt },
    stalled: idleMs >= thresholdMs,
    idleMs,
  };
}

/** Build the targeted process-tree kill invocation for `pid`. On win32 this is
 *  `taskkill /PID <pid> /T /F` (whole tree); on posix the caller uses
 *  process.kill(-pid) on a detached child's group, so this returns null and
 *  signals the posix path. Pure. */
export function killTreeArgs(pid, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
  return null; // posix → process-group kill, see killProcessTree
}

/**
 * Kill a spawned child's whole process tree, targeted at one known PID. win32:
 * `taskkill /T /F`. posix: signal the process GROUP (the child is spawned
 * `detached` so its pgid === its pid) with SIGKILL, falling back to a direct PID
 * kill. Best-effort + never throws; returns whether a kill was issued.
 *
 * @returns {Promise<{ killed: boolean }>}
 */
export async function killProcessTree(pid, deps = {}) {
  if (!pid) return { killed: false };
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? runProcess;
  const kill = deps.kill ?? ((p, sig) => process.kill(p, sig));
  const treeArgs = killTreeArgs(pid, platform);
  try {
    if (treeArgs) {
      const r = await exec(treeArgs.cmd, treeArgs.args);
      return { killed: r.exitCode === 0 };
    }
    // posix: kill the detached group, then the pid as a fallback.
    try { kill(-pid, 'SIGKILL'); return { killed: true }; }
    catch { try { kill(pid, 'SIGKILL'); return { killed: true }; } catch { return { killed: false }; } }
  } catch {
    return { killed: false };
  }
}

/**
 * Start a per-session liveness watchdog. Samples session.log mtime + touched-file
 * count on an interval (default = min(threshold/3, 5min)); on stall it kills the
 * session's claude child (via getChild()) and invokes onStall(idleMs). The timer
 * is unref'd and stopped via the returned controller (call in a finally). Mirrors
 * startHeartbeat's shape. Returns { stop, tick } ({tick} exposed for tests).
 */
export function startSessionWatchdog(deps = {}) {
  const worktreePath = deps.worktreePath;
  const getChild = deps.getChild ?? (() => null);
  const exec = deps.exec ?? runProcess;
  const stat = deps.stat ?? ((p) => fs.stat(p));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const thresholdMs = deps.thresholdMs ?? resolveStallThresholdMs(deps.env);
  const intervalMs = deps.intervalMs ?? Math.max(30_000, Math.min(thresholdMs / 3, 5 * 60 * 1000));
  const onStall = deps.onStall ?? (() => {});
  const setIntervalFn = deps.setInterval ?? setInterval;
  const clearIntervalFn = deps.clearInterval ?? clearInterval;

  let tracker = null;
  let fired = false;

  const tick = async () => {
    if (fired || !worktreePath) return;
    let logMtimeMs = 0;
    let fileCount = 0;
    try {
      const st = await stat(path.join(worktreePath, 'session.log'));
      if (st && typeof st.mtimeMs === 'number') logMtimeMs = st.mtimeMs;
    } catch { /* log not opened yet → mtime 0 */ }
    try {
      const r = await exec('git', ['-C', worktreePath, 'status', '--short']);
      if (r && r.exitCode === 0) fileCount = (r.stdout || '').split(/\r?\n/).filter(Boolean).length;
    } catch { /* git unavailable */ }
    const res = updateStallTracker(tracker, { logMtimeMs, fileCount }, now(), thresholdMs);
    tracker = res.tracker;
    if (res.stalled && !fired) {
      fired = true;
      const child = getChild();
      log(`  ✗ watchdog: no output or file change for ${Math.round(res.idleMs / 60000)}m — killing the stalled session`);
      // Signal the stall BEFORE the async kill: killing the child resolves the
      // awaited claude exec, and the caller's `if (stalled)` check could run
      // before onStall otherwise (a flag-vs-kill race). Flag first, then kill.
      onStall(res.idleMs);
      if (child && child.pid) await killProcessTree(child.pid, { exec });
    }
  };

  const handle = setIntervalFn(() => { tick().catch(() => {}); }, intervalMs);
  if (handle && typeof handle.unref === 'function') handle.unref();
  let stopped = false;
  return {
    tick,
    intervalMs,
    thresholdMs,
    get fired() { return fired; },
    stop() { if (stopped) return; stopped = true; clearIntervalFn(handle); },
  };
}

// ─── #137 Phase 3: escalate-to-agent hook (tenet 3) ───────────────────────────
//
// When the deterministic spine cannot proceed (a stalled session, an integration
// gate halt), it hands a structured failure context to a supervising agent
// instead of just dying. Minimal + bounded: always write an `escalation-<n>.json`
// next to the failure report; if HS_ESCALATE_CMD is set, invoke it with the
// escalation file path so a wrapper (e.g. run-build.md's driver) can spawn an
// agent to diagnose + resume. Best-effort — escalation never crashes the halt.

export async function writeEscalation(escalation, deps = {}) {
  const scriptDir = deps.scriptDir ?? SCRIPT_DIR;
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.error;
  const env = deps.env ?? process.env;
  const writeFile = deps.writeFile ?? ((p, c) => fs.writeFile(p, c, 'utf-8'));
  const file = path.join(scriptDir, `escalation-${escalation.wave ?? 'x'}.json`);
  try {
    await writeFile(file, JSON.stringify(escalation, null, 2));
    log(`  ↳ escalation context written: ${file} (tenet 3 — a supervising agent can diagnose + resume from this)`);
  } catch (e) {
    log(`  ⚠ could not write escalation context: ${String(e?.message ?? e)}`);
    return { ok: false, file };
  }
  const cmd = env.HS_ESCALATE_CMD;
  if (cmd && cmd.trim()) {
    try {
      const [bin, ...rest] = parseShellCmd(cmd);
      await exec(bin, [...rest, file]);
      log(`  ↳ invoked HS_ESCALATE_CMD for the halt (${bin})`);
    } catch (e) {
      log(`  ⚠ HS_ESCALATE_CMD failed (non-fatal): ${String(e?.message ?? e)}`);
    }
  }
  return { ok: true, file };
}

export async function runPreflight(manifest, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const baseBranch = deps.baseBranch ?? process.env.HS_BASE_BRANCH ?? 'main';
  const scriptDir = deps.scriptDir ?? SCRIPT_DIR;
  const env = deps.env ?? process.env;
  const access = deps.access ?? (p => fs.access(p));

  const lines = [];
  let ok = true;
  const pass = (m) => lines.push(`✓ ${m}`);
  const fail = (m) => { lines.push(`✗ ${m}`); ok = false; };
  const info = (m) => lines.push(`→ ${m}`);
  const warn = (m) => lines.push(`⚠ ${m}`); // loud, non-fatal (ok stays true)

  // ── #127 Slice A: cloud-sync path warning ────────────────────────────────
  // Warn loudly (but do NOT fail) when the repo sits inside a OneDrive/Dropbox/
  // iCloud/Google Drive synced folder — sync agents lock files mid-build and
  // were a repeated cause of wave-0 hangs + mid-flight crashes (#102).
  const cloud = detectCloudSyncPath(repoRoot);
  if (cloud) {
    warn(
      `Repo is inside a ${cloud.provider} synced path (${repoRoot}). ` +
      `Cloud sync can lock files mid-build (npm install, git worktree remove, run-state.json writes), ` +
      `causing wave-0 hangs or mid-flight crashes. Strongly recommended: move the repo — and especially ` +
      `the .bp-worktrees/ directory — outside ${cloud.provider} before an autonomous run.`,
    );
  }

  // ── Repo / git state ─────────────────────────────────────────────────────
  const insideRepo = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot });
  if (insideRepo.exitCode === 0 && insideRepo.stdout.trim() === 'true') {
    pass(`Repo root is a git repo (${repoRoot})`);
  } else {
    fail(
      `Not a git repo: ${repoRoot}. ` +
      `If you ran the script from inside \`specs/build-plan/\`, ` +
      `\`cd\` to the repo root or set \`HS_REPO_ROOT=<repo-path>\` explicitly.`,
    );
  }

  const branchRes = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
  const currentBranch = branchRes.stdout.trim();
  if (branchRes.exitCode === 0 && currentBranch === baseBranch) {
    pass(`Current branch is "${baseBranch}"`);
  } else if (branchRes.exitCode === 0) {
    fail(`Current branch is "${currentBranch}" — switch to "${baseBranch}" or set HS_BASE_BRANCH="${currentBranch}"`);
  } else {
    fail(`Could not read current branch — ensure ${repoRoot} is a git repo with at least one commit`);
  }

  const remoteRes = await exec('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot });
  if (remoteRes.exitCode === 0 && remoteRes.stdout.trim()) {
    pass(`origin remote configured (${remoteRes.stdout.trim()})`);
  } else {
    fail(`No \`origin\` remote configured — add one with \`git remote add origin <url>\``);
  }

  // #137 Phase 1 (#5 residual): a repo shallow-cloned (a depth-limited clone)
  // before the runner ran breaks reconcileWorktreeWithBase ("refusing to merge unrelated histories").
  // Per #138 tenet 1 (make progress) auto-deepen it; only hard-fail if the
  // unshallow itself fails. --dry-run skips it (side-effect-free preview).
  if (!deps.skipShallowFix) {
    try {
      const sh = await ensureNotShallow({ exec, repoRoot, log: (m) => lines.push(m) });
      if (sh.state === 'unshallowed') pass(`Repository deepened (\`git fetch --unshallow\` succeeded)`);
      else if (sh.state === 'unshallow-failed') {
        fail(`Repository is shallow and \`git fetch --unshallow\` failed (${sh.error}) — run \`git fetch --unshallow\` manually before retrying (a shallow store breaks the pre-PR reconcile).`);
      }
    } catch (e) {
      info(`Shallow-repo check skipped — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // #137 Phase 1/4: warn when the runner is launched under WSL/git-bash Node on a
  // Windows host — the spawned `claude` may be unable to reach api.anthropic.com.
  // Low-confidence heuristic → warn, never fail.
  let procVersion = null;
  try { procVersion = await fs.readFile('/proc/version', 'utf-8'); } catch { /* not linux / no procfs */ }
  const nodeKind = detectNonNativeNode({ procVersion, env });
  if (nodeKind.nonNative) {
    warn(`Node appears non-native (${nodeKind.reason}). On a Windows host, use the native Windows Node — WSL/git-bash Node has been observed unable to egress to api.anthropic.com, which makes every spawned \`claude\` hang. (Runtime contract: native-OS Node + docker on PATH + gh auth.)`);
  }

  // #136 defect 2: report the repo every gh call will target. Resolved once at
  // startup; shown here so a wrong-repo misconfiguration is visible at second 0
  // rather than surfacing as a PR opened against the wrong remote.
  const repoSlug = deps.repo ?? RESOLVED_REPO ?? await resolveRepoSlug({ exec, repoRoot });
  if (repoSlug) {
    info(`gh target repo: ${repoSlug} (every gh call scoped with -R ${repoSlug})`);
  } else {
    warn(`Could not resolve an owner/repo slug — gh calls will fall back to cwd-based resolution. Set HS_REPO=<owner/repo> if gh targets the wrong repo.`);
  }

  // ── Tooling auth ─────────────────────────────────────────────────────────
  if (await isBinaryOnPath('gh', exec)) {
    const ghAuth = await exec('gh', ['auth', 'status']);
    if (ghAuth.exitCode === 0) {
      pass(`gh CLI authenticated`);
    } else {
      fail(`gh on PATH but not authenticated — run \`gh auth login\` or export GH_TOKEN=<token with repo scope>`);
    }
  } else {
    fail(`gh not on PATH — install from ${HOST_BIN_HINTS.gh}`);
  }

  if (await isBinaryOnPath(CLAUDE_CLI, exec)) {
    const claudeVer = await exec(CLAUDE_CLI, ['--version']);
    if (claudeVer.exitCode === 0) {
      const v = (claudeVer.stdout || claudeVer.stderr).trim().split(/\r?\n/)[0];
      pass(`claude CLI present (${v || 'version unknown'})`);
    } else {
      fail(`claude on PATH but \`${CLAUDE_CLI} --version\` failed — reinstall from ${HOST_BIN_HINTS.claude}`);
    }
  } else {
    fail(`claude not on PATH — install from ${HOST_BIN_HINTS.claude} (or set HS_CLAUDE_CLI=<path>)`);
  }

  // ANTHROPIC_API_KEY is informational — only `hyperspeed --score-briefs` uses it
  // directly; the spawned `claude` CLI uses its own auth.
  if (env.ANTHROPIC_API_KEY || env.HYPERSPEED_API_KEY) {
    pass(`ANTHROPIC_API_KEY/HYPERSPEED_API_KEY present`);
  } else {
    info(`ANTHROPIC_API_KEY not set — only required if you run \`hyperspeed --score-briefs\` against this plan`);
  }

  // ── Manifest integrity ───────────────────────────────────────────────────
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.waves)) {
    fail(`run-manifest.json missing or malformed — expected version:1 with waves[]`);
    return { ok: false, lines };
  }
  pass(`run-manifest.json parses (${manifest.waves.length} waves)`);

  const briefMissing = [];
  const ownedIllegal = [];
  for (const wave of manifest.waves) {
    if (wave.kind !== 'feature') continue;
    for (const s of wave.sessions ?? []) {
      if (s.brief) {
        const abs = path.isAbsolute(s.brief) ? s.brief : path.join(scriptDir, s.brief);
        try { await access(abs); } catch { briefMissing.push(`${s.id}→${s.brief}`); }
      }
      for (const owned of (s.ownedFiles ?? [])) {
        if (path.isAbsolute(owned) || owned.split(/[\\/]/).includes('..')) {
          ownedIllegal.push(`${s.id}→${owned}`);
        }
      }
    }
  }
  if (briefMissing.length === 0) {
    pass(`All session brief files exist on disk`);
  } else {
    fail(`Missing session briefs: ${briefMissing.join(', ')} — regenerate the build plan`);
  }
  if (ownedIllegal.length === 0) {
    pass(`All ownedFiles are legal repo-relative paths`);
  } else {
    fail(`Illegal ownedFiles paths (must be repo-relative, no \`..\` or absolute): ${ownedIllegal.join(', ')}`);
  }

  // ── #115: auto-merge repo setting ────────────────────────────────────────
  // The runner enables GitHub auto-merge on sessions with no manual ACs. That
  // only works if the repo has "Allow auto-merge" turned on (Settings →
  // General). Warn (non-fatal) if it is off and the plan has any auto-mergeable
  // session — otherwise those PRs will sit open and the wait-for-merge step
  // will time out.
  const autoMergeable = manifest.waves
    .filter(w => w.kind === 'feature')
    .flatMap(w => w.sessions ?? [])
    .filter(s => !(s.requiresHumanReview ?? ((s.manualAcs?.length ?? 0) > 0)));
  if (autoMergeable.length > 0 && await isBinaryOnPath('gh', exec)) {
    // #136 defect 2: scope to the build repo (cwd + -R) so the readiness probe
    // reads the TARGET repo's settings, not whatever repo sits at process.cwd().
    const amRes = await exec('gh', ghArgsFor(['api', 'repos/{owner}/{repo}', '-q', '.allow_auto_merge,.visibility'], deps.repo ?? RESOLVED_REPO), { cwd: repoRoot });
    if (amRes.exitCode === 0) {
      // `-q '.allow_auto_merge,.visibility'` prints two lines: bool then string.
      // Strip any surrounding quotes defensively (gh prints raw, but don't rely on it).
      const out = (amRes.stdout || '').trim().split(/\r?\n/).map(s => s.trim().replace(/^"|"$/g, ''));
      const allowAutoMerge = (out[0] || '').toLowerCase() === 'true';
      const visibility = (out[1] || '').toLowerCase();
      const verdict = describeAutoMergeReadiness({ allowAutoMerge, visibility, autoMergeableCount: autoMergeable.length });
      if (verdict.level === 'pass') pass(verdict.message);
      else info(verdict.message);
    } else {
      info(`Could not read the repo's auto-merge setting (gh api failed) — verify "Allow auto-merge" is on if you want unattended merges`);
    }
  }

  // ── Requirements verification (A1, #85) ──────────────────────────────────
  const reqs = manifest.requirements;
  const hostBins = reqs?.hostBinaries ?? [];
  if (hostBins.length === 0) {
    info(`No host binaries declared in requirements`);
  } else {
    // Use the exact failure-line format the issue's AC2 requires.
    for (const bin of hostBins) {
      const present = await isBinaryOnPath(bin, exec);
      if (present) {
        pass(`Host binary on PATH: ${bin}`);
      } else {
        const hint = HOST_BIN_HINTS[bin.toLowerCase()] ?? 'install from its official source';
        fail(`Missing host binary: ${bin} — install from ${hint}`);
      }
    }
  }

  const runtimes = reqs?.runtimes ?? [];
  if (runtimes.length === 0) {
    info(`No runtimes declared in requirements`);
  } else {
    for (const rt of runtimes) {
      const r = await checkRuntimeVersion(rt, exec);
      if (r.ok) pass(r.message); else fail(r.message);
    }
  }

  // ── C1-4 (#99): integration-cmd leading-binary probe ─────────────────────
  // runtimes verify declared interpreters; the integration command's own
  // executable (e.g. `pytest`) is not necessarily declared. Probe it so a
  // `pytest tests/integration` gate doesn't fail mysteriously at wave 0.
  const integrationCls = classifyIntegrationCmd(manifest.integrationCmd);
  if (integrationCls.action === 'check') {
    const present = await isBinaryOnPath(integrationCls.binary, exec);
    if (present) {
      pass(`Integration cmd binary on PATH: ${integrationCls.binary}`);
    } else {
      fail(`Integration cmd binary "${integrationCls.binary}" not on PATH — install it or update manifest.integrationCmd`);
    }
  } else if (integrationCls.action === 'defer-runtime') {
    info(`Integration cmd uses ${integrationCls.binary} — covered by the runtime check above`);
  }

  // ── C1-5 (#99): Phase 0 harness structural re-check ──────────────────────
  // Re-runs the generator-side validatePhaseZeroHarness logic against the
  // loaded manifest so a hand-edited manifest with a removed/broken harness
  // is caught at preflight, not at wave 0.
  const phaseZero = checkPhaseZeroHarness(manifest);
  if (phaseZero.applicable) {
    for (const c of phaseZero.checks) {
      if (c.pass) pass(c.message); else fail(c.message);
    }
  }

  // ── #109: greenfield base-branch seed check ──────────────────────────────
  // If a Phase 0 session owns the project manifest but the base branch does not
  // contain it, every Wave 0 worktree's bootstrap install will fail before
  // claude runs. Catch it here with actionable guidance instead of a cryptic
  // `bootstrap_failed` at minute zero.
  try {
    const gf = await detectGreenfield(manifest, { exec, repoRoot, baseBranch });
    if (gf.state === 'seeded') {
      pass(`Project manifest present on "${baseBranch}" (${gf.manifestPath})`);
    } else if (gf.state === 'needs-seed' && gf.hasStub) {
      fail(`Greenfield repo: "${baseBranch}" has no ${gf.manifestPath}. Run \`node build-plan/run-build.mjs --seed-base\` to seed the manifest + lockfile onto ${baseBranch} before Wave 0 (#109).`);
    } else if (gf.state === 'needs-seed') {
      fail(`Greenfield repo: "${baseBranch}" has no ${gf.manifestPath}, and this plan emitted no manifest stub to seed. Commit a complete ${gf.manifestPath} + lockfile to ${baseBranch} before Wave 0 (#109).`);
    }
  } catch (e) {
    info(`Greenfield seed check skipped — ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── #137 Phase 1: fixture-service host hazards ───────────────────────────
  // Only when the plan declares backing services (Postgres/Redis/…). Catches the
  // canary's host-state failures at second 0 instead of mid-wave: docker daemon
  // down, a host port already bound, leftover fixture containers from a prior run.
  const declaredServices = servicesFromManifest(manifest);
  if (declaredServices.length > 0 && !env.HS_SKIP_FIXTURE_SERVICES) {
    // Docker daemon reachable (distinct from `docker` on PATH — Docker Desktop
    // can be installed but stopped). Fatal: every service-dependent wave fails.
    if (await dockerDaemonReachable({ exec })) {
      pass(`Docker daemon reachable (${declaredServices.length} fixture service(s) declared)`);
    } else if (await isBinaryOnPath('docker', exec)) {
      fail(`Docker daemon not reachable (\`docker info\` failed) but ${declaredServices.length} fixture service(s) are declared — start Docker Desktop, or run your own stack and set HS_SKIP_FIXTURE_SERVICES=1.`);
    } else {
      fail(`\`docker\` not on PATH but ${declaredServices.length} fixture service(s) are declared — install from ${HOST_BIN_HINTS.docker}, or run your own stack and set HS_SKIP_FIXTURE_SERVICES=1.`);
    }
    // Port conflicts: a foreign holder is fatal (we can't free it); a leftover
    // bp-fixtures* container is recoverable (the fixture lifecycle reconciles it
    // at bring-up) → warn only.
    try {
      const { conflicts } = await checkPortConflicts(declaredServices, { exec });
      if (conflicts.length === 0) {
        const ports = collectServicePorts(declaredServices).map(p => p.port);
        if (ports.length) pass(`Fixture host port(s) free: ${ports.join(', ')}`);
      } else {
        for (const c of conflicts) {
          if (c.recoverable) {
            warn(`Port ${c.port} (service "${c.name}") is held by ${c.holder} — a leftover fixture container; it will be reconciled (\`docker compose down -v\`) at bring-up.`);
          } else {
            fail(`Port ${c.port} (service "${c.name}") is already bound by ${c.holder} — free it (stop that process/container) before running, or remap the service port in run-manifest.json.`);
          }
        }
      }
    } catch (e) {
      info(`Port-conflict check skipped — ${e instanceof Error ? e.message : String(e)}`);
    }
    // Leftover fixture containers (informational — auto-reconciled at bring-up).
    const leftovers = await detectLeftoverFixtureContainers({ exec });
    if (leftovers.length > 0) {
      warn(`Leftover fixture container(s) from a prior run: ${leftovers.join(', ')} — auto-reconciled at bring-up (\`docker compose -p bp-fixtures down -v\`). Remove manually if you prefer: \`docker rm -f ${leftovers.join(' ')}\`.`);
    }
  }

  // workspaceInstall / sessionInstall are NOT executed here — the runner
  // bootstraps them per-worktree. We only echo the count for visibility.
  const wsCount = reqs?.workspaceInstall?.length ?? 0;
  const sessionInstallCount = Object.values(reqs?.sessionInstall ?? {}).reduce((n, arr) => n + arr.length, 0);
  if (wsCount || sessionInstallCount) {
    info(`Workspace installs declared: ${wsCount} workspace + ${sessionInstallCount} session-scoped (not executed by --check-env)`);
  }

  // ── Runner config ────────────────────────────────────────────────────────
  // B1 (#95): intendedBuildModel is set on every new manifest. Legacy manifests
  // (pre-B1) may omit it; display whatever is declared, or note its absence.
  const intendedModel = manifest.intendedBuildModel ?? null;
  if (intendedModel) {
    info(`Intended build model (from manifest): ${intendedModel}`);
  } else {
    info(`Intended build model: not declared in manifest`);
  }
  if (env.HS_CLAUDE_CLI_ARGS) {
    info(`HS_CLAUDE_CLI_ARGS overrides default claude args: "${env.HS_CLAUDE_CLI_ARGS}"`);
    if (intendedModel && /--model\b/.test(env.HS_CLAUDE_CLI_ARGS)) {
      lines.push(`⚠ HS_CLAUDE_CLI_ARGS sets --model explicitly — this overrides intendedBuildModel "${intendedModel}"`);
    }
  }

  // Concurrency line — A3 (#87). Resolved by main() and forwarded via
  // deps.concurrency; when called from a context that didn't resolve (e.g. a
  // test passes only `env`), fall back to resolving from env + default here so
  // the line still surfaces.
  const concurrency = deps.concurrency ?? resolveConcurrency(null, env);
  info(formatConcurrencyLine(concurrency));

  // Cost cap — B3 (#95).
  const maxCost = deps.maxCost ?? resolveMaxCost(null, env);
  if (maxCost.value === 0) {
    info(`Cost cap: unlimited (set via ${maxCost.source})`);
  } else {
    info(`Cost cap: $${maxCost.value.toFixed(2)} (set via ${maxCost.source})`);
  }

  // Auto-advance — B4 (#95).
  const autoAdvance = deps.autoAdvance ?? resolveAutoAdvance(null, env);
  info(`Auto-advance: ${autoAdvance.value} (set via ${autoAdvance.source})`);

  // #126: test + integration-gate policies (CI-is-the-gate model). Resolved by
  // main() and forwarded; fall back to env+default when a caller passes only env.
  const testPolicy = deps.testPolicy ?? resolveTestPolicy(null, env);
  info(`Test policy: ${testPolicy.value} (set via ${testPolicy.source})`);
  const integrationGatePolicy = deps.integrationGatePolicy ?? resolveIntegrationGatePolicy(null, env);
  info(`Integration-gate policy: ${integrationGatePolicy.value} (set via ${integrationGatePolicy.source})`);

  return { ok, lines };
}

// ─── A3 (#87): bounded concurrency for feature waves ─────────────────────────

/**
 * Resolve the per-feature-wave concurrency limit. Precedence:
 *   1. CLI flag `--max-concurrent-sessions N`
 *   2. Env var `HS_MAX_CONCURRENT_SESSIONS`
 *   3. Default: 4
 *
 * Value `0` means unlimited (current Promise.all fan-out, for power users on
 * dedicated infrastructure). Negative or non-numeric env values are ignored
 * and fall through to the default — invalid CLI values throw in parseArgs.
 *
 * @param {{ maxConcurrentSessions: number | null } | null | undefined} args
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {{ value: number, source: string }}
 */
export function resolveConcurrency(args, env, platform = process.platform) {
  if (args && args.maxConcurrentSessions !== null && args.maxConcurrentSessions !== undefined) {
    return { value: args.maxConcurrentSessions, source: '--max-concurrent-sessions' };
  }
  const raw = env?.HS_MAX_CONCURRENT_SESSIONS;
  if (raw !== undefined && raw !== '') {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0) {
      return { value: n, source: 'HS_MAX_CONCURRENT_SESSIONS' };
    }
  }
  // #137 Phase 4: Windows concurrency guard. Concurrent `git worktree add` calls
  // race on `.git/config` on Windows (#132-A handles the lock with a retry, but
  // lowering the default further reduces the contention + the mid-wave base churn
  // staggered sessions cause). 2 keeps useful parallelism while halving the
  // simultaneous worktree-add pressure of the cross-platform default (4). Raise
  // with --max-concurrent-sessions / HS_MAX_CONCURRENT_SESSIONS on a fast host.
  if (platform === 'win32') return { value: WINDOWS_DEFAULT_CONCURRENCY, source: 'default (win32 guard)' };
  return { value: DEFAULT_CONCURRENCY, source: 'default' };
}

/**
 * Format the preflight concurrency info line so the resolved value and its
 * source are both visible. `0` renders as "unlimited" and pins the source tag
 * to "--max-concurrent-sessions 0" when the value came from the CLI, so users
 * can tell the unbounded fan-out was opt-in.
 *
 * @param {{ value: number, source: string }} concurrency
 */
export function formatConcurrencyLine(concurrency) {
  const { value, source } = concurrency;
  const tag = (value === 0 && source === '--max-concurrent-sessions')
    ? '--max-concurrent-sessions 0'
    : source;
  if (value === 0) return `Concurrency: unlimited (set via ${tag})`;
  return `Concurrency: ${value} sessions in parallel (set via ${tag})`;
}

// ─── B4 (#95): auto-advance policy ───────────────────────────────────────────

/**
 * Resolve the wave-advance policy. Precedence:
 *   1. CLI flag `--auto-advance <always|on-green|never>`
 *   2. Env var `HS_AUTO_ADVANCE`
 *   3. Default: 'always' (current behavior — unattended builds)
 *
 * @param {{ autoAdvance: 'always' | 'on-green' | 'never' } | null | undefined} args
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {{ value: 'always' | 'on-green' | 'never', source: string }}
 */
export function resolveAutoAdvance(args, env) {
  const VALID = new Set(['always', 'on-green', 'never']);
  if (args && args.autoAdvance !== null && args.autoAdvance !== undefined && VALID.has(args.autoAdvance)) {
    return { value: /** @type {'always'|'on-green'|'never'} */ (args.autoAdvance), source: '--auto-advance' };
  }
  const raw = env?.HS_AUTO_ADVANCE;
  if (raw && VALID.has(raw)) {
    return { value: /** @type {'always'|'on-green'|'never'} */ (raw), source: 'HS_AUTO_ADVANCE' };
  }
  return { value: /** @type {'always'|'on-green'|'never'} */ ('always'), source: 'default' };
}

/**
 * Decide what to do at a wave boundary. Pure — no I/O, no process.exit.
 * The caller maps the returned action onto a prompt / exit / proceed.
 *
 * Actions:
 *   - 'advance'        — run the wave with no pause
 *   - 'prompt'         — pause and ask the user (TTY)
 *   - 'refuse-non-tty' — pause is warranted but stdin is not a TTY; the caller
 *                        should exit 0 with guidance rather than hang
 *
 * Pause only applies in full-run mode (`isFullRun`): under `--wave N` the
 * supervised driver (run-build.md) sequences waves itself, so the runner must
 * never pause for a single-wave invocation. The first wave (`waveIndex === 0`)
 * never pauses — there is no prior wave to gate on.
 *
 * @param {{
 *   waveIndex: number,
 *   isFullRun: boolean,
 *   autoAdvance: 'always' | 'on-green' | 'never',
 *   prevWaveHadFailures: boolean,
 *   isTTY: boolean,
 * }} opts
 * @returns {'advance' | 'prompt' | 'refuse-non-tty'}
 */
export function decideWaveAdvance(opts) {
  const { waveIndex, isFullRun, autoAdvance, prevWaveHadFailures, isTTY } = opts;
  if (!isFullRun) return 'advance';                 // --wave N: supervisor sequences
  if (waveIndex <= 0) return 'advance';             // nothing precedes the first wave
  if (autoAdvance === 'always') return 'advance';
  const shouldPause = autoAdvance === 'never' || prevWaveHadFailures === true;
  if (!shouldPause) return 'advance';               // on-green + clean previous wave
  return isTTY ? 'prompt' : 'refuse-non-tty';
}

/**
 * Decide whether the next feature wave must be refused for exceeding the cost
 * cap. Pure — returns the projection so the caller can format the halt message.
 *
 * Estimate = wave size × per-session cost, where per-session cost is the MEAN
 * of completed-session spend (`totalCostUsd / completedCount`), falling back to
 * a $5 default before any session has completed. (The issue's prose calls this
 * "median" but specifies the mean formula — we implement the formula.)
 *
 * @param {{
 *   maxCost: number,           // 0 = unlimited
 *   spent: number,             // state.totalCostUsd
 *   completedCount: number,    // sessions with status 'done'
 *   waveSize: number,          // sessions in the wave about to run
 * }} opts
 * @returns {{ halt: boolean, projected: number, perSession: number }}
 */
export function shouldHaltForCost(opts) {
  const { maxCost, spent, completedCount, waveSize } = opts;
  if (!maxCost || maxCost <= 0) return { halt: false, projected: spent, perSession: 0 };
  const perSession = completedCount > 0 ? spent / completedCount : 5; // $5 default
  const projected = spent + waveSize * perSession;
  return { halt: projected > maxCost, projected, perSession };
}

// ─── B3 (#95): cost cap ───────────────────────────────────────────────────────

/**
 * Resolve the maximum allowed total run cost. Precedence:
 *   1. CLI flag `--max-cost N`
 *   2. Env var `HS_MAX_COST`
 *   3. Default: 0 (unlimited)
 *
 * Value `0` means unlimited. Negative or non-numeric env values are ignored.
 *
 * @param {{ maxCost: number | null } | null | undefined} args
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {{ value: number, source: string }}
 */
export function resolveMaxCost(args, env) {
  if (args && args.maxCost !== null && args.maxCost !== undefined) {
    return { value: args.maxCost, source: '--max-cost' };
  }
  const raw = env?.HS_MAX_COST;
  if (raw !== undefined && raw !== '') {
    const n = parseFloat(raw);
    if (!Number.isNaN(n) && n >= 0) {
      return { value: n, source: 'HS_MAX_COST' };
    }
  }
  return { value: 0, source: 'default' };
}

// ─── #126: test policy + integration-gate policy ("CI is the gate") ───────────
//
// Two opt-in policies that hand the authoritative gate to CI (branch protection
// + the required `test` job). Default behaviour is UNCHANGED (`block`) so
// existing unattended runs are not silently weakened.
//
//   - test-policy=advisory:  a failing independent test still reconciles,
//     pushes the branch, and opens a PR clearly marked
//     "local tests failed — CI is the gate". Auto-merge stays armed (#115), so a
//     genuinely broken change never self-merges (CI fails → no merge).
//   - integration-gate-policy=advisory:  a failed integration gate logs + writes
//     the failure report but CONTINUES to the next wave instead of exit(1).

/** @typedef {'block' | 'advisory'} GatePolicy */

/**
 * Resolve the local-test gating policy. Precedence: CLI flag > env var > default.
 *   1. `--test-policy <block|advisory>`
 *   2. `HS_TEST_POLICY`
 *   3. Default: 'block' (current behaviour — a failing local test fails the session)
 *
 * @param {{ testPolicy: GatePolicy | null } | null | undefined} args
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {{ value: GatePolicy, source: string }}
 */
export function resolveTestPolicy(args, env) {
  const VALID = new Set(['block', 'advisory']);
  if (args && args.testPolicy && VALID.has(args.testPolicy)) {
    return { value: /** @type {GatePolicy} */ (args.testPolicy), source: '--test-policy' };
  }
  const raw = env?.HS_TEST_POLICY;
  if (raw && VALID.has(raw)) {
    return { value: /** @type {GatePolicy} */ (raw), source: 'HS_TEST_POLICY' };
  }
  return { value: /** @type {GatePolicy} */ ('block'), source: 'default' };
}

/**
 * Resolve the integration-gate policy. Precedence: CLI flag > env var > default.
 *   1. `--integration-gate-policy <block|advisory>`
 *   2. `HS_INTEGRATION_GATE_POLICY`
 *   3. Default: 'block' (current behaviour — a failed integration gate halts)
 *
 * @param {{ integrationGatePolicy: GatePolicy | null } | null | undefined} args
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {{ value: GatePolicy, source: string }}
 */
export function resolveIntegrationGatePolicy(args, env) {
  const VALID = new Set(['block', 'advisory']);
  if (args && args.integrationGatePolicy && VALID.has(args.integrationGatePolicy)) {
    return { value: /** @type {GatePolicy} */ (args.integrationGatePolicy), source: '--integration-gate-policy' };
  }
  const raw = env?.HS_INTEGRATION_GATE_POLICY;
  if (raw && VALID.has(raw)) {
    return { value: /** @type {GatePolicy} */ (raw), source: 'HS_INTEGRATION_GATE_POLICY' };
  }
  return { value: /** @type {GatePolicy} */ ('block'), source: 'default' };
}

/**
 * Classify a single independent-test execution against the resolved policy.
 * Pure — the caller maps the action onto failSession vs. fall-through.
 *
 *   - exit 0                      → 'proceed'       (continue normally)
 *   - exit≠0 + policy 'block'     → 'block'         (failSession — default)
 *   - exit≠0 + policy 'advisory'  → 'advisory-push' (flag the PR, push anyway)
 *
 * @param {number} exitCode
 * @param {GatePolicy} policy
 * @returns {'proceed' | 'block' | 'advisory-push'}
 */
export function classifyTestOutcome(exitCode, policy) {
  if (exitCode === 0) return 'proceed';
  return policy === 'advisory' ? 'advisory-push' : 'block';
}

/**
 * Decide whether a failed wave (integration gate) must halt the run. Pure — no
 * I/O, no process.exit; `main()` maps a `true` onto exit(1). A successful wave
 * never halts; a failed wave halts only under the default 'block' policy.
 *
 * @param {{ ok: boolean }} res   integration-wave result
 * @param {GatePolicy} policy
 * @returns {boolean}
 */
export function shouldHaltAfterWave(res, policy) {
  if (res && res.ok) return false;
  return policy !== 'advisory';
}

/**
 * Run `fn(item, index)` over `items` with at most `limit` calls pending
 * simultaneously. When `limit` is `0` or `Infinity`, behaves exactly like
 * `Promise.all(items.map(fn))` — no queue is introduced when none is needed.
 *
 * Results are returned in input order. If `fn` throws/rejects, the whole call
 * rejects with the first error (matching `Promise.all` semantics); callers
 * that need per-item failure containment must `try/catch` inside `fn`.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} limit
 * @returns {Promise<R[]>}
 */
export async function runWithConcurrency(items, fn, limit) {
  if (!limit || limit === Infinity) {
    return Promise.all(items.map((it, i) => fn(it, i)));
  }
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Resolve a workspaceInstall marker into an absolute path. Markers may be:
 *   - relative paths (under the worktree): `node_modules/.package-lock.json`
 *   - home-relative paths: `~/.cache/ms-playwright`
 *
 * @param {string} marker
 * @param {string} worktreePath
 * @returns {string}
 */
export function resolveMarkerPath(marker, worktreePath) {
  if (!marker) return marker;
  if (marker.startsWith('~/') || marker === '~') {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, marker.slice(marker === '~' ? 1 : 2));
  }
  if (path.isAbsolute(marker)) return marker;
  return path.join(worktreePath, marker);
}

/**
 * Bootstrap a session's worktree before claude is spawned.
 *
 * Runs each `workspaceInstall[]` entry whose `marker` is missing, then any
 * `sessionInstall[<id>][]` entries for this session. Commands are tokenized
 * with the same naive shell parser used elsewhere in this file (sufficient
 * for the install commands we expect — npm/pip/docker invocations).
 *
 * Returns `{ ok: false, error: "bootstrap_failed: <cmd> ..." }` on the first
 * non-zero exit, so the caller can mark the session distinctly from a
 * `test_failed`. Returns `{ ok: true, ran: [...], skipped: [...] }` on success.
 *
 * @param {{ id: string }} session
 * @param {import('./run-build.mjs').Requirements | undefined} requirements
 * @param {string} worktreePath
 * @param {{ exec?: typeof runProcess; stat?: (p: string) => Promise<unknown>; log?: (m: string) => void }} [deps]
 */
export async function bootstrapWorktree(session, requirements, worktreePath, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const statFn = deps.stat ?? (p => fs.stat(p));
  const log = deps.log ?? (() => {});
  const ran = [];
  const skipped = [];

  const wsInstall = requirements?.workspaceInstall ?? [];
  for (const entry of wsInstall) {
    const absMarker = resolveMarkerPath(entry.marker, worktreePath);
    let present;
    try { await statFn(absMarker); present = true; } catch { present = false; }
    if (present) {
      skipped.push(entry.cmd);
      log(`    · ${session.id} bootstrap skip "${entry.cmd}" (marker ${entry.marker} present)`);
      continue;
    }
    log(`    · ${session.id} bootstrap run "${entry.cmd}"`);
    const [cmd, ...args] = parseShellCmd(entry.cmd);
    if (!cmd) {
      return {
        ok: false,
        error: `bootstrap_failed: empty workspaceInstall command`,
      };
    }
    const res = await exec(cmd, args, { cwd: worktreePath });
    if (res.exitCode !== 0) {
      // #109: a lockfile-based install failing usually means a greenfield base
      // branch was never seeded — point at --seed-base instead of leaving the
      // user with a raw `npm ci` error.
      const greenfieldHint = /\b(ci|--frozen-lockfile|--locked)\b/.test(entry.cmd)
        ? ` (greenfield? the base branch may be missing the project manifest/lockfile — run \`node build-plan/run-build.mjs --seed-base\` once, see #109)`
        : '';
      return {
        ok: false,
        error: `bootstrap_failed: "${entry.cmd}" exited ${res.exitCode} — ${tailLines(res.stderr || res.stdout, 10)}${greenfieldHint}`,
      };
    }
    ran.push(entry.cmd);
  }

  const sessionInstalls = requirements?.sessionInstall?.[session.id] ?? [];
  for (const cmdLine of sessionInstalls) {
    log(`    · ${session.id} bootstrap run "${cmdLine}" (session-scoped)`);
    const [cmd, ...args] = parseShellCmd(cmdLine);
    if (!cmd) {
      return {
        ok: false,
        error: `bootstrap_failed: empty sessionInstall command for ${session.id}`,
      };
    }
    const res = await exec(cmd, args, { cwd: worktreePath });
    if (res.exitCode !== 0) {
      return {
        ok: false,
        error: `bootstrap_failed: "${cmdLine}" exited ${res.exitCode} — ${tailLines(res.stderr || res.stdout, 10)}`,
      };
    }
    ran.push(cmdLine);
  }

  return { ok: true, ran, skipped };
}

// ─── Worktree lifecycle ──────────────────────────────────────────────────────

/**
 * @param {{ log?: Function }} [deps]
 * @returns {Promise<{ ok: boolean; stderr: string }>}
 */
/**
 * Heuristic: does a `git worktree add` stderr look like a transient
 * `.git/config` lock rather than a permanent error? When two sessions in a wave
 * run `git worktree add` simultaneously, both touch `.git/config` to write the
 * new branch's upstream; the loser fails with `could not lock config file
 * .git/config: File exists` (and/or `unable to write upstream branch
 * configuration`). On POSIX the lock window is tiny; on Windows it is hit
 * routinely. The lock clears in milliseconds, so a bounded retry resolves it.
 * A structural failure (bad ref, path already a worktree) is NOT a lock and
 * must fail fast — retrying it only burns the backoff window. (#132 A)
 *
 * @param {string | null | undefined} stderr
 */
export function isGitConfigLockError(stderr) {
  const s = String(stderr ?? '');
  // Structural failures that will never clear — do not retry.
  if (/already (?:exists|checked out|registered)|is not a valid|invalid reference|unknown revision|missing but already registered/i.test(s)) {
    return false;
  }
  return /could not lock config file|unable to write upstream branch configuration|File exists|\bEEXIST\b|\bEPERM\b|\bEACCES\b|\bEBUSY\b/i.test(s);
}

/**
 * @param {{ log?: Function, sleep?: (ms: number) => Promise<void> }} [deps]
 * @returns {Promise<{ ok: boolean; stderr: string }>}
 */
export async function worktreeAdd(repoRoot, worktreePath, branch, baseBranch = 'main', exec = runProcess, deps = {}) {
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  // #120: branch from the LATEST origin/<base>, not the stale local ref, so a
  // staggered session started after siblings merged picks up their changes. The
  // start-point `origin/<base>` is read-only — branching off it never mutates the
  // shared base ref, so it is safe under concurrent worktree creation. Fetch is
  // best-effort: if it fails (offline / lock contention) we fall back to the
  // local base ref (the prior behaviour) so the session can still proceed.
  let startPoint = baseBranch;
  const fetchRes = await exec('git', ['fetch', 'origin', baseBranch], { cwd: repoRoot });
  if (fetchRes.exitCode === 0) {
    startPoint = `origin/${baseBranch}`;
  } else {
    log(`  ⚠ worktreeAdd: \`git fetch origin ${baseBranch}\` failed — branching from local ${baseBranch} (${tailLines(fetchRes.stderr, 2)})`);
  }
  // Create a new branch from the start-point; -B re-creates if it exists (resume case).
  // #132 A — retry on a transient `.git/config` lock (concurrent worktree adds in
  // the same wave race to write upstream config; the loser fails on Windows).
  // Same bounded escalating backoff as renameAtomic/worktreeRemove. `-B` makes
  // the add idempotent, so re-running after a partial failure is safe.
  for (let attempt = 0; ; attempt++) {
    const res = await exec('git', ['worktree', 'add', '-B', branch, worktreePath, startPoint], { cwd: repoRoot });
    if (res.exitCode === 0) return { ok: true, stderr: res.stderr };
    if (!isGitConfigLockError(res.stderr) || attempt >= FS_RETRY_DELAYS_MS.length) {
      return { ok: false, stderr: res.stderr };
    }
    log(`  ⚠ worktreeAdd: \`.git/config\` lock contention — retrying in ${FS_RETRY_DELAYS_MS[attempt]}ms (${tailLines(res.stderr, 1)})`);
    await sleep(FS_RETRY_DELAYS_MS[attempt]);
  }
}

/**
 * Heuristic: does a `git worktree remove` stderr look like a transient file
 * lock (held by antivirus/indexer/cloud-sync) rather than a structural error
 * like "is not a working tree"? Lock-style failures are worth retrying; a
 * structural failure is not (it will never clear). (#127 Slice C)
 *
 * @param {string | null | undefined} stderr
 */
export function isWorktreeLockError(stderr) {
  const s = String(stderr ?? '');
  if (/is not a working tree|not a valid|No such file or directory/i.test(s)) return false;
  return /unable to remove|cannot remove|failed to (?:delete|remove)|permission denied|resource busy|being used by another process|directory not empty|EPERM|EACCES|EBUSY|EEXIST/i.test(s);
}

/**
 * Remove a git worktree, retrying on transient lock-style failures with the
 * same bounded escalating backoff as renameAtomic (#127 Slice C). A cloud-sync
 * or antivirus handle can hold a file across a single `git worktree remove`;
 * retrying clears it. A non-lock failure (e.g. "is not a working tree") fails
 * fast — retrying it would only waste the backoff window. Never throws; returns
 * `{ ok:false }` on permanent failure so callers can decide (the success-path
 * caller logs a warning rather than crashing — a stale worktree is recovered by
 * reconcileState's force-clean on the next run).
 *
 * @param {string} repoRoot
 * @param {string} worktreePath
 * @param {typeof runProcess} [exec]
 * @param {{ sleep?: (ms: number) => Promise<void> }} [deps]
 * @returns {Promise<{ ok: boolean; stderr: string }>}
 */
export async function worktreeRemove(repoRoot, worktreePath, exec = runProcess, deps = {}) {
  const sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    const res = await exec('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    if (res.exitCode === 0) return { ok: true, stderr: res.stderr };
    // Fail fast on a structural (non-lock) error, or once retries are exhausted.
    if (!isWorktreeLockError(res.stderr) || attempt >= FS_RETRY_DELAYS_MS.length) {
      return { ok: false, stderr: res.stderr };
    }
    await sleep(FS_RETRY_DELAYS_MS[attempt]);
  }
}

/**
 * Best-effort worktree cleanup for the success path (#127 Slice C): remove the
 * worktree (with lock-tolerant retry) and, if it ultimately fails, log a loud
 * warning instead of throwing. A leftover worktree directory is harmless — the
 * next run's reconcileState force-cleans it — so a failed cleanup must never
 * crash an otherwise-successful session.
 *
 * @param {string} repoRoot
 * @param {string} worktreePath
 * @param {typeof runProcess} [exec]
 * @param {{ log?: Function, sessionId?: string, sleep?: (ms: number) => Promise<void> }} [deps]
 * @returns {Promise<{ ok: boolean; stderr: string }>}
 */
export async function cleanupWorktreeBestEffort(repoRoot, worktreePath, exec = runProcess, deps = {}) {
  const log = deps.log ?? console.log;
  const res = await worktreeRemove(repoRoot, worktreePath, exec, { sleep: deps.sleep });
  if (!res.ok) {
    const who = deps.sessionId ? `${deps.sessionId}: ` : '';
    log(
      `  ⚠ ${who}worktree cleanup failed after retries (${tailLines(res.stderr, 2)}) — ` +
      `leaving stale worktree at ${worktreePath}; reconcileState will force-clean it on the next run.`,
    );
  }
  return res;
}

// ─── Manifest loader ─────────────────────────────────────────────────────────

export async function loadManifest(manifestPath = MANIFEST_PATH) {
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.waves)) {
    throw new Error(`Invalid manifest at ${manifestPath} — expected version: 1 and waves[].`);
  }
  return parsed;
}

// ─── CLI parsing ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {
    dryRun: false,
    wave: null,
    help: false,
    requireQualityScore: false,
    qualityThreshold: 20,
    checkEnv: false,
    skipEnvCheck: false,
    seedBase: false, // #109: seed greenfield project manifest onto the base branch
    maxConcurrentSessions: null,
    maxCost: /** @type {number | null} */ (null), // B3 (#95)
    autoAdvance: /** @type {'always' | 'on-green' | 'never' | null} */ (null), // B4 (#95); null = use env/default
    testPolicy: /** @type {'block' | 'advisory' | null} */ (null), // #126; null = use env/default
    integrationGatePolicy: /** @type {'block' | 'advisory' | null} */ (null), // #126; null = use env/default
    resumeFromPr: /** @type {string | null} */ (null), // C2-1 (#84): re-enter after a manually-fixed PR
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--wave') {
      const v = argv[++i];
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) throw new Error(`--wave expects an integer, got "${v}"`);
      out.wave = n;
    } else if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (a === '--check-env') {
      out.checkEnv = true;
    } else if (a === '--skip-env-check') {
      out.skipEnvCheck = true;
    } else if (a === '--seed-base') {
      out.seedBase = true;
    } else if (a === '--max-concurrent-sessions') {
      const v = argv[++i];
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < 0) {
        throw new Error(`--max-concurrent-sessions expects a non-negative integer, got "${v}"`);
      }
      out.maxConcurrentSessions = n;
    } else if (a === '--max-cost') {
      // B3 (#95): maximum total cost cap. 0 = unlimited.
      const v = argv[++i];
      const n = parseFloat(v);
      if (Number.isNaN(n) || n < 0) {
        throw new Error(`--max-cost expects a non-negative number, got "${v}"`);
      }
      out.maxCost = n;
    } else if (a === '--auto-advance') {
      // B4 (#95): wave-advance policy.
      const v = argv[++i];
      if (v !== 'always' && v !== 'on-green' && v !== 'never') {
        throw new Error(`--auto-advance expects always|on-green|never, got "${v}"`);
      }
      out.autoAdvance = v;
    } else if (a === '--test-policy') {
      // #126: local-test gating policy (CI is the authoritative gate).
      const v = argv[++i];
      if (v !== 'block' && v !== 'advisory') {
        throw new Error(`--test-policy expects block|advisory, got "${v}"`);
      }
      out.testPolicy = v;
    } else if (a === '--integration-gate-policy') {
      // #126: integration-gate halt policy.
      const v = argv[++i];
      if (v !== 'block' && v !== 'advisory') {
        throw new Error(`--integration-gate-policy expects block|advisory, got "${v}"`);
      }
      out.integrationGatePolicy = v;
    } else if (a === '--resume-from-pr') {
      // C2-1 (#84): mark a session done after its PR went green out-of-band.
      const v = argv[++i];
      if (!v || v.startsWith('--')) {
        throw new Error(`--resume-from-pr expects a session id, got "${v ?? ''}"`);
      }
      out.resumeFromPr = v;
    } else if (a === '--require-quality-score') {
      out.requireQualityScore = true;
      // Optional numeric threshold follows the flag.
      const next = argv[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        out.qualityThreshold = parseInt(next, 10);
        i++;
      }
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return out;
}

// ─── Brief quality gate (#37 ↔ #39) ──────────────────────────────────────────

/**
 * Read the JSON sidecar emitted by `hyperspeed --score-briefs` (Track C, #39).
 * Returns:
 *   - { ok: true, summary } when every brief scored ≥ threshold and there are no errors,
 *   - { ok: false, reason } when the report is missing, malformed, or any brief is below
 *     threshold / errored — the runner refuses to fire in that case.
 *
 * `threshold` overrides whatever was baked into the report at scoring time.
 *
 * Default location: `<build-plan-dir>/brief-quality-report.json` alongside the markdown
 * report. Pass `summaryPath` explicitly in tests.
 */
export async function checkQualityGate(threshold, summaryPath = path.join(SCRIPT_DIR, 'brief-quality-report.json')) {
  let raw;
  try {
    raw = await fs.readFile(summaryPath, 'utf-8');
  } catch {
    return {
      ok: false,
      reason: `--require-quality-score is set but ${path.basename(summaryPath)} was not found. ` +
        `Run \`hyperspeed --score-briefs <build-plan-dir>\` first.`,
    };
  }
  let summary;
  try { summary = JSON.parse(raw); }
  catch (e) {
    return { ok: false, reason: `Quality summary at ${summaryPath} is not valid JSON: ${e.message}` };
  }
  if (!summary || !Array.isArray(summary.briefs)) {
    return { ok: false, reason: `Quality summary at ${summaryPath} is missing a briefs[] array.` };
  }
  // C1-8 (#99): forward-compat guard. A report MAY omit scoredWithModel
  // (legacy reports predating #99 still gate normally), but if the field is
  // present it must name a model — an empty string signals a malformed or
  // deprecated-model report we refuse rather than silently trust.
  if ('scoredWithModel' in summary
      && (typeof summary.scoredWithModel !== 'string' || summary.scoredWithModel.trim() === '')) {
    return {
      ok: false,
      reason: `Quality summary at ${summaryPath} has an empty scoredWithModel — re-run \`hyperspeed --score-briefs\` to regenerate it.`,
    };
  }
  const below = summary.briefs.filter(b => typeof b.total === 'number' && b.total < threshold);
  const errors = summary.briefs.filter(b => b.error);
  // #109: a brief whose final verdict is "regenerate" while scoring at/above
  // threshold carries a semantic flag the numeric total misses (e.g. a Phase 0
  // manifest owner that names no concrete dependency list). Block on it too.
  const regenerate = summary.briefs.filter(b =>
    !b.error && b.verdict === 'regenerate' && !(typeof b.total === 'number' && b.total < threshold));
  if (below.length > 0 || errors.length > 0 || regenerate.length > 0) {
    const belowMsg = below.length
      ? `${below.length} brief(s) below threshold ${threshold}: ${below.map(b => `${b.briefId}=${b.total}`).join(', ')}`
      : '';
    const regenMsg = regenerate.length
      ? `${regenerate.length} brief(s) flagged regenerate: ${regenerate.map(b => b.briefId).join(', ')}`
      : '';
    const errMsg = errors.length
      ? `${errors.length} brief(s) errored: ${errors.map(b => b.briefId).join(', ')}`
      : '';
    return { ok: false, reason: [belowMsg, regenMsg, errMsg].filter(Boolean).join(' · ') };
  }
  return { ok: true, summary };
}

// ─── C2-2 (#84): auto-invoke the brief scorer when the report is missing ─────

/**
 * Ensure a `brief-quality-report.json` exists before the quality gate reads it.
 *
 * If the report is already present, this is a no-op (`{ ok: true, ran: false }`).
 * Otherwise it tries to generate it, in order:
 *   1. `hyperspeed --score-briefs <build-plan-dir>`  (global install on PATH)
 *   2. `npx hyperspeed --score-briefs <build-plan-dir>`  (running from the repo)
 *
 * The first candidate that is on PATH, exits 0, AND leaves a report at the
 * expected path wins. If none do, returns `{ ok: false, triedMsg }` where
 * `triedMsg` lists every candidate with why it didn't work ((not on PATH) /
 * (exit N) / (ran but produced no report)) so the gate's error is actionable.
 *
 * Pure-ish: every effect (exec, PATH probe, fs.access, logging) is injectable.
 *
 * @param {{
 *   exec?: typeof runProcess,
 *   isBinaryOnPath?: typeof isBinaryOnPath,
 *   access?: (p: string) => Promise<unknown>,
 *   log?: (m: string) => void,
 *   buildPlanDir?: string,
 *   reportPath?: string,
 * }} [deps]
 * @returns {Promise<{ ok: boolean, ran: boolean, via?: string, triedMsg?: string }>}
 */
export async function ensureQualityReport(deps = {}) {
  const exec = deps.exec ?? runProcess;
  const isOnPath = deps.isBinaryOnPath ?? isBinaryOnPath;
  const access = deps.access ?? ((p) => fs.access(p));
  const log = deps.log ?? console.log;
  const buildPlanDir = deps.buildPlanDir ?? SCRIPT_DIR;
  const reportPath = deps.reportPath ?? path.join(buildPlanDir, 'brief-quality-report.json');

  // Already there → nothing to do (C2-2-AC3 leaves existing behavior intact).
  try { await access(reportPath); return { ok: true, ran: false }; }
  catch { /* fall through to generate */ }

  const candidates = [
    { cmd: 'hyperspeed', args: ['--score-briefs', buildPlanDir] },
    { cmd: 'npx', args: ['hyperspeed', '--score-briefs', buildPlanDir] },
  ];

  const triedMsgs = [];
  for (const c of candidates) {
    const display = `${c.cmd} ${c.args.join(' ')}`;
    if (!(await isOnPath(c.cmd, exec))) {
      triedMsgs.push(`${display} (not on PATH)`);
      continue;
    }
    log(`→ brief-quality-report.json missing — generating it with: ${display}`);
    const res = await exec(c.cmd, c.args, { cwd: buildPlanDir });
    if (res.exitCode === 0) {
      try { await access(reportPath); return { ok: true, ran: true, via: display }; }
      catch { triedMsgs.push(`${display} (ran but produced no ${path.basename(reportPath)})`); continue; }
    }
    triedMsgs.push(`${display} (exit ${res.exitCode})`);
  }

  return { ok: false, ran: false, triedMsg: triedMsgs.join('; ') };
}

// ─── C2-1 (#84): --resume-from-pr ────────────────────────────────────────────

/**
 * Evaluate a PR's `statusCheckRollup` (the JSON array `gh pr view --json
 * statusCheckRollup` returns) into a green/not-green verdict. Pure — exported
 * for unit testing.
 *
 * Each rollup entry is either a CheckRun (`{ name, status, conclusion }`) or a
 * StatusContext (`{ context, state }`). We normalize the verdict from
 * `conclusion ?? state` and treat SUCCESS / SKIPPED / NEUTRAL as passing,
 * anything still running (empty / PENDING / IN_PROGRESS / QUEUED) as pending,
 * and everything else (FAILURE / ERROR / CANCELLED / TIMED_OUT / ...) as
 * failing. A PR is green only when there is at least one check and none are
 * failing or pending.
 *
 * @param {Array<Record<string, any>> | null | undefined} rollup
 * @returns {{ green: boolean, failing: string[], pending: string[], total: number }}
 */
export function evaluateStatusChecks(rollup) {
  const checks = Array.isArray(rollup) ? rollup : [];
  const PASS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
  const failing = [];
  const pending = [];
  for (const c of checks) {
    const name = c.name || c.context || c.workflowName || '(unnamed check)';
    const verdict = String(c.conclusion || c.state || '').toUpperCase();
    if (PASS.has(verdict)) continue;
    if (verdict === '' || /PENDING|IN_PROGRESS|QUEUED|WAITING|REQUESTED|EXPECTED/.test(verdict)) {
      pending.push(name);
    } else {
      failing.push(`${name} (${verdict || 'unknown'})`);
    }
  }
  const green = checks.length > 0 && failing.length === 0 && pending.length === 0;
  return { green, failing, pending, total: checks.length };
}

/**
 * Re-enter the runner after a session's PR was fixed and went green out-of-band.
 *
 * Finds the session's branch (`bp/<runId>/<sessionId>`), confirms an OPEN PR
 * exists, checks its required status checks are green, and — only then — marks
 * the session `done` in run-state.json (preserving prUrl / branch / worktreePath,
 * stamping completedAt). On any failure prints an actionable message and returns
 * a non-zero exit code. Never creates a worktree or runs a wave.
 *
 * Returns the intended process exit code (0 = marked done, 1 = not green / not
 * found / no state). Side effects (gh, state load/save, logging) are injected
 * via `deps` so the path is fully unit-testable.
 *
 * @param {string} sessionId
 * @param {{
 *   exec?: typeof runProcess,
 *   loadState?: typeof loadState,
 *   saveState?: typeof saveState,
 *   statePath?: string,
 *   log?: (m: string) => void,
 *   errLog?: (m: string) => void,
 *   now?: () => string,
 * }} [deps]
 * @returns {Promise<number>}
 */
export async function resumeFromPr(sessionId, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const loadStateFn = deps.loadState ?? loadState;
  const saveStateFn = deps.saveState ?? saveState;
  const log = deps.log ?? console.log;
  const errLog = deps.errLog ?? console.error;
  const now = deps.now ?? (() => new Date().toISOString());

  const state = await loadStateFn(deps.statePath);
  if (!state) {
    errLog(`✗ No run-state.json found — nothing to resume. Run the build at least once first.`);
    return 1;
  }

  const branch = `bp/${state.runId}/${sessionId}`;

  // #136 defect 2: scope to the build repo so `gh pr view` resolves the right PR.
  const view = await exec('gh', ghArgsFor(['pr', 'view', branch, '--json', 'state,statusCheckRollup,url'], deps.repo ?? RESOLVED_REPO), { cwd: deps.repoRoot ?? REPO_ROOT });
  if (view.exitCode !== 0) {
    errLog(`✗ No open PR found for session "${sessionId}" (expected branch "${branch}").`);
    errLog(`  Push commits to "${branch}" and open a PR, or check the session id against run-manifest.json.`);
    return 1;
  }

  let parsed;
  try {
    parsed = JSON.parse(view.stdout);
  } catch (e) {
    errLog(`✗ Could not parse gh output for "${branch}": ${e.message}`);
    return 1;
  }

  if (parsed.state && parsed.state !== 'OPEN') {
    errLog(`✗ PR for "${sessionId}" is ${parsed.state}, not OPEN (branch "${branch}").`);
    errLog(`  --resume-from-pr only operates on an open PR with green checks.`);
    return 1;
  }

  const verdict = evaluateStatusChecks(parsed.statusCheckRollup);
  if (!verdict.green) {
    errLog(`✗ PR not green yet — fix the failing check and re-run --resume-from-pr ${sessionId}.`);
    if (verdict.failing.length) errLog(`  Failing: ${verdict.failing.join(', ')}`);
    if (verdict.pending.length) errLog(`  Pending: ${verdict.pending.join(', ')}`);
    if (verdict.total === 0) errLog(`  No status checks found on the PR — is the session-tests workflow committed and required?`);
    return 1;
  }

  // Green → mark done, preserving prior fields per C2-1-AC1.
  const cur = state.sessions[sessionId] ?? makeEmptySessionState();
  cur.status = 'done';
  cur.branch = cur.branch ?? branch;
  cur.prUrl = cur.prUrl ?? parsed.url ?? null;
  cur.completedAt = now();
  state.sessions[sessionId] = cur;
  await saveStateFn(state, deps.statePath);

  log(`✓ ${sessionId} marked done — re-run the runner to advance.`);
  return 0;
}

const HELP = `HyperSpeed Build Plan Runner

Usage:
  node build-plan/run-build.mjs                      Execute all waves end-to-end
  node build-plan/run-build.mjs --wave N             Execute a single wave (used by run-build.md)
  node build-plan/run-build.mjs --dry-run            Print the wave plan and exit
  node build-plan/run-build.mjs --check-env          Run preflight checks (repo, auth, manifest,
                                                    requirements, runner config) and exit 0/1
  node build-plan/run-build.mjs --seed-base          Greenfield Step 0: seed the project manifest +
                                                    lockfile onto the base branch (from bootstrap/<manifest>)
                                                    so every Wave 0 worktree can install. Run on the base
                                                    branch before --check-env / --wave 0. Idempotent.
  node build-plan/run-build.mjs --skip-env-check     Skip the auto-preflight at startup
                                                    (combine with --wave N for an opt-out)
  node build-plan/run-build.mjs --max-concurrent-sessions N
                                                    Cap parallel sessions per feature wave (default 4;
                                                    0 = unlimited; overrides HS_MAX_CONCURRENT_SESSIONS)
  node build-plan/run-build.mjs --max-cost N        Halt before any wave whose projected total cost
                                                    would exceed $N (0 = unlimited; overrides HS_MAX_COST)
  node build-plan/run-build.mjs --auto-advance MODE always|on-green|never — pause at wave boundaries
                                                    (default always; overrides HS_AUTO_ADVANCE)
  node build-plan/run-build.mjs --test-policy MODE  block|advisory — when a session's independent test
                                                    fails, block (default; fail the session) or advisory
                                                    (push + open PR marked "CI is the gate", arm auto-merge).
                                                    Overrides HS_TEST_POLICY.
  node build-plan/run-build.mjs --integration-gate-policy MODE
                                                    block|advisory — when an integration gate fails, halt
                                                    (default) or log + continue to the next wave.
                                                    Overrides HS_INTEGRATION_GATE_POLICY.
  node build-plan/run-build.mjs --require-quality-score [N]
                                                    Gate: refuse to fire unless every brief in
                                                    brief-quality-report.json scored ≥ N (default 20).
                                                    Generate that report with: hyperspeed --score-briefs <build-plan-dir>
  node build-plan/run-build.mjs --resume-from-pr <session-id>
                                                    Mark a session done after its PR went green
                                                    out-of-band (you pushed a CI fix). Verifies the
                                                    PR's checks are green, then re-run the runner to advance.

Environment:
  HS_CLAUDE_CLI         Override claude CLI binary (default: claude)
  HS_CLAUDE_CLI_ARGS    Override claude CLI args (default: "--dangerously-skip-permissions -p").
                        If this contains --model, it wins over the manifest's intendedBuildModel.
  HS_REPO_ROOT          Override repo root for worktree creation (default: cwd)
  HS_BASE_BRANCH        Override the expected base branch (default: main)
  HS_MAX_CONCURRENT_SESSIONS  Cap parallel sessions per feature wave (default: 4; 0 = unlimited;
                              superseded by --max-concurrent-sessions)
  HS_MAX_COST           Cost cap in USD (default: 0 = unlimited; superseded by --max-cost)
  HS_AUTO_ADVANCE       Wave-advance policy always|on-green|never (default: always;
                              superseded by --auto-advance)
  HS_TEST_POLICY        Local-test gating block|advisory (default: block; superseded by
                              --test-policy). advisory = push + PR ("CI is the gate") on a
                              failing independent test instead of failing the session.
  HS_INTEGRATION_GATE_POLICY  Integration-gate halt block|advisory (default: block; superseded
                              by --integration-gate-policy). advisory = log + continue past a
                              failed integration gate instead of halting.
  HS_HEARTBEAT_INTERVAL_MS    Interval (ms) between per-session heartbeat lines during a
                              feature wave (default: 300000 = 5 min)
  HS_AUTOMERGE_TIMEOUT_MS     Max time (ms) to wait for a wave's no-manual-AC PRs to
                              auto-merge before advancing (default: 1200000 = 20 min). #115
  HS_NO_AUTOMERGE_RECOVERY    Set to 1 to disable auto-recovery of a PR that goes
                              conflicting (DIRTY) after a sibling merged — by default
                              (#120) the runner reconciles + re-pushes it so it can
                              auto-merge; with this set it fails the wave instead.

See build-plan/README.md for required out-of-band setup (GH_TOKEN, CI workflow,
branch-protection rule on main).
`;

// ─── Dry-run printer ─────────────────────────────────────────────────────────

export function formatDryRunPlan(manifest) {
  const lines = [];
  lines.push(`Run manifest: ${manifest.waves.length} waves, integrationCmd="${manifest.integrationCmd}"`);
  for (const w of manifest.waves) {
    if (w.kind === 'feature') {
      lines.push(`  [feature]    phase ${w.phase} — ${w.sessions.length} session(s)`);
      for (const s of w.sessions) {
        const manualCount = (s.manualAcs ?? []).length;
        lines.push(`     • ${s.id}  test=${s.test.cmd}  manualACs=${manualCount}  brief=${s.brief}`);
      }
    } else {
      lines.push(`  [integration] ${w.phase} — cmd: ${w.test.cmd}`);
    }
  }
  return lines.join('\n');
}

// ─── C1-7 (#99): wave duration estimate + wall-clock formatting ──────────────

/**
 * Estimate a feature wave's typical wall-clock minutes from R2 complexity.
 * Buckets: S=30, M=60, L=120 min (default M). The lower bound is the longest
 * single-session time; the upper bound is that × the number of serialized
 * batches (`ceil(N / concurrency)`), modelling the bounded fan-out.
 *
 * Returns `null` when no session carries a `complexity` field (legacy manifest)
 * so the caller omits the estimate rather than printing a misleading one.
 *
 * @param {Array<{ complexity?: string }>} sessions
 * @param {number} [concurrencyValue]  0/undefined = unlimited (single batch)
 * @returns {{ lower: number, upper: number } | null}
 */
export function estimateWaveMinutes(sessions, concurrencyValue) {
  if (!sessions || sessions.length === 0) return null;
  if (!sessions.some(s => s && s.complexity)) return null;
  const timeFor = (c) => {
    const b = String(c || 'M').trim().toUpperCase();
    return b === 'S' ? 30 : b === 'L' ? 120 : 60;
  };
  const times = sessions.map(s => timeFor(s && s.complexity));
  const maxSingle = Math.max(...times);
  const n = sessions.length;
  const conc = concurrencyValue && concurrencyValue > 0 ? concurrencyValue : n;
  const batches = Math.max(1, Math.ceil(n / conc));
  return { lower: maxSingle, upper: maxSingle * batches };
}

/** Format an elapsed millisecond count as whole minutes, e.g. `47m`. */
export function formatWallClock(ms) {
  return `${Math.max(0, Math.round(ms / 60000))}m`;
}

// ─── C1-6 (#99): per-session heartbeat ───────────────────────────────────────

const HEARTBEAT_MIN_ELAPSED_MS = 5 * 60_000; // skip sessions younger than 5 min
const HEARTBEAT_DEFAULT_INTERVAL_MS = 300_000;

/** Format "<n>s ago" / "<n>m ago" for a log-mtime age. */
function formatLogAge(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 90) return `${sec}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

/**
 * Resolve the heartbeat interval. Precedence: explicit `intervalMs` dep >
 * `HS_HEARTBEAT_INTERVAL_MS` env > 5-minute default. Non-numeric / non-positive
 * values fall through to the default.
 *
 * @param {number | undefined} intervalMs
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveHeartbeatInterval(intervalMs, env = process.env) {
  if (typeof intervalMs === 'number' && intervalMs > 0) return intervalMs;
  const raw = env?.HS_HEARTBEAT_INTERVAL_MS;
  if (raw !== undefined && raw !== '') {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return HEARTBEAT_DEFAULT_INTERVAL_MS;
}

/**
 * Build one heartbeat line per in-flight session. STRICTLY filesystem + git:
 * `fs.stat` on session.log for the last-write age, and `git status --short`
 * for a touched-file count. NEVER invokes claude or any heavy probe.
 *
 * Sessions younger than 5 minutes are skipped (no signal yet).
 *
 * @param {RunState} state
 * @param {{ exec?: typeof runProcess, stat?: (p: string) => Promise<{ mtimeMs: number }>, now?: () => number }} [deps]
 * @returns {Promise<string[]>}
 */
export async function collectHeartbeatLines(state, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const stat = deps.stat ?? ((p) => fs.stat(p));
  const now = (deps.now ?? (() => Date.now()))();
  const lines = [];
  for (const [id, s] of Object.entries(state?.sessions ?? {})) {
    if (!s || s.status !== 'in_progress' || !s.startedAt) continue;
    const elapsedMs = now - new Date(s.startedAt).getTime();
    if (elapsedMs < HEARTBEAT_MIN_ELAPSED_MS) continue;

    let logAge = 'no log yet';
    let fileCount = 0;
    if (s.worktreePath) {
      try {
        const st = await stat(path.join(s.worktreePath, 'session.log'));
        if (st && typeof st.mtimeMs === 'number') logAge = formatLogAge(now - st.mtimeMs);
      } catch { /* log not opened yet */ }
      try {
        const r = await exec('git', ['-C', s.worktreePath, 'status', '--short']);
        if (r && r.exitCode === 0) {
          fileCount = (r.stdout || '').split(/\r?\n/).filter(Boolean).length;
        }
      } catch { /* git unavailable — leave count at 0 */ }
    }
    lines.push(`  · ${id} ${Math.floor(elapsedMs / 60000)}m elapsed — log: ${logAge} — ${fileCount} file(s) touched`);
  }
  return lines;
}

// Module-level handle to the active heartbeat so the SIGINT/SIGTERM handler can
// stop it without threading the controller through every call site.
let _activeHeartbeat = null;

/**
 * Start a single repeating heartbeat timer. Returns a controller with `stop()`
 * (idempotent) and `tick()` (the per-interval work, exposed for tests). The
 * timer is `unref`'d so it never keeps the process alive on its own, and is
 * cleared on wave end (caller's `finally`) and on SIGINT (`stopActiveHeartbeat`).
 *
 * @param {() => RunState} getState
 * @param {{ log?: (m: string) => void, exec?: typeof runProcess, stat?: Function, now?: () => number,
 *           intervalMs?: number, env?: NodeJS.ProcessEnv,
 *           setInterval?: typeof setInterval, clearInterval?: typeof clearInterval }} [deps]
 */
export function startHeartbeat(getState, deps = {}) {
  const log = deps.log ?? console.log;
  const intervalMs = resolveHeartbeatInterval(deps.intervalMs, deps.env);
  const setIntervalFn = deps.setInterval ?? setInterval;
  const clearIntervalFn = deps.clearInterval ?? clearInterval;

  const tick = async () => {
    const lines = await collectHeartbeatLines(getState(), { exec: deps.exec, stat: deps.stat, now: deps.now });
    for (const l of lines) log(l);
  };

  const handle = setIntervalFn(() => { tick().catch(() => {}); }, intervalMs);
  if (handle && typeof handle.unref === 'function') handle.unref();

  let stopped = false;
  const controller = {
    tick,
    intervalMs,
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(handle);
      if (_activeHeartbeat === controller) _activeHeartbeat = null;
    },
  };
  _activeHeartbeat = controller;
  return controller;
}

/** Stop whatever heartbeat is currently running (no-op if none). */
export function stopActiveHeartbeat() {
  if (_activeHeartbeat) _activeHeartbeat.stop();
}

// ─── Wave / session execution ────────────────────────────────────────────────

/** @param {RunState} state */
function ensureSessionEntry(state, id) {
  if (!state.sessions[id]) state.sessions[id] = makeEmptySessionState();
  return state.sessions[id];
}

/**
 * Reconcile state against the manifest before running:
 *   - Existing `done` sessions: skip on rerun.
 *   - Existing `failed` / `interrupted` / `in_progress` sessions: force-remove
 *     their worktree (if any) so the next attempt can recreate it cleanly.
 */
export async function reconcileState(state, manifest, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const log = deps.log ?? console.log;
  // #136 defect 7 (broader): opt-out for the stale-branch sweep below.
  const sweepBranches = !process.env.HS_NO_STALE_BRANCH_CLEANUP;
  for (const wave of manifest.waves) {
    if (wave.kind !== 'feature') continue;
    for (const s of wave.sessions) {
      const cur = ensureSessionEntry(state, s.id);
      if (cur.status === 'done') continue;
      if (cur.worktreePath) {
        await worktreeRemove(repoRoot, cur.worktreePath, exec);
      }
      // #136 defect 7 (broader): a prior failed/interrupted session can leave an
      // orphan remote branch + PR — the per-session agent self-opened a PR, or
      // the runner pushed before failing. On a same-runId resume these block the
      // retry: the fresh worktree branches off origin/<base>, so the retry's
      // `git push` to the divergent orphan branch is a non-fast-forward rejection
      // (failing the session BEFORE createOrAdoptPr could adopt it), and orphan
      // PRs accumulate across attempts. Delete the stale remote branch (GitHub
      // closes its orphan PR with it) so the retry's push + PR creation start
      // clean. Best-effort + never throws; opt-out via HS_NO_STALE_BRANCH_CLEANUP.
      // (The in-run agent-self-PR race is still handled by createOrAdoptPr.)
      if (sweepBranches && cur.branch) {
        try {
          const ls = await exec('git', ['ls-remote', '--heads', 'origin', cur.branch], { cwd: repoRoot });
          if (ls.exitCode === 0 && (ls.stdout || '').trim()) {
            const del = await exec('git', ['push', 'origin', '--delete', cur.branch], { cwd: repoRoot });
            if (del.exitCode === 0) {
              log(`  ↻ reconcile: deleted stale remote branch ${cur.branch} (closes any orphan PR) so ${s.id} can retry clean`);
            } else {
              log(`  ⚠ reconcile: could not delete stale remote branch ${cur.branch} (${tailLines(del.stderr, 1)}) — if a retry's push is rejected, delete it manually or set HS_NO_STALE_BRANCH_CLEANUP=1`);
            }
          }
        } catch { /* never let the reconcile sweep crash the run */ }
      }
    }
  }
}

/**
 * Execute a feature wave with Promise.all over sessions.
 * @returns {Promise<{ ok: boolean; failures: Array<{ sessionId: string; state: SessionState; stdoutTail: string }> }>}
 */
export async function runFeatureWave(wave, manifest, state, deps = {}) {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => Date.now());
  // C1-7 (#99): wave-start typical-duration estimate from R2 complexity.
  const est = estimateWaveMinutes(wave.sessions, deps.concurrency?.value);
  const estSuffix = est ? ` — typical ${est.lower}–${est.upper} min` : '';
  log(`\n▶ Feature wave (phase ${wave.phase}) — ${wave.sessions.length} session(s)${estSuffix}`);

  // C1-7 (#99): snapshot wall-clock start + run-total cost BEFORE the wave so
  // the wave-end summary reflects only this wave's spend. Snapshotting (vs
  // re-walking session states) resists resume edge-cases — already-done
  // sessions don't add to totalCostUsd on a rerun, so they aren't counted.
  const waveStart = now();
  const costSnapshot = state.totalCostUsd ?? 0;

  const sessionDeps = {
    ...deps,
    requirements: deps.requirements ?? manifest?.requirements,
    // #120: pass the project-manifest stub (path/lockfile/seedInstallCmd) so the
    // pre-PR reconcile can locate package.json + relock with the right pkg manager.
    projectManifestStub: deps.projectManifestStub ?? manifest?.projectManifestStub,
  };
  // A3 (#87): bounded fan-out. `concurrency` arrives pre-resolved from main();
  // 0/Infinity short-circuits to plain Promise.all (current behavior). Failure
  // containment is still per-session — runSession returns { ok, ... } and never
  // throws — so a bad session can't poison the rest of the wave.
  const limit = deps.concurrency?.value ?? 0;
  // C1-6 (#99): start the per-session heartbeat for the duration of the wave.
  // unref'd + stopped in finally so it never leaks past the wave (or a throw).
  const heartbeat = startHeartbeat(() => state, {
    log,
    exec: deps.exec,
    intervalMs: deps.heartbeatIntervalMs,
    env: deps.env,
  });
  let results;
  try {
    results = await runWithConcurrency(
      wave.sessions,
      s => runSession(s, state, sessionDeps),
      limit,
    );
  } finally {
    heartbeat.stop();
  }
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i].ok) {
      failures.push({
        sessionId: wave.sessions[i].id,
        state: state.sessions[wave.sessions[i].id],
        stdoutTail: results[i].stdoutTail,
      });
    }
  }
  await deps.saveState?.(state);

  // C1-7 (#99): wave-end mini-summary.
  const total = wave.sessions.length;
  const failedCount = failures.length;
  const succeeded = total - failedCount;
  const wall = formatWallClock(now() - waveStart);
  const spent = (state.totalCostUsd ?? 0) - costSnapshot;
  const runTotal = state.totalCostUsd ?? 0;
  const mark = failedCount === 0 ? '✓' : '✗';
  const countStr = failedCount === 0
    ? `${succeeded}/${total} succeeded`
    : `${succeeded}/${total} succeeded · ${failedCount} failed`;
  log(`${mark} Feature wave ${wave.phase} complete — ${countStr} — ${wall} wall clock — $${spent.toFixed(2)} spent (run total $${runTotal.toFixed(2)})`);

  return { ok: failures.length === 0, failures };
}

// ─── #132 B: local fixture-service lifecycle ──────────────────────────────────
//
// The canary surfaced that integration sessions' `test.cmd` (e.g. `npm run
// test:integration`) connects to Postgres/Redis/etc. that NOTHING starts when
// the runner executes locally. CI provisions these via `requirements.services`
// (#125 Item 2: native `services:` + docker-compose.fixtures.yml). This brings
// the SAME services up locally for the runner, so the unattended loop does not
// depend on the operator hand-propping a stack. Everything is driven from the
// manifest's `requirements.services[]` — one runtime compose file covering BOTH
// native- and compose-mechanism services (locally there is no GitHub Actions
// `services:` equivalent, so both go through docker compose).

const FIXTURE_COMPOSE_FILENAME = '.bp-services.compose.yml';

/** In-container health probe per known image family, as a compose `test` array.
 *  Returns null for an unknown image (compose `up --wait` then waits only for
 *  "running", which is usually fine for app-less stores). Mirrors the CI-side
 *  health hints in scaffold-renderer.ts. */
export function composeHealthcheckTest(image) {
  const i = String(image ?? '').toLowerCase();
  if (i.startsWith('postgres')) return ['CMD-SHELL', 'pg_isready'];
  if (i.startsWith('redis')) return ['CMD', 'redis-cli', 'ping'];
  if (i.startsWith('mysql') || i.startsWith('mariadb')) return ['CMD-SHELL', 'mysqladmin ping --silent'];
  if (i.startsWith('mongo')) return ['CMD-SHELL', "mongosh --eval 'db.runCommand({ ping: 1 })' || mongo --eval 'db.runCommand({ ping: 1 })'"];
  return null;
}

/** Services the manifest declares (possibly []). */
export function servicesFromManifest(manifest) {
  return manifest?.requirements?.services ?? [];
}

/**
 * Render a docker-compose document (string) that starts every declared service
 * with a healthcheck where the image family is known — so `docker compose up
 * --wait` blocks until the store actually accepts connections (the canary's
 * Redis race was exactly a missing wait). Returns null when there are no
 * services. Pure given its input (deterministic key order). (#132 B)
 */
export function renderServicesCompose(services) {
  if (!Array.isArray(services) || services.length === 0) return null;
  const lines = [
    '# Generated at RUNTIME by the HyperSpeed runner (#132 B). Do NOT commit.',
    '# Starts the integration fixture services declared in run-manifest.json',
    '# (requirements.services) so local `test.cmd` runs have their backing stores.',
    'services:',
  ];
  for (const svc of services) {
    lines.push(`  ${svc.name}:`);
    lines.push(`    image: ${svc.image}`);
    if (svc.command) lines.push(`    command: ${svc.command}`);
    if (svc.env && Object.keys(svc.env).length) {
      lines.push('    environment:');
      for (const [k, v] of Object.entries(svc.env)) lines.push(`      ${k}: "${v}"`);
    }
    if (svc.ports?.length) {
      lines.push('    ports:');
      for (const p of svc.ports) lines.push(`      - "${p}"`);
    }
    const hc = composeHealthcheckTest(svc.image);
    if (hc) {
      lines.push('    healthcheck:');
      lines.push(`      test: ${JSON.stringify(hc)}`);
      lines.push('      interval: 5s');
      lines.push('      timeout: 5s');
      lines.push('      retries: 20');
    }
  }
  return lines.join('\n') + '\n';
}

// Module-level handle so the SIGINT/SIGTERM trap can tear the stack down (mirrors
// stopActiveHeartbeat). Holds { file, repoRoot, project } while a stack is up.
let activeFixtureServices = null;

/** SIGINT/SIGTERM hook: tear down any running fixture stack. Best-effort. */
export async function stopActiveFixtureServices() {
  if (!activeFixtureServices) return;
  const { file, repoRoot, project } = activeFixtureServices;
  activeFixtureServices = null;
  await stopFixtureServices(file, repoRoot, { project }).catch(() => {});
}

/**
 * Bring the declared fixture services up via docker compose before a wave.
 *
 * Best-effort and FAULT-TOLERANT: never throws. Returns a result the caller can
 * log but does not have to halt on:
 *  - `{ started:false, skipped:true }`  — no services declared, or bypassed via
 *    `HS_SKIP_FIXTURE_SERVICES` (operator runs their own stack, as the canary did).
 *  - `{ started:false, ok:false, reason }` — docker missing or `up` failed. The
 *    wave still runs; the service-dependent tests will surface their own errors.
 *    A loud warning is logged so an unattended run is not silently service-less.
 *  - `{ started:true, ok:true, file, project }` — stack is up; caller MUST pair
 *    with stopFixtureServices in a finally.
 *
 * @returns {Promise<{ started: boolean; ok?: boolean; skipped?: boolean; reason?: string; file?: string; project?: string }>}
 */
export async function startFixtureServices(manifest, repoRoot, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  const env = deps.env ?? process.env;
  const services = servicesFromManifest(manifest);
  if (services.length === 0) return { started: false, skipped: true };
  if (env.HS_SKIP_FIXTURE_SERVICES) {
    log(`  · HS_SKIP_FIXTURE_SERVICES set — assuming fixture services (${services.map(s => s.name).join(', ')}) are already running`);
    return { started: false, skipped: true };
  }
  const content = renderServicesCompose(services);
  const file = path.join(repoRoot, FIXTURE_COMPOSE_FILENAME);
  // Stable project name keeps containers namespaced + lets stop/SIGINT find them.
  const project = 'bp-fixtures';
  if (!(await isBinaryOnPath('docker', exec))) {
    log(`  ⚠ ${services.length} fixture service(s) declared but \`docker\` is not on PATH — ` +
        `service-dependent tests will fail. Install Docker or start the stack manually and set HS_SKIP_FIXTURE_SERVICES=1.`);
    return { started: false, ok: false, reason: 'docker-missing' };
  }
  try {
    await fs.writeFile(file, content, 'utf-8');
  } catch (e) {
    log(`  ⚠ could not write ${FIXTURE_COMPOSE_FILENAME}: ${String(e?.message ?? e)} — skipping fixture services`);
    return { started: false, ok: false, reason: 'write-failed' };
  }
  // #137 Phase 2: idempotent + fresh-DB-per-run. Reconcile any leftover stack
  // from a prior (possibly crashed) run BEFORE bring-up — `down -v` drops the
  // volumes so the DB starts empty (the canary's "relation already exists" on
  // non-idempotent migrations came from a long-lived local container). Then a
  // name-filtered `docker rm -f` sweeps orphaned bp-fixtures* containers the
  // compose project no longer tracks (e.g. a changed compose file). Best-effort.
  await reconcileFixtureStack(file, repoRoot, project, { exec, log });
  log(`  · starting ${services.length} fixture service(s): ${services.map(s => s.name).join(', ')}`);
  const res = await exec('docker', ['compose', '-p', project, '-f', file, 'up', '-d', '--wait'], { cwd: repoRoot });
  if (res.exitCode !== 0) {
    log(`  ⚠ \`docker compose up --wait\` failed (exit ${res.exitCode}) — service-dependent tests may fail:\n${tailLines(res.stderr, 8)}`);
    // Leave the (partially-up) stack for teardown so a half-started container is cleaned.
    activeFixtureServices = { file, repoRoot, project };
    return { started: false, ok: false, reason: 'compose-up-failed', file, project };
  }
  activeFixtureServices = { file, repoRoot, project };
  log(`  ✓ fixture services ready`);
  return { started: true, ok: true, file, project };
}

/**
 * #137 Phase 2: reconcile any leftover fixture stack BEFORE bring-up so a run
 * starts from a clean, deterministic state. (1) `docker compose -p <project>
 * down -v` drops the prior project's containers + volumes (fresh DB per run);
 * (2) a name-filtered `docker rm -f` sweep removes orphaned `bp-fixtures*`
 * containers the compose project no longer tracks. Best-effort + never throws —
 * a reconcile failure is logged and the subsequent `up` surfaces the real error.
 */
export async function reconcileFixtureStack(file, repoRoot, project, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  try {
    await exec('docker', ['compose', '-p', project, '-f', file, 'down', '-v'], { cwd: repoRoot });
  } catch (e) {
    log(`  ⚠ pre-bring-up reconcile (\`compose down -v\`) errored: ${String(e?.message ?? e)} — continuing`);
  }
  try {
    const ps = await exec('docker', ['ps', '-aq', '--filter', `name=${project}`]);
    const ids = (ps.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      log(`  · reconcile: removing ${ids.length} leftover fixture container(s) from a prior run`);
      await exec('docker', ['rm', '-f', ...ids]);
    }
  } catch { /* sweep is best-effort */ }
  return { ok: true };
}

/**
 * #137 Phase 2 (fail-closed): pure decision for what to do after the fixture
 * stack start attempt. Extracted from main() so the invariant is unit-testable.
 *   - 'proceed'      — no services declared, the stack came up, or the operator
 *                      opted out via HS_SKIP_FIXTURE_SERVICES (skipped).
 *   - 'best-effort'  — bring-up failed but HS_FIXTURES_BEST_EFFORT restores the
 *                      old warn-and-continue behavior (power-user override).
 *   - 'fail-closed'  — services declared + bring-up failed + no override: HALT,
 *                      so a service-dependent test never runs against a stack
 *                      that never started (the non-determinism #138 tenet 1
 *                      rejects).
 *
 * @param {{ started?: boolean, skipped?: boolean }} fixtureRes
 * @param {boolean} servicesDeclared
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'proceed' | 'best-effort' | 'fail-closed'}
 */
export function classifyFixtureStartup(fixtureRes, servicesDeclared, env = process.env) {
  if (!servicesDeclared) return 'proceed';
  if (fixtureRes?.started === true || fixtureRes?.skipped === true) return 'proceed';
  // started !== true and not skipped → the stack genuinely failed to come up.
  return env.HS_FIXTURES_BEST_EFFORT ? 'best-effort' : 'fail-closed';
}

/**
 * Tear the fixture stack down (`docker compose down -v`, removing volumes for a
 * clean slate next wave). Best-effort: never throws, logs a warning on failure.
 * Removes the runtime compose file. (#132 B)
 */
export async function stopFixtureServices(file, repoRoot, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  const project = deps.project ?? 'bp-fixtures';
  if (!file) return { ok: true };
  try {
    const res = await exec('docker', ['compose', '-p', project, '-f', file, 'down', '-v'], { cwd: repoRoot });
    if (res.exitCode !== 0) {
      log(`  ⚠ \`docker compose down\` failed (exit ${res.exitCode}) — leftover containers may need \`docker compose -p ${project} down -v\`:\n${tailLines(res.stderr, 4)}`);
    }
  } catch (e) {
    log(`  ⚠ fixture teardown error: ${String(e?.message ?? e)}`);
  } finally {
    if (activeFixtureServices && activeFixtureServices.file === file) activeFixtureServices = null;
    await fs.rm(file, { force: true }).catch(() => {});
  }
  return { ok: true };
}

/**
 * Execute an integration wave: a single command run.
 * @returns {Promise<{ ok: boolean; exitCode: number; stdoutTail: string }>}
 */
export async function runIntegrationWave(wave, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  log(`\n▶ Integration gate (${wave.phase}) — ${wave.test.cmd}`);
  // Execute via shell to honor compound commands in test.cmd (e.g. `npm run test:integration`).
  const [cmd, ...args] = parseShellCmd(wave.test.cmd);
  const res = await exec(cmd, args, { cwd: repoRoot });
  return {
    ok: res.exitCode === 0,
    exitCode: res.exitCode,
    stdoutTail: tailLines(res.stdout + '\n' + res.stderr),
  };
}

/**
 * #115: resolve the auto-merge wait timeout (ms). HS_AUTOMERGE_TIMEOUT_MS
 * overrides the 20-minute default; values <= 0 are ignored (fall back to default).
 */
export function resolveAutoMergeTimeoutMs(env = process.env) {
  const raw = env.HS_AUTOMERGE_TIMEOUT_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20 * 60 * 1000;
}

/**
 * #115: wait for the auto-merge-enabled PRs of a finished feature wave to
 * actually land, so the following integration gate / next wave runs against the
 * merged base instead of stale code.
 *
 * Polls `gh pr view <url> --json state,mergeStateStatus` for each PR until all
 * reach a terminal state:
 *   - MERGED                       → landed.
 *   - CLOSED (not merged)          → hard failure (CI red / auto-merge cancelled).
 *   - state OPEN + DIRTY           → conflicting (#120): the branch can no longer
 *                                    merge cleanly (a sibling merged a conflicting
 *                                    package.json first). Surfaced in `dirty[]` so
 *                                    the caller can auto-recover it — and we stop
 *                                    waiting on it rather than eating the timeout.
 *   - anything else (UNKNOWN/BLOCKED/UNSTABLE/BEHIND/CLEAN) → still pending; keep
 *                                    polling (CI running, mergeability not computed
 *                                    yet, or queued behind required checks).
 * Bounded by `timeoutMs`; on timeout the still-pending PRs are reported.
 *
 * @param {string[]} prUrls  PR URLs/numbers with auto-merge enabled.
 * @param {{ exec?: Function; log?: Function; sleep?: Function; now?: Function;
 *           timeoutMs?: number; pollIntervalMs?: number }} deps
 * @returns {Promise<{ ok: boolean; merged: string[]; pending: string[]; closed: string[]; dirty: string[] }>}
 */
export async function waitForAutoMerges(prUrls, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  const sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? resolveAutoMergeTimeoutMs();
  const pollIntervalMs = deps.pollIntervalMs ?? 15_000;

  const pending = new Set(prUrls.filter(Boolean));
  const merged = [];
  const closed = [];
  const dirty = [];
  if (pending.size === 0) return { ok: true, merged, pending: [], closed, dirty };

  log(`\n⏳ Waiting for ${pending.size} auto-merge PR(s) to land before advancing…`);
  const start = now();
  // Poll once immediately, then on the interval, until empty or timed out.
  for (;;) {
    for (const url of [...pending]) {
      // #136 defect 2: scope to the build repo (a PR URL is absolute, but keep
      // cwd/-R consistent so gh never falls back to a different cwd repo).
      const res = await exec('gh', ghArgsFor(['pr', 'view', url, '--json', 'state,mergeStateStatus'], deps.repo ?? RESOLVED_REPO), { cwd: deps.repoRoot ?? REPO_ROOT });
      let state = '', mergeState = '';
      try {
        const j = JSON.parse(res.stdout || '{}');
        state = (j.state || '').toUpperCase();
        mergeState = (j.mergeStateStatus || '').toUpperCase();
      } catch { /* transient gh / parse error → treat as still pending */ }
      if (state === 'MERGED') {
        pending.delete(url); merged.push(url);
        log(`  ✓ merged: ${url}`);
      } else if (state === 'CLOSED') {
        pending.delete(url); closed.push(url);
        log(`  ✗ closed without merging: ${url}`);
      } else if (state === 'OPEN' && mergeState === 'DIRTY') {
        pending.delete(url); dirty.push(url);
        log(`  ⚠ conflicting (cannot auto-merge): ${url}`);
      }
    }
    if (pending.size === 0) break;
    if (now() - start >= timeoutMs) break;
    await sleep(pollIntervalMs);
  }

  return {
    ok: pending.size === 0 && closed.length === 0 && dirty.length === 0,
    merged,
    pending: [...pending],
    closed,
    dirty,
  };
}

/**
 * #115: fast-forward the local base branch to origin after auto-merges land, so
 * the next wave's worktrees (which branch off the LOCAL base) and the local
 * integration gate both see the merged code. Best-effort: a failure is logged
 * but never throws — the caller treats it as a warning (a non-ff divergence
 * means someone pushed to base out of band; the operator should reconcile).
 *
 * @param {{ exec?: Function; log?: Function; repoRoot?: string; baseBranch?: string }} deps
 * @returns {Promise<{ ok: boolean; stderr?: string }>}
 */
export async function syncBaseBranch(deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const baseBranch = deps.baseBranch ?? process.env.HS_BASE_BRANCH ?? 'main';

  const fetchRes = await exec('git', ['fetch', 'origin', baseBranch], { cwd: repoRoot });
  if (fetchRes.exitCode !== 0) {
    log(`  ⚠ could not fetch origin/${baseBranch}: ${tailLines(fetchRes.stderr, 3)}`);
    return { ok: false, stderr: fetchRes.stderr };
  }
  const mergeRes = await exec('git', ['merge', '--ff-only', `origin/${baseBranch}`], { cwd: repoRoot });
  if (mergeRes.exitCode !== 0) {
    log(`  ⚠ could not fast-forward local ${baseBranch} to origin/${baseBranch}: ${tailLines(mergeRes.stderr, 3)} — reconcile manually before the next wave`);
    return { ok: false, stderr: mergeRes.stderr };
  }
  log(`  ✓ local ${baseBranch} synced to origin/${baseBranch}`);
  return { ok: true };
}

// ─── #120: pre-PR reconcile with the latest base + smart dependency merge ──────

/** The package.json sections whose entries are merged as a key-union 3-way. */
const PKG_DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'scripts'];

/**
 * 3-way merge of a flat string→string map (a package.json dependency/scripts
 * section). For each key across base ∪ ours ∪ theirs:
 *   - unchanged on one side  → take the changed side
 *   - changed identically    → take it
 *   - changed differently    → CONFLICT; prefer `ours` (the session intentionally
 *                              set it) and record the key for visibility
 *   - deleted on one side, untouched on the other → respect the deletion
 * A missing key is represented as `undefined` so additions/deletions merge cleanly.
 * @returns {{ result: Record<string,string>; conflicts: string[] }}
 */
function mergeDepSection(base = {}, ours = {}, theirs = {}) {
  const result = {};
  const conflicts = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const k of keys) {
    const b = base[k], o = ours[k], t = theirs[k];
    let chosen;
    if (o === t) chosen = o;            // same on both sides (incl. both-deleted → undefined)
    else if (o === b) chosen = t;       // ours unchanged → take theirs (incl. theirs-deleted)
    else if (t === b) chosen = o;       // theirs unchanged → take ours
    else { chosen = o; conflicts.push(k); } // genuine divergence → prefer ours, flag it
    if (chosen !== undefined) result[k] = chosen;
  }
  return { result, conflicts };
}

/**
 * 3-way merge two package.json objects against their common ancestor, unioning
 * dependency/script sections so neither side's added packages are dropped (the
 * exact failure #120 describes when a blind `--ours` is used). Non-dependency
 * top-level keys are merged with the same unchanged-side-wins rule, preferring
 * `ours` on a genuine conflict.
 *
 * @param {object} base   common-ancestor package.json (stage :1:)
 * @param {object} ours   the session's package.json (stage :2:)
 * @param {object} theirs base branch's package.json (stage :3:)
 * @returns {{ merged: object; conflicts: string[] }}
 */
export function mergePackageJsonObjects(base = {}, ours = {}, theirs = {}) {
  const merged = {};
  const conflicts = [];
  const topKeys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const key of topKeys) {
    if (PKG_DEP_SECTIONS.includes(key)) {
      const { result, conflicts: c } = mergeDepSection(base[key], ours[key], theirs[key]);
      if (Object.keys(result).length) merged[key] = result;
      for (const k of c) conflicts.push(`${key}.${k}`);
      continue;
    }
    const b = JSON.stringify(base[key]);
    const o = JSON.stringify(ours[key]);
    const t = JSON.stringify(theirs[key]);
    let chosen;
    if (o === t) chosen = ours[key];
    else if (o === b) chosen = theirs[key];
    else if (t === b) chosen = ours[key];
    else { chosen = ours[key]; conflicts.push(key); }
    if (chosen !== undefined) merged[key] = chosen;
  }
  return { merged, conflicts };
}

// ─── #125 Item 1: ecosystem-keyed pyproject merge ──────────────────────────────

function _getPath(obj, p) { return p.reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, obj); }
function _setPath(obj, p, val) {
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) {
    if (!o[p[i]] || typeof o[p[i]] !== 'object') o[p[i]] = {};
    o = o[p[i]];
  }
  o[p[p.length - 1]] = val;
}
function _clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

/**
 * #125 Item 1 — 3-way merge two pyproject.toml objects against their common
 * ancestor, unioning every dependency location so neither side's added packages
 * are dropped (the python analog of mergePackageJsonObjects). Covers Poetry
 * table form (`[tool.poetry.dependencies]`, dev + group deps) and PEP 621 array
 * form (`[project] dependencies` / `optional-dependencies`). Non-dependency
 * fields are preserved from `ours` (the session). On a genuine version clash the
 * session wins and the dotted key path is reported.
 *
 * @returns {{ merged: object; conflicts: string[] }}
 */
export function mergePyprojectToml(base = {}, ours = {}, theirs = {}) {
  const merged = _clone(ours) || {};
  const conflicts = [];

  // Table-form dep sections (poetry).
  const tablePaths = [['tool', 'poetry', 'dependencies'], ['tool', 'poetry', 'dev-dependencies']];
  const groupNames = new Set();
  for (const side of [base, ours, theirs]) {
    const groups = _getPath(side, ['tool', 'poetry', 'group']);
    if (groups && typeof groups === 'object') for (const g of Object.keys(groups)) groupNames.add(g);
  }
  for (const g of groupNames) tablePaths.push(['tool', 'poetry', 'group', g, 'dependencies']);

  for (const p of tablePaths) {
    const b = _getPath(base, p) || {}, o = _getPath(ours, p) || {}, t = _getPath(theirs, p) || {};
    if (!Object.keys(b).length && !Object.keys(o).length && !Object.keys(t).length) continue;
    const { result, conflicts: c } = mergeDepSection(b, o, t);
    _setPath(merged, p, result);
    for (const k of c) conflicts.push(`${p.join('.')}.${k}`);
  }

  // Array-form (PEP 621): project.dependencies + optional-dependencies.<group>.
  const arrayPaths = [['project', 'dependencies']];
  const optNames = new Set();
  for (const side of [base, ours, theirs]) {
    const opt = _getPath(side, ['project', 'optional-dependencies']);
    if (opt && typeof opt === 'object') for (const g of Object.keys(opt)) optNames.add(g);
  }
  for (const g of optNames) arrayPaths.push(['project', 'optional-dependencies', g]);

  for (const p of arrayPaths) {
    const toMap = arr => { const m = {}; for (const s of (arr || [])) { const n = pep508Name(s); if (n) m[n] = s; } return m; };
    const b = toMap(_getPath(base, p)), o = toMap(_getPath(ours, p)), t = toMap(_getPath(theirs, p));
    if (!Object.keys(b).length && !Object.keys(o).length && !Object.keys(t).length) continue;
    const { result, conflicts: c } = mergeDepSection(b, o, t);
    _setPath(merged, p, Object.values(result));
    for (const k of c) conflicts.push(`${p.join('.')}.${k}`);
  }

  return { merged, conflicts };
}

/** Line-union merge of a bare requirements.txt (lockless). Keyed by distribution
 *  name; the session wins a genuine version clash. */
export function mergeRequirementsTxt(baseRaw, oursRaw, theirsRaw) {
  const toMap = raw => {
    const m = {};
    for (const line of (raw || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('-')) continue;
      const n = pep508Name(t);
      if (n) m[n] = t;
    }
    return m;
  };
  const { result, conflicts } = mergeDepSection(toMap(baseRaw), toMap(oursRaw), toMap(theirsRaw));
  return { content: Object.values(result).join('\n') + '\n', conflicts: conflicts.map(k => `requirements.txt.${k}`) };
}

/** Line-union merge of a Gemfile (#144, Ruby ecosystem). Keyed by gem name; the
 *  session (ours) wins a genuine version clash. Preserves ours' structure and
 *  source/ruby/group lines verbatim, inserting only the gems a sibling added that
 *  ours lacks — so a sibling's just-merged gem is never dropped (the #120 hazard,
 *  generalized to Ruby). A Gemfile is Ruby DSL, not a structured format, so this
 *  is deliberately line-oriented like mergeRequirementsTxt rather than a parse. */
export function mergeGemfile(baseRaw, oursRaw, theirsRaw) {
  const gemName = (line) => {
    const m = String(line).match(/^\s*gem\s+['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  };
  const toMap = raw => {
    const m = {};
    for (const line of (raw || '').split(/\r?\n/)) {
      const n = gemName(line);
      if (n) m[n] = line.trim();
    }
    return m;
  };
  const oMap = toMap(oursRaw);
  const { result, conflicts } = mergeDepSection(toMap(baseRaw), oMap, toMap(theirsRaw));

  // Gems the union added that ours does not already declare (a sibling's new gem).
  const added = Object.entries(result).filter(([name]) => !(name in oMap)).map(([, line]) => line);

  let content;
  if (added.length === 0) {
    content = (oursRaw || '').endsWith('\n') ? (oursRaw || '') : (oursRaw || '') + '\n';
  } else {
    const lines = (oursRaw || '').split(/\r?\n/);
    let lastGem = -1;
    for (let i = 0; i < lines.length; i++) if (gemName(lines[i])) lastGem = i;
    if (lastGem >= 0) lines.splice(lastGem + 1, 0, ...added);
    else lines.push(...added);
    content = lines.join('\n');
    if (!content.endsWith('\n')) content += '\n';
  }
  return { content, conflicts: conflicts.map(k => `Gemfile.${k}`) };
}

/** Merge a manifest conflict at the file-content level, dispatched by ecosystem.
 *  Returns null when the (ecosystem, manifest) pair has no smart merge. */
export function mergeManifestContent(ecosystem, pkgPath, baseRaw, oursRaw, theirsRaw) {
  if (ecosystem === 'node') {
    const parse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
    const { merged, conflicts } = mergePackageJsonObjects(parse(baseRaw), parse(oursRaw), parse(theirsRaw));
    return { content: JSON.stringify(merged, null, 2) + '\n', conflicts };
  }
  if (ecosystem === 'python' && /pyproject\.toml$/i.test(pkgPath)) {
    const parse = s => { try { return getToml().parse(s || ''); } catch { return {}; } };
    const { merged, conflicts } = mergePyprojectToml(parse(baseRaw), parse(oursRaw), parse(theirsRaw));
    return { content: getToml().stringify(merged) + '\n', conflicts };
  }
  if (ecosystem === 'python' && /requirements\.txt$/i.test(pkgPath)) {
    return mergeRequirementsTxt(baseRaw, oursRaw, theirsRaw);
  }
  if (ecosystem === 'ruby' && /Gemfile$/i.test(pkgPath)) {
    return mergeGemfile(baseRaw, oursRaw, theirsRaw);
  }
  return null;
}

/**
 * Resolve the ecosystem, manifest path, lockfile, and relock command for a
 * session's worktree. #144 Decision A: the ecosystem is READ from the manifest
 * stub (`stub.ecosystem`, decided by the generator's adapter); the legacy
 * path-derivation is a fallback for manifests emitted before the field existed.
 * `node`/`python`/`ruby` get smart dependency-union reconciliation; any other
 * manifest (`go.mod`, `Cargo.toml`) has no smart merge so reconcile aborts on
 * conflict rather than mis-merging. Prefers the projectManifestStub (#109), else
 * the declared runtime, then probes the worktree for the lockfile.
 *
 * @returns {Promise<{ ecosystem: 'node'|'python'|'ruby'|string|null; pkgPath: string; lockfile: string|null; relockCmd: string }>}
 */
export async function resolveManifestInfo(deps, worktreePath, exec) {
  const stub = deps.projectManifestStub;
  const runtimeNames = (deps.requirements?.runtimes ?? []).map(r => (r?.name || '').toLowerCase());

  // #144 Decision A — legacy fallback ONLY. New manifests carry an explicit
  // `stub.ecosystem` (the generator's adapter decided it); the runner reads that
  // instead of re-deriving. This path survives for back-compat with manifests
  // emitted before the field existed. Recognizes the ecosystems with a smart
  // reconcile merge (node/python/ruby); others → null (reconcile aborts on
  // conflict rather than mis-merging).
  const ecoFromPath = (p) => {
    if (/(^|[\\/])package\.json$/i.test(p)) return 'node';
    if (/(^|[\\/])pyproject\.toml$/i.test(p)) return 'python';
    if (/(^|[\\/])requirements\.txt$/i.test(p)) return 'python';
    if (/(^|[\\/])Gemfile$/i.test(p)) return 'ruby';
    return null; // go.mod / Cargo.toml → unsupported (no smart merge)
  };

  let ecosystem, pkgPath;
  let lockfile = null, relockCmd = null;
  if (stub && stub.path) {
    // Read the baked ecosystem fact; fall back to path-derivation for legacy manifests.
    ecosystem = stub.ecosystem ?? ecoFromPath(stub.path);
    pkgPath = stub.path;
    lockfile = stub.lockfile ?? null;
    relockCmd = stub.seedInstallCmd ?? null;
    if (ecosystem === null) {
      return { ecosystem: null, pkgPath, lockfile, relockCmd: relockCmd || '' };
    }
  } else if (runtimeNames.includes('node')) {
    ecosystem = 'node'; pkgPath = 'package.json';
  } else if (runtimeNames.includes('python')) {
    ecosystem = 'python'; pkgPath = 'pyproject.toml';
  } else {
    return { ecosystem: null, pkgPath: 'package.json', lockfile: null, relockCmd: '' };
  }

  // Probe the worktree for lock/relock details ONLY when no stub pinned them —
  // an explicit stub (even with `lockfile: null`) is authoritative, so we never
  // call git in that case.
  if (ecosystem === 'node') {
    if (!stub && (!lockfile || !relockCmd)) {
      const probes = [
        ['pnpm-lock.yaml', 'pnpm install'],
        ['yarn.lock', 'yarn install'],
        ['bun.lockb', 'bun install'],
        ['package-lock.json', 'npm install'],
      ];
      for (const [lf, cmd] of probes) {
        const present = await exec('git', ['cat-file', '-e', `HEAD:${lf}`], { cwd: worktreePath });
        if (present.exitCode === 0) { lockfile = lockfile ?? lf; relockCmd = relockCmd ?? cmd; break; }
      }
    }
    lockfile = lockfile ?? 'package-lock.json';
    relockCmd = relockCmd ?? 'npm install';
  } else if (ecosystem === 'python') {
    if (!stub && !lockfile) {
      const present = await exec('git', ['cat-file', '-e', 'HEAD:poetry.lock'], { cwd: worktreePath });
      if (present.exitCode === 0) lockfile = 'poetry.lock';
    }
    if (!relockCmd) relockCmd = lockfile === 'poetry.lock' ? 'poetry lock --no-update' : '';
  }
  return { ecosystem, pkgPath, lockfile, relockCmd };
}

/**
 * Back-compat adapter for the pre-#125 node-only signature. Smart dep-merge used
 * to be node-scoped; callers/tests that only care whether the project is node
 * still work. New code should prefer resolveManifestInfo (ecosystem-keyed).
 * @returns {Promise<{ isNode: boolean; pkgPath: string; lockfile: string|null; relockCmd: string }>}
 */
export async function resolveNodeManifestInfo(deps, worktreePath, exec) {
  const info = await resolveManifestInfo(deps, worktreePath, exec);
  return { isNode: info.ecosystem === 'node', pkgPath: info.pkgPath, lockfile: info.lockfile, relockCmd: info.relockCmd };
}

/**
 * #120: bring a session's worktree up to date with the LATEST base before
 * opening its PR, merging package.json dependency sections from both sides so a
 * sibling's just-merged deps are never dropped (which previously made the
 * integration gate fail with missing packages after a blind `--ours`).
 *
 * Uses `git merge --no-commit` (not rebase): PRs are squash-merged so the merge
 * commit is erased, and merge gives a single clean resolution with intuitive
 * stage order (:2: ours = session, :3: theirs = base) instead of rebase's
 * per-commit replay + swapped stages.
 *
 * Behaviour:
 *   - Not behind origin/<base>           → no-op, { ok:true, merged:false }.
 *   - Clean merge                        → relock + commit, { merged:true }.
 *   - Conflict only in manifest/lockfile → 3-way dep-merge + relock + commit
 *                                          (node/python/ruby, ecosystem-keyed).
 *   - Conflict in any other file         → abort + fail (true ownership clash).
 *   - Manifest conflict, no smart merge  → abort + fail (e.g. go/rust — honest,
 *                                          never a silent mis-merge).
 *
 * @returns {Promise<{ ok: boolean; merged: boolean; error?: string; output?: string; conflicts?: string[] }>}
 */
export async function reconcileWorktreeWithBase(sessionEntry, worktreePath, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? (() => {});
  const baseBranch = deps.baseBranch ?? process.env.HS_BASE_BRANCH ?? 'main';
  const id = sessionEntry.id;

  const fetchRes = await exec('git', ['fetch', 'origin', baseBranch], { cwd: worktreePath });
  if (fetchRes.exitCode !== 0) {
    // Can't see the latest base — proceed without reconciling (best-effort, like
    // worktreeAdd's fetch). A real conflict would surface at auto-merge instead.
    log(`    ⚠ ${id}: \`git fetch origin ${baseBranch}\` failed before reconcile — skipping (${tailLines(fetchRes.stderr, 2)})`);
    return { ok: true, merged: false };
  }

  // Behind check: nothing to do if the branch already contains origin/<base>.
  const behind = await exec('git', ['rev-list', '--count', `HEAD..origin/${baseBranch}`], { cwd: worktreePath });
  const behindCount = parseInt((behind.stdout || '').trim(), 10) || 0;
  if (behindCount === 0) return { ok: true, merged: false };

  log(`    ↻ ${id}: base advanced ${behindCount} commit(s) — reconciling worktree with origin/${baseBranch}`);
  const mergeEnv = { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' };
  const mergeRes = await exec('git', ['merge', '--no-commit', '--no-edit', `origin/${baseBranch}`],
    { cwd: worktreePath, env: { ...process.env, ...mergeEnv } });

  const abortAndFail = async (error, output) => {
    await exec('git', ['merge', '--abort'], { cwd: worktreePath });
    return { ok: false, merged: false, error, output };
  };

  const { ecosystem, pkgPath, lockfile, relockCmd } = await resolveManifestInfo(deps, worktreePath, exec);

  if (mergeRes.exitCode !== 0) {
    // Conflicts. Only the manifest + lockfile are auto-resolvable, and only for a
    // supported ecosystem (node + python + ruby). Anything else aborts (true clash).
    const unmerged = await exec('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: worktreePath });
    const conflicted = (unmerged.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const resolvable = new Set([pkgPath, lockfile].filter(Boolean));
    const unresolvable = conflicted.filter(f => !resolvable.has(f));
    if (!ecosystem || unresolvable.length > 0) {
      return abortAndFail(
        `reconcile with origin/${baseBranch} hit unresolvable conflict(s): ${(unresolvable.length ? unresolvable : conflicted).join(', ')}`,
        tailLines((mergeRes.stdout || '') + '\n' + (mergeRes.stderr || '')),
      );
    }
    // Manifest conflict → ecosystem-keyed 3-way dependency union.
    if (conflicted.includes(pkgPath)) {
      const readRaw = async (stage) => {
        const r = await exec('git', ['show', `:${stage}:${pkgPath}`], { cwd: worktreePath });
        return r.exitCode === 0 ? (r.stdout || '') : '';
      };
      const [baseRaw, oursRaw, theirsRaw] = await Promise.all([readRaw(1), readRaw(2), readRaw(3)]);
      const merge = mergeManifestContent(ecosystem, pkgPath, baseRaw, oursRaw, theirsRaw);
      if (!merge) {
        return abortAndFail(
          `reconcile with origin/${baseBranch}: no smart merge for ${ecosystem} manifest ${pkgPath}`,
          tailLines((mergeRes.stdout || '') + '\n' + (mergeRes.stderr || '')),
        );
      }
      await fs.writeFile(path.join(worktreePath, pkgPath), merge.content, 'utf-8');
      await exec('git', ['add', '--', pkgPath], { cwd: worktreePath });
      if (merge.conflicts.length) {
        log(`    ↻ ${id}: merged ${pkgPath} deps; kept session's version on ${merge.conflicts.length} conflicting key(s): ${merge.conflicts.join(', ')}`);
      } else {
        log(`    ↻ ${id}: merged ${pkgPath} deps from both sides (union)`);
      }
    }
  }

  // Relock + finalize. After a merge (clean OR resolved), git's line-merge of the
  // lockfile is unreliable, so regenerate it from the merged manifest and stage
  // both. `relockCmd` is an install/lock (NOT `npm ci`) so it tolerates the edit.
  // Lockless ecosystems (bare requirements.txt → no lockfile) skip relock.
  if (ecosystem && relockCmd && lockfile) {
    const [rc, ...ra] = parseShellCmd(relockCmd);
    const relock = await exec(rc, ra, { cwd: worktreePath });
    if (relock.exitCode !== 0) {
      return abortAndFail(
        `reconcile relock (\`${relockCmd}\`) failed after merging origin/${baseBranch}`,
        tailLines((relock.stdout || '') + '\n' + (relock.stderr || '')),
      );
    }
    await exec('git', ['add', '--', pkgPath], { cwd: worktreePath });
    if (lockfile) await exec('git', ['add', '--', lockfile], { cwd: worktreePath });
  }

  const commitRes = await exec('git',
    ['-c', 'user.email=hyperspeed-runner@local', '-c', 'user.name=hyperspeed-runner',
     'commit', '--no-edit'],
    { cwd: worktreePath, env: { ...process.env, ...mergeEnv } });
  if (commitRes.exitCode !== 0) {
    return abortAndFail(
      `reconcile commit failed after merging origin/${baseBranch}`,
      tailLines((commitRes.stdout || '') + '\n' + (commitRes.stderr || '')),
    );
  }
  return { ok: true, merged: true };
}

/**
 * #120 hardening: auto-recover a PR that GitHub marked DIRTY (conflicting) so it
 * can no longer auto-merge — the residual case where same-wave sessions complete
 * simultaneously, so the pre-PR reconcile was a no-op and the conflict surfaced
 * only after a sibling merged. Re-create a worktree on the EXISTING pushed
 * session branch, reconcile it with the latest base (the same union dep-merge),
 * push the reconciling commit, and re-arm auto-merge. CI re-runs on the push
 * (#114) and auto-merge fires once green.
 *
 * Returns { ok:false } when reconcile hits a true (non-manifest) conflict — that
 * is a genuine ownership clash only a human can resolve, so the wave fails loudly.
 *
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
export async function recoverConflictedPr(sessionEntry, state, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const log = deps.log ?? console.log;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const baseBranch = deps.baseBranch ?? process.env.HS_BASE_BRANCH ?? 'main';
  const id = sessionEntry.id;
  const branch = state.sessions[id]?.branch ?? `bp/${state.runId}/${id}`;
  const prUrl = state.sessions[id]?.prUrl ?? branch;
  const worktreePath = path.join(repoRoot, '.bp-worktrees', state.runId, `${id}-recover`);

  log(`  ↻ recovering conflicting PR for ${id} (${prUrl})`);
  const fetchRes = await exec('git', ['fetch', 'origin', branch], { cwd: repoRoot });
  if (fetchRes.exitCode !== 0) {
    return { ok: false, error: `recover ${id}: \`git fetch origin ${branch}\` failed: ${tailLines(fetchRes.stderr, 2)}` };
  }
  // Check out the EXISTING pushed branch (not the base) into a fresh worktree.
  const wt = await exec('git', ['worktree', 'add', '-B', branch, worktreePath, `origin/${branch}`], { cwd: repoRoot });
  if (wt.exitCode !== 0) {
    return { ok: false, error: `recover ${id}: worktree add failed: ${tailLines(wt.stderr, 3)}` };
  }
  try {
    const reconcile = await reconcileWorktreeWithBase(sessionEntry, worktreePath, {
      exec, log, baseBranch, requirements: deps.requirements, projectManifestStub: deps.projectManifestStub,
    });
    if (!reconcile.ok) {
      return { ok: false, error: `recover ${id}: ${reconcile.error}` };
    }
    const push = await exec('git', ['push', 'origin', branch], { cwd: worktreePath });
    if (push.exitCode !== 0) {
      return { ok: false, error: `recover ${id}: push failed: ${tailLines(push.stderr, 3)}` };
    }
    // Re-arm auto-merge (idempotent — a no-op if GitHub kept it enabled).
    await ghWithBackoff(['pr', 'merge', '--auto', '--squash', prUrl], { exec });
    log(`  ↻ recovered ${id}: reconciled with ${baseBranch}, re-pushed, auto-merge re-armed`);
    return { ok: true };
  } finally {
    await worktreeRemove(repoRoot, worktreePath, exec);
  }
}

/**
 * #120 hardening: wait for a wave's auto-merge PRs, auto-recovering any that go
 * DIRTY, until everything merges or a hard failure occurs. Recovery is bounded
 * (`maxRecoveryRounds`, default 3) and opt-out via `HS_NO_AUTOMERGE_RECOVERY=1`.
 *
 * `deps.recover(url) → {ok}` resolves one DIRTY PR (the main loop injects a
 * closure that maps url→session and calls recoverConflictedPr). `deps.waitFn`
 * defaults to waitForAutoMerges and is injectable for tests.
 *
 * @returns {Promise<{ ok, merged, pending, closed, dirty }>}
 */
export async function resolveWaveAutoMerges(prUrls, deps = {}) {
  const log = deps.log ?? console.log;
  const waitFn = deps.waitFn ?? waitForAutoMerges;
  const recover = deps.recover;
  const recoveryEnabled = deps.recoveryEnabled ?? (process.env.HS_NO_AUTOMERGE_RECOVERY !== '1');
  const maxRounds = deps.maxRecoveryRounds ?? 3;

  let wait = await waitFn(prUrls, deps);
  let round = 0;
  while (!wait.ok && wait.dirty.length > 0 && wait.closed.length === 0
         && recover && recoveryEnabled && round < maxRounds) {
    round++;
    log(`\n↻ auto-recovering ${wait.dirty.length} conflicting PR(s) (round ${round}/${maxRounds})…`);
    const stillBad = [];
    for (const url of wait.dirty) {
      const rec = await recover(url);
      if (!rec || !rec.ok) stillBad.push(url);
    }
    if (stillBad.length > 0) {
      // A PR could not be auto-recovered (true conflict / push failure) — stop.
      return { ...wait, ok: false, dirty: stillBad };
    }
    // Re-wait on the just-recovered PRs (they should now go CLEAN → MERGED).
    wait = await waitFn(wait.dirty, deps);
  }
  return wait;
}

/** Naive shell tokenizer: handles unquoted args + simple "double quoted" args. Sufficient for npm/pnpm/yarn commands. */
export function parseShellCmd(cmd) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) tokens.push(m[1] ?? m[2]);
  return tokens;
}

/**
 * #125 Item 4: resolve the directory the independent test runs from. Defaults to
 * the worktree root; a brief's `test.cwd` (worktree-relative) selects a monorepo
 * subdirectory so `test.cmd` never needs a `cd …` prefix (which the shell:false
 * spawn cannot honor). `path.join` keeps the result anchored under the worktree.
 * @returns {string} absolute path
 */
export function resolveTestCwd(worktreePath, sessionEntry) {
  const root = path.resolve(worktreePath);
  const sub = sessionEntry?.test?.cwd;
  if (typeof sub !== 'string' || !sub.trim()) return root;
  const resolved = path.resolve(root, sub);
  // Clamp: a `../`-laden cwd must never escape the worktree. On any attempt to
  // break out, fall back to the worktree root rather than running elsewhere.
  if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  return root;
}

// ─── #125 TOML support (vendored smol-toml) ────────────────────────────────────

let _tomlMod = null;
/** Lazily load the vendored TOML parser (smol-toml CJS bundle). */
export function getToml() {
  if (!_tomlMod) _tomlMod = _require('./lib/smol-toml.cjs');
  return _tomlMod;
}

/** Strip the version/marker tail off a PEP 508 requirement string, leaving the
 *  bare distribution name (e.g. "fastapi>=0.100 ; python_version>'3.9'" → "fastapi"). */
function pep508Name(spec) {
  const s = String(spec || '').trim();
  const m = /^[A-Za-z0-9._-]+/.exec(s);
  return m ? m[0] : '';
}

/**
 * Parse a pyproject.toml string and return every declared distribution name
 * across Poetry (`[tool.poetry.dependencies]` + group deps) and PEP 621
 * (`[project] dependencies` / `optional-dependencies`). Excludes the implicit
 * `python` constraint. Returns [] on a parse error (caller treats as unreadable).
 */
export function readPyprojectDepNames(raw) {
  let doc;
  try { doc = getToml().parse(raw); } catch { return []; }
  const names = new Set();

  const poetry = doc?.tool?.poetry;
  if (poetry) {
    for (const k of Object.keys(poetry.dependencies || {})) if (k.toLowerCase() !== 'python') names.add(k);
    const groups = poetry.group || {};
    for (const g of Object.values(groups)) for (const k of Object.keys(g?.dependencies || {})) {
      if (k.toLowerCase() !== 'python') names.add(k);
    }
    for (const k of Object.keys(poetry['dev-dependencies'] || {})) if (k.toLowerCase() !== 'python') names.add(k);
  }

  const project = doc?.project;
  if (project) {
    for (const dep of project.dependencies || []) { const n = pep508Name(dep); if (n) names.add(n); }
    const opt = project['optional-dependencies'] || {};
    for (const arr of Object.values(opt)) for (const dep of arr || []) { const n = pep508Name(dep); if (n) names.add(n); }
  }

  return [...names];
}

/**
 * Execute a single session: worktree → claude → test → PR.
 *
 * A4 (#88): per-session log file at <worktreePath>/session.log.
 * Created after the worktree is ready; closed (and removed with the worktree)
 * on success; preserved for inspection on failure. bootstrap, claude, and test
 * stdout/stderr are all tee'd into the file so `tail -f` gives a live view.
 * Failure lines are printed immediately (not deferred to wave end).
 *
 * @returns {Promise<{ ok: boolean; stdoutTail: string }>}
 */
export async function runSession(sessionEntry, state, deps = {}) {
  const exec = deps.exec ?? runProcess;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const log = deps.log ?? console.log;
  const cur = ensureSessionEntry(state, sessionEntry.id);

  if (cur.status === 'done') {
    log(`  ✓ ${sessionEntry.id} — already done (PR: ${cur.prUrl})`);
    return { ok: true, stdoutTail: '' };
  }

  cur.attempt += 1;
  cur.status = 'in_progress';
  cur.startedAt = new Date().toISOString();
  cur.error = null;
  cur.testExitCode = null;
  await deps.saveState?.(state);

  const branch = `bp/${state.runId}/${sessionEntry.id}`;
  const worktreePath = path.join(repoRoot, '.bp-worktrees', state.runId, sessionEntry.id);
  const logPath = path.join(worktreePath, 'session.log');
  cur.branch = branch;
  cur.worktreePath = worktreePath;

  log(`  → ${sessionEntry.id} starting (worktree: ${worktreePath})`);

  // ── A4 helpers (log stream is opened after worktreeAdd succeeds) ─────────────
  /** @type {import('node:fs').WriteStream | null} */
  let logStream = null;

  const writeToLog = (text) => {
    if (logStream && !logStream.destroyed) logStream.write(text);
  };

  const closeLog = () => new Promise((resolve) => {
    if (!logStream) { resolve(); return; }
    logStream.end(resolve);
  });

  // teeLog: writes a narrative line to the main terminal AND to session.log.
  const teeLog = (msg) => { log(msg); writeToLog(msg + '\n'); };

  // teeExec: wraps exec to stream process stdout/stderr into session.log while
  // also accumulating them in the return value (existing behaviour unchanged).
  const teeExec = (cmd, args, opts = {}) => exec(cmd, args, {
    ...opts,
    onStdout: (chunk) => { writeToLog(chunk); opts.onStdout?.(chunk); },
    onStderr: (chunk) => { writeToLog(chunk); opts.onStderr?.(chunk); },
  });

  // B3 (#95): cost accumulator. Populated after the claude spawn completes.
  /** @type {number | null} */
  let sessionCost = null;

  /** Format a "$X.XX (run total $Y.YY)" suffix when costs are known. */
  const costSuffix = (runTotalBefore) => {
    if (sessionCost === null) return '';
    const runTotal = runTotalBefore + sessionCost;
    return ` — $${sessionCost.toFixed(2)} (run total $${runTotal.toFixed(2)})`;
  };

  // Immediately print a failure line and close the log.  logStream may be null
  // if the failure happened before the worktree was created — in that case the
  // log reference is omitted.
  const failSession = async (error, stdoutTail) => {
    cur.status = 'failed';
    cur.error = error;
    cur.costUsd = sessionCost;
    cur.completedAt = new Date().toISOString();
    const runTotalBefore = state.totalCostUsd ?? 0;
    if (sessionCost !== null) state.totalCostUsd = runTotalBefore + sessionCost;
    const elapsed = formatElapsed(Date.now() - new Date(cur.startedAt).getTime());
    const snippet = error.slice(0, 120);
    const logRef = logStream ? ` — log: ${logPath}` : '';
    log(`  ✗ ${sessionEntry.id} failed at ${elapsed} (${snippet})${logRef}${costSuffix(runTotalBefore)}`);
    await closeLog();
    return { ok: false, stdoutTail };
  };

  // #126: resolve the local-test policy once per session (deps override → env →
  // default 'block'). Under 'advisory', a failing independent test does not call
  // failSession — it flags the PR and falls through to reconcile/import-self-heal/
  // push, handing the authoritative gate to CI (#115 auto-merge waits for green CI).
  const testPolicy = deps.testPolicy ?? resolveTestPolicy(null, process.env).value;
  let testAdvisoryFailure = false;

  // Apply the policy to one test execution. Records the exit code, then either
  // signals the caller to block (failSession) or flags the advisory failure and
  // returns false (continue). `label` describes the execution for the advisory log.
  const testBlocks = (exitCode, label) => {
    cur.testExitCode = exitCode;
    const outcome = classifyTestOutcome(exitCode, testPolicy);
    if (outcome === 'proceed') return false;
    if (outcome === 'advisory-push') {
      testAdvisoryFailure = true;
      teeLog(
        `    ⚠ ${sessionEntry.id}: ${label} (exit ${exitCode}) — --test-policy advisory: ` +
        `pushing PR anyway, CI is the authoritative gate`,
      );
      return false;
    }
    return true; // 'block' (default)
  };

  // 1) Create worktree on new branch (branched from the latest origin/<base>, #120).
  const wt = await worktreeAdd(repoRoot, worktreePath, branch, process.env.HS_BASE_BRANCH ?? 'main', exec, { log });
  if (!wt.ok) {
    return failSession(`worktree add failed: ${wt.stderr.slice(0, 500)}`, `worktree add failed: ${wt.stderr.slice(0, 500)}`);
  }

  // Open the per-session log now that the worktree directory exists.
  logStream = fssync.createWriteStream(logPath, { flags: 'a' });

  // 1b) Bootstrap (A1 / #85): run workspaceInstall + per-session install in the
  //     worktree before spawning claude. Marker-checked so re-runs skip work.
  //     A bootstrap failure marks the session failed with a `bootstrap_failed`
  //     error class so it does not get confused with a `test_failed`.
  //     A4 (#88): pass teeExec + teeLog so bootstrap output is captured.
  const requirements = deps.requirements;
  if (requirements && ((requirements.workspaceInstall?.length ?? 0) > 0
                       || (requirements.sessionInstall?.[sessionEntry.id]?.length ?? 0) > 0)) {
    const bootstrapRes = await bootstrapWorktree(
      sessionEntry, requirements, worktreePath,
      { exec: teeExec, log: teeLog },
    );
    if (!bootstrapRes.ok) {
      return failSession(bootstrapRes.error, bootstrapRes.error);
    }
  }

  // 2) Read brief content; brief path is relative to the build-plan dir.
  //    deps.readBrief is a test seam (defaults to reading from SCRIPT_DIR).
  const briefAbs = path.join(SCRIPT_DIR, sessionEntry.brief);
  const readBrief = deps.readBrief ?? ((p) => fs.readFile(p, 'utf-8'));
  let briefContent;
  try { briefContent = await readBrief(briefAbs); }
  catch (e) {
    return failSession(`brief read failed: ${e.message}`, `brief read failed: ${e.message}`);
  }

  // 3) Spawn claude CLI with the brief as the SOLE context (passed via stdin to
  //    avoid argv length limits). The worktree is the cwd — claude sees the
  //    session's repo only, not the specs.
  //    A4 (#88): use teeExec so claude's stdout/stderr stream into session.log.
  //    B1 (#95): use deps.claudeArgs if the runner resolved a model override;
  //    falls back to the module-level CLAUDE_CLI_ARGS constant.
  const claudeArgs = [...(deps.claudeArgs ?? CLAUDE_CLI_ARGS)];
  // #137 Phase 3: per-session liveness watchdog. While claude runs (the long
  // pole), sample session.log mtime + touched-file count; if there is no output
  // and no file change for HS_SESSION_STALL_MS (default 15m), kill claude's
  // process tree (targeted at this one child's PID) so the session fails
  // `stalled` and the wave makes progress instead of hanging on a stuck child.
  // HS_DISABLE_WATCHDOG=1 opts out. Tests inject deps.watchdog to assert wiring.
  let claudeChild = null;
  let stalled = false;
  const watchdogEnabled = !process.env.HS_DISABLE_WATCHDOG && deps.watchdog !== false;
  const watchdog = watchdogEnabled
    ? (deps.startWatchdog ?? startSessionWatchdog)({
        worktreePath,
        getChild: () => claudeChild,
        exec,
        log: teeLog,
        env: process.env,
        onStall: () => { stalled = true; },
      })
    : null;
  let claudeRes;
  try {
    claudeRes = await teeExec(CLAUDE_CLI, claudeArgs, {
      cwd: worktreePath,
      input: briefContent,
      detached: process.platform !== 'win32', // posix: own process group for tree-kill
      onSpawn: (child) => { claudeChild = child; },
    });
  } finally {
    watchdog?.stop();
  }
  // A watchdog kill resolves the claude exec non-zero; surface it as a distinct
  // `stalled` failure (written into the wave failure report) rather than a generic
  // claude-exit error, and escalate it (tenet 3) before failing the session.
  if (stalled) {
    const idleMin = Math.round(resolveStallThresholdMs(process.env) / 60000);
    const err = `stalled: no output or file change for ~${idleMin}m — watchdog killed the claude process tree`;
    await writeEscalation({
      wave: `session-${sessionEntry.id}`, kind: 'session-stalled', sessionId: sessionEntry.id,
      brief: sessionEntry.brief, worktreePath, logPath, idleThresholdMs: resolveStallThresholdMs(process.env),
      generatedAt: new Date().toISOString(),
    }, { log: teeLog, scriptDir: deps.scriptDir }).catch(() => {});
    return failSession(err, `[claude]\n${tailLines(claudeRes.stdout + '\n' + claudeRes.stderr)}\n[runner]\n${err}`);
  }
  const claudeStdoutTail = tailLines(claudeRes.stdout + '\n' + claudeRes.stderr);
  // B3 (#95): extract cost from claude output as soon as it finishes so the
  // value is available in both success and failure paths. If the cost can't be
  // parsed, surface it once — a --max-cost user must know cost tracking degraded
  // (the cap then relies on the $5/session default rather than real spend).
  sessionCost = parseClaudeCost(claudeRes.stdout, claudeRes.stderr);
  if (sessionCost === null && deps.costCapActive) {
    teeLog(`    ⚠ ${sessionEntry.id}: could not parse cost from claude output — --max-cost projection will use the $5/session default for this run`);
  }

  // 3b) Commit anything claude left uncommitted. The brief instructs claude
  //     to commit, but real claude (vs the fake-claude shim) sometimes makes
  //     file changes without committing — in which case `git push` succeeds
  //     vacuously and `gh pr create` rejects "No commits between main and
  //     <branch>". Auto-committing here closes that gap and surfaces the
  //     legitimate failure (no changes at all) as a clear session error.
  //     Track D finding (#40 Session 2).
  //     A4 (#88): exclude session.log from staging — it lives inside the
  //     worktree for easy `tail -f` but must not appear in PRs.
  await exec('git', ['add', '-A'], { cwd: worktreePath });
  await exec('git', ['reset', 'HEAD', '--', 'session.log'], { cwd: worktreePath });
  const diffRes = await exec('git', ['diff', '--cached', '--quiet'], { cwd: worktreePath });
  if (diffRes.exitCode === 0) {
    // No staged changes — also nothing in HEAD relative to main means claude produced nothing.
    const aheadRes = await exec('git', ['rev-list', '--count', 'main..HEAD'], { cwd: worktreePath });
    const ahead = parseInt((aheadRes.stdout || '').trim(), 10) || 0;
    if (ahead === 0) {
      const err = `claude produced no commits and no uncommitted changes in worktree (brief: ${sessionEntry.brief})`;
      return failSession(err, `[claude]\n${claudeStdoutTail}\n[runner]\n${err}`);
    }
  } else {
    // Stage exists — commit it for claude.
    const commitRes = await exec('git', [
      '-c', 'user.email=hyperspeed-runner@local',
      '-c', 'user.name=hyperspeed-runner',
      'commit', '-m', `${sessionEntry.id}: autonomous build (auto-commit by runner)`,
    ], { cwd: worktreePath });
    if (commitRes.exitCode !== 0) {
      const err = `auto-commit failed: ${tailLines(commitRes.stderr, 10)}`;
      return failSession(err, err);
    }
  }

  // 4) Run the independent test in the worktree.
  //    A4 (#88): use teeExec so test output streams into session.log.
  //    #125 Item 4: run from test.cwd (worktree-relative) so monorepo briefs
  //    never embed a `cd …` prefix the shell:false spawn cannot honor.
  const [testCmd, ...testArgs] = parseShellCmd(sessionEntry.test.cmd);
  const testCwd = resolveTestCwd(worktreePath, sessionEntry);
  const testRes = await teeExec(testCmd, testArgs, { cwd: testCwd });

  // #126: ordering contract — bootstrap/install → independent test →
  //   reconcile-with-base → (re-test if changed) → push/PR.
  //   (#136 tenet 2: the in-loop Node-compat lint and import self-heal were
  //   deleted — CI lints in a clean container and the per-session agent + CI
  //   install own missing-import detection; the runner no longer re-derives them.)
  //   Under --test-policy advisory a failing test FALLS THROUGH (testBlocks
  //   returns false) so reconcile still runs and the PR opens; under the default
  //   'block' policy it fails the session exactly as before.
  if (testBlocks(testRes.exitCode, 'independent test failed')) {
    const err = `Independent test failed with exit ${testRes.exitCode}`;
    return failSession(err,
      `[claude]\n${claudeStdoutTail}\n[test]\n${tailLines(testRes.stdout + '\n' + testRes.stderr)}`);
  }

  // 4b) #120: reconcile with the LATEST base before opening the PR. While this
  //     session ran, sibling PRs may have merged (advancing the base) — most
  //     importantly adding their own package.json deps. Merge them in now,
  //     unioning dependency sections, so this PR is conflict-free at auto-merge
  //     time and no session's deps get dropped. If the merge changed anything,
  //     re-run the independent test against the integrated worktree.
  const reconcile = await reconcileWorktreeWithBase(sessionEntry, worktreePath, {
    exec: teeExec, log: teeLog,
    baseBranch: process.env.HS_BASE_BRANCH ?? 'main',
    requirements, projectManifestStub: deps.projectManifestStub,
  });
  if (!reconcile.ok) {
    return failSession(reconcile.error, `[claude]\n${claudeStdoutTail}\n[reconcile]\n${reconcile.output ?? reconcile.error}`);
  }
  if (reconcile.merged) {
    const reRes = await teeExec(testCmd, testArgs, { cwd: testCwd });
    // #126: advisory lets a post-merge failure fall through to push (CI is the gate).
    if (testBlocks(reRes.exitCode, 'independent test failed after reconciling with the latest base — the merge likely changed shared deps')) {
      const err = `Independent test failed (exit ${reRes.exitCode}) after reconciling with the latest base — the merge likely changed shared deps`;
      return failSession(err, `[claude]\n${claudeStdoutTail}\n[retest]\n${tailLines(reRes.stdout + '\n' + reRes.stderr)}`);
    }
  }

  // 5) Push branch + open PR.
  const pushRes = await exec('git', ['push', '-u', 'origin', branch], { cwd: worktreePath });
  if (pushRes.exitCode !== 0) {
    const err = `git push failed: ${tailLines(pushRes.stderr, 10)}`;
    return failSession(err, err);
  }

  const prBody = formatPrBody({
    id: sessionEntry.id,
    checkpoint: sessionEntry.checkpoint,
    manualAcs: sessionEntry.manualAcs ?? [],
    testAdvisoryFailure, // #126: renders the "local tests failed — CI is the gate" banner
  });
  // Write the body to a temp file and pass --body-file. Inline --body
  // is fragile across platforms once shell wrapping enters the picture
  // (Windows .cmd shim resolution requires shell:true, which mangles
  // multi-line / quoted args). --body-file sidesteps the whole issue.
  // Surfaced by tests/e2e/run-canary.mjs Track D Session 2.
  const bodyFile = path.join(worktreePath, '.bp-pr-body.md');
  await fs.writeFile(bodyFile, prBody, 'utf-8');
  // Body file is inside the worktree, which gets removed below on success;
  // on failure we leave the worktree for inspection so the file persists too.
  // #136 defect 7: idempotent — adopt the PR (rewriting its body to this
  // canonical template) if the agent self-opened one, instead of failing.
  const pr = await createOrAdoptPr({
    exec, log: teeLog, branch, base: 'main',
    title: `${sessionEntry.id}: autonomous build`, bodyFile,
  });
  if (!pr.ok) {
    return failSession(pr.error, pr.error);
  }
  if (pr.adopted) {
    teeLog(`    ↻ ${sessionEntry.id}: runner adopted a pre-existing PR (the session agent opened it; runner owns the PR invariant)`);
  }

  const prUrl = pr.prUrl;
  cur.prUrl = prUrl;
  cur.status = 'done';
  cur.costUsd = sessionCost;
  cur.completedAt = new Date().toISOString();
  // B3 (#95): accumulate cost into run total before saving state.
  const runTotalBefore = state.totalCostUsd ?? 0;
  if (sessionCost !== null) state.totalCostUsd = runTotalBefore + sessionCost;

  // 5b) #115: post-PR review routing.
  //   - No manual ACs → enable GitHub auto-merge so the PR self-merges the
  //     moment CI is green (the integration gate is the cross-session check).
  //     A failure to enable (e.g. the repo has not turned on "Allow auto-merge")
  //     is NON-FATAL: the session is still `done` with an open PR; the operator
  //     just merges it by hand. We only flag autoMergeEnabled when the enable
  //     actually succeeded so the wait-for-merge step polls only real auto-merges.
  //   - Manual ACs → leave the PR open and print the checklist to the runner
  //     output so the reviewer knows exactly what to verify.
  const requiresReview = sessionEntry.requiresHumanReview ?? ((sessionEntry.manualAcs?.length ?? 0) > 0);
  if (!requiresReview) {
    const mergeRes = await ghWithBackoff(
      ['pr', 'merge', '--auto', '--squash', prUrl ?? branch],
      { exec },
    );
    if (mergeRes.exitCode === 0) {
      cur.autoMergeEnabled = true;
      teeLog(`    ↻ ${sessionEntry.id}: auto-merge enabled — PR will self-merge when CI is green`);
    } else {
      teeLog(
        `    ⚠ ${sessionEntry.id}: could not enable auto-merge (${tailLines(mergeRes.stderr, 3)}) — ` +
        `leaving PR open for manual merge. Enable "Allow auto-merge" in repo Settings → General.`,
      );
    }
  } else {
    teeLog(`    ⚑ ${sessionEntry.id}: manual sign-off required before merge — PR left open:`);
    for (const ac of sessionEntry.manualAcs ?? []) {
      teeLog(`        [ ] ${ac.id}: ${ac.text}`);
    }
  }

  // 6) Close the log stream, then remove the worktree (which deletes session.log
  //    along with the worktree directory — best-effort cleanup on success).
  //    #127: removal retries transient locks and, on ultimate failure, logs a
  //    warning instead of crashing this otherwise-successful session.
  await closeLog();
  await cleanupWorktreeBestEffort(repoRoot, worktreePath, exec, { log, sessionId: sessionEntry.id });

  log(`  ✓ ${sessionEntry.id} — PR ${prUrl}${costSuffix(runTotalBefore)}`);
  return { ok: true, stdoutTail: '' };
}

// ─── Summary table ───────────────────────────────────────────────────────────

export function formatSummaryTable(state) {
  const rows = [['Session', 'Status', 'Attempts', 'Test exit', 'PR']];
  for (const [id, s] of Object.entries(state.sessions)) {
    rows.push([id, s.status, String(s.attempt), s.testExitCode === null ? '—' : String(s.testExitCode), s.prUrl ?? '—']);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  return rows.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n');
}

// ─── SIGINT handler ──────────────────────────────────────────────────────────

function installInterruptHandler(state, saveStateFn) {
  let cleaningUp = false;
  const handle = async (sig) => {
    if (cleaningUp) return;
    cleaningUp = true;
    // C1-6 (#99): stop the heartbeat timer immediately so no tick fires during
    // (or after) interrupt cleanup.
    stopActiveHeartbeat();
    console.error(`\n${sig} received — marking in-progress sessions interrupted and cleaning worktrees...`);
    for (const [, s] of Object.entries(state.sessions)) {
      if (s.status === 'in_progress') {
        s.status = 'interrupted';
        s.completedAt = new Date().toISOString();
        if (s.worktreePath) {
          await worktreeRemove(REPO_ROOT, s.worktreePath).catch(() => {});
        }
      }
    }
    // #132 B: tear down the fixture-service stack so Ctrl-C doesn't strand containers.
    await stopActiveFixtureServices().catch(() => {});
    try { await saveStateFn(state); } catch { /* best-effort persist on signal; exiting regardless */ }
    process.exit(130);
  };
  process.on('SIGINT', () => handle('SIGINT'));
  process.on('SIGTERM', () => handle('SIGTERM'));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const manifest = await loadManifest();

  // #136 defect 2: resolve the build repo's owner/repo slug ONCE, before any gh
  // call (preflight readiness probe, PR create/merge, resume). Every gh
  // invocation then targets this repo via `-R <slug>` regardless of process.cwd().
  setResolvedRepo(await resolveRepoSlug({ repoRoot: REPO_ROOT }));

  // A3 (#87): resolve concurrency once so --check-env, the auto-preflight, and
  // runFeatureWave all see the same value and source string.
  const concurrency = resolveConcurrency(args, process.env);

  // B3 (#95): resolve cost cap once for the whole run.
  const maxCost = resolveMaxCost(args, process.env);

  // B4 (#95): resolve auto-advance policy once for the whole run.
  const autoAdvance = resolveAutoAdvance(args, process.env);

  // #126: resolve the local-test + integration-gate policies once for the run
  // ("CI is the gate" model). Both default to 'block' (current behaviour).
  const testPolicy = resolveTestPolicy(args, process.env);
  const integrationGatePolicy = resolveIntegrationGatePolicy(args, process.env);

  // B1 (#95): resolve the effective claude CLI args for every session spawn
  // (appends `--model <intendedBuildModel>` unless HS_CLAUDE_CLI_ARGS overrides).
  const resolvedClaudeArgs = resolveClaudeArgs(
    CLAUDE_CLI_ARGS, process.env.HS_CLAUDE_CLI_ARGS, manifest.intendedBuildModel,
  );

  // --check-env: standalone subcommand. Run preflight, print every line,
  // exit 0 iff every check passes. No worktree creation, no state-file touch.
  if (args.checkEnv) {
    const result = await runPreflight(manifest, { concurrency, maxCost, autoAdvance, testPolicy, integrationGatePolicy });
    for (const line of result.lines) console.log(line);
    process.exit(result.ok ? 0 : 1);
  }

  // #109: --seed-base is a standalone subcommand. Seed the project manifest +
  // lockfile onto the base branch so a greenfield Wave 0 can install. No
  // preflight (it would fail on the very greenfield state we are fixing), no
  // worktree, no state-file touch.
  if (args.seedBase) {
    const result = await seedBase(manifest, {});
    for (const line of result.lines) console.log(line);
    process.exit(result.ok ? 0 : 1);
  }

  // C2-1 (#84): --resume-from-pr is a standalone state-only subcommand. It marks
  // one session done (if its PR is green) and exits — no preflight, no wave.
  if (args.resumeFromPr) {
    const code = await resumeFromPr(args.resumeFromPr);
    process.exit(code);
  }

  // Auto-invoke preflight at startup unless explicitly skipped. The dedicated
  // host-binary check previously inlined here is now part of runPreflight().
  // --dry-run is side-effect-free preview; skip preflight there too so
  // `--dry-run` works on any machine without gh/claude/etc. installed.
  if (!args.skipEnvCheck && !args.dryRun) {
    const result = await runPreflight(manifest, { concurrency, maxCost, autoAdvance, testPolicy, integrationGatePolicy });
    if (!result.ok) {
      console.error('✗ Preflight failed — refusing to start. Fix the issues below and retry (or pass --skip-env-check to bypass).');
      for (const line of result.lines) {
        if (line.startsWith('✗') || line.startsWith('⚠')) console.error(`  ${line}`);
      }
      process.exit(1);
    }
  }

  if (args.requireQualityScore) {
    // C2-2 (#84): if the report is missing, try to generate it before gating
    // rather than dead-ending the user with "run hyperspeed --score-briefs".
    const ensured = await ensureQualityReport();
    const gate = await checkQualityGate(args.qualityThreshold);
    if (!gate.ok) {
      console.error(`✗ Brief-quality gate refused to start runner: ${gate.reason}`);
      if (!ensured.ok && ensured.triedMsg) {
        console.error(`  Auto-generation failed — tried: ${ensured.triedMsg}`);
        console.error(`  Install the HyperSpeed CLI (or run from inside the repo so \`npx hyperspeed\` resolves) and retry.`);
      }
      process.exit(1);
    }
    console.log(`✓ Brief-quality gate passed (threshold ${args.qualityThreshold}).`);
  }

  if (args.dryRun) {
    console.log(formatDryRunPlan(manifest));
    return;
  }

  // Note: the A1 inline host-binary halt previously lived here. It has been
  // promoted into runPreflight() above (issue #86) so the same checks back
  // both --check-env and the auto-invocation. checkHostBinaries remains an
  // exported helper for callers that want just the host-binary slice.

  let state = await loadState();
  if (!state) {
    const runId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    state = makeFreshState(runId);
  }
  installInterruptHandler(state, saveState);

  await reconcileState(state, manifest);
  await saveState(state);

  const waves = args.wave === null
    ? manifest.waves.map((w, i) => ({ w, idx: i }))
    : [{ w: manifest.waves[args.wave], idx: args.wave }];

  if (args.wave !== null && !manifest.waves[args.wave]) {
    console.error(`--wave ${args.wave} out of range (manifest has ${manifest.waves.length} waves)`);
    process.exit(2);
  }

  // B4 (#95): track whether the previous wave had any non-done outcome (for on-green).
  let prevWaveHadFailures = false;
  const isFullRun = args.wave === null;

  // #132 B: bring declared fixture services up ONCE before the wave(s) so local
  // `test.cmd` / integration-gate runs have their backing stores (Postgres,
  // Redis, …). Tear down on every exit path through finish() + the SIGINT trap
  // (which calls stopActiveFixtureServices). Bypassed by HS_SKIP_FIXTURE_SERVICES.
  const fixtureRes = await startFixtureServices(manifest, REPO_ROOT, {});

  // Every run-terminating exit in the wave loop goes through finish() so the
  // fixture stack is always torn down (process.exit bypasses try/finally).
  const finish = async (code) => {
    await stopActiveFixtureServices();
    process.exit(code);
  };

  // #137 Phase 2 (fail-closed): when services are declared but the stack did NOT
  // come up (and the operator did not opt out via HS_SKIP_FIXTURE_SERVICES), HALT
  // at run start rather than letting a half-up stack make "some" sessions pass —
  // the exact non-determinism #138 tenet 1 rejects. Run-level (the runner cannot
  // import the generator's per-session service inference). HS_FIXTURES_BEST_EFFORT
  // restores the old warn-and-continue behavior for power users.
  const servicesDeclared = servicesFromManifest(manifest).length > 0;
  const fixtureVerdict = classifyFixtureStartup(fixtureRes, servicesDeclared, process.env);
  if (fixtureVerdict === 'best-effort') {
    console.error(`⚠ Fixture services failed to start (${fixtureRes.reason}) but HS_FIXTURES_BEST_EFFORT is set — continuing; service-dependent tests may fail.`);
  } else if (fixtureVerdict === 'fail-closed') {
    console.error(
      `✗ Refusing to start — ${servicesFromManifest(manifest).length} fixture service(s) are declared but the stack did not come up (${fixtureRes.reason}). ` +
      `A service-dependent test must not run against a stack that never started. ` +
      `Fix the cause (see the warning above; \`--check-env\` diagnoses port/daemon/leftover hazards), ` +
      `run your own stack and set HS_SKIP_FIXTURE_SERVICES=1, or set HS_FIXTURES_BEST_EFFORT=1 to override.`,
    );
    await finish(1);
  }

  // #137 Phase 2 (env contract): export the resolved connection env
  // (DATABASE_URL / REDIS_URL / per-service vars) for the declared services so
  // code-under-test that reads process.env connects to the fixtures — the canary's
  // "SASL: client password must be a string" was a missing export, not bad code.
  // Non-clobbering, so an operator's own exports / a HS_SKIP_FIXTURE_SERVICES
  // stack on different ports win. The spawned claude child + every test.cmd +
  // the integration wave all inherit process.env, so this reaches all of them.
  if (servicesDeclared) {
    const { applied } = applyServiceConnectionEnv(servicesFromManifest(manifest), process.env);
    if (applied.length > 0) {
      console.log(`  · exported service connection env for tests: ${applied.join(', ')}`);
    }
  }

  for (const { w, idx } of waves) {
    // B4 (#95): auto-advance gate. Only applies in full-run mode — under
    // `--wave N` the supervised driver (run-build.md) sequences waves itself.
    const advance = decideWaveAdvance({
      waveIndex: idx,
      isFullRun,
      autoAdvance: autoAdvance.value,
      prevWaveHadFailures,
      isTTY: !!process.stdin.isTTY,
    });
    if (advance === 'refuse-non-tty') {
      console.log(
        `\n→ Paused before wave ${idx} (--auto-advance ${autoAdvance.value}).` +
        ` Non-TTY stdin detected — cannot prompt interactively.` +
        ` Re-run with --auto-advance always for unattended execution.`,
      );
      await finish(0);
    } else if (advance === 'prompt') {
      const answer = await new Promise((resolve) => {
        process.stdout.write(`\nContinue to wave ${idx}? [y/N] `);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        rl.once('line', (line) => { rl.close(); resolve(line.trim().toLowerCase()); });
        rl.once('close', () => resolve('')); // EOF / immediate close → treat as "no"
      });
      if (answer !== 'y' && answer !== 'yes') {
        console.log(`Stopped at wave ${idx}. Re-run to resume from this wave.`);
        await finish(0);
      }
    }

    // B3 (#95): cost-cap gate. Before starting each feature wave, estimate
    // whether the total could exceed the cap and halt early if so.
    if (w.kind === 'feature') {
      const completedCount = Object.values(state.sessions).filter(s => s.status === 'done').length;
      const cost = shouldHaltForCost({
        maxCost: maxCost.value,
        spent: state.totalCostUsd ?? 0,
        completedCount,
        waveSize: w.sessions.length,
      });
      if (cost.halt) {
        console.error(
          `\n✗ Refusing to start wave ${idx} — projected total cost` +
          ` ($${cost.projected.toFixed(2)}) would exceed --max-cost ($${maxCost.value.toFixed(2)}).` +
          `\n  Completed: ${completedCount} sessions, $${(state.totalCostUsd ?? 0).toFixed(2)} spent.` +
          ` Override with --max-cost <higher> or 0 (unlimited).`,
        );
        await finish(1);
      }
    }
    if (w.kind === 'feature') {
      const res = await runFeatureWave(w, manifest, state, {
        saveState, concurrency, claudeArgs: resolvedClaudeArgs, costCapActive: maxCost.value > 0,
        testPolicy: testPolicy.value, // #126: advisory local-test gating flows to runSession
      });
      prevWaveHadFailures = !res.ok; // B4: track for on-green mode
      if (!res.ok) {
        const report = formatFailureReport({ wave: { kind: w.kind, phase: w.phase }, failures: res.failures });
        const reportPath = path.join(SCRIPT_DIR, `wave-${idx}-failure-report.json`);
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
        console.error(`\n✗ Feature wave ${idx} failed. Report: ${reportPath}\n`);
        console.error(formatSummaryTable(state));
        // #137 Phase 3 (tenet 3): hand the halt to a supervising agent.
        await writeEscalation({ wave: idx, kind: 'feature-wave-failed', reportPath, report }, {}).catch(() => {});
        await finish(1);
      }
      // #115: if any session in this wave enabled auto-merge, wait for those
      // PRs to land and fast-forward local base BEFORE the integration gate /
      // next wave, so they run against the merged code rather than stale base.
      const autoMergeUrls = w.sessions
        .map(s => state.sessions[s.id])
        .filter(st => st && st.autoMergeEnabled && st.prUrl)
        .map(st => st.prUrl);
      if (autoMergeUrls.length > 0) {
        // #120 hardening: auto-recover any PR that goes DIRTY (a simultaneous
        // sibling merged a conflicting package.json) by reconciling + re-pushing
        // its branch, then re-wait. URL→session map for the recovery closure.
        const sessionByUrl = new Map(w.sessions
          .map(s => [state.sessions[s.id]?.prUrl, s])
          .filter(([u]) => u));
        const wait = await resolveWaveAutoMerges(autoMergeUrls, {
          recover: (url) => {
            const s = sessionByUrl.get(url);
            if (!s) return Promise.resolve({ ok: false });
            return recoverConflictedPr(s, state, {
              baseBranch: process.env.HS_BASE_BRANCH ?? 'main',
              requirements: manifest.requirements,
              projectManifestStub: manifest.projectManifestStub,
            });
          },
        });
        if (!wait.ok) {
          const report = {
            wave: { kind: w.kind, phase: w.phase },
            generatedAt: new Date().toISOString(),
            reason: 'auto-merge did not complete (timeout, closed, or unrecoverable conflict)',
            pending: wait.pending,
            closedWithoutMerging: wait.closed,
            unrecoverableConflicts: wait.dirty,
            merged: wait.merged,
          };
          const reportPath = path.join(SCRIPT_DIR, `wave-${idx}-failure-report.json`);
          await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
          console.error(
            `\n✗ Wave ${idx}: ${wait.pending.length} pending, ${wait.closed.length} closed, ` +
            `${wait.dirty.length} unrecoverable conflict(s). Report: ${reportPath}\n` +
            `  Inspect the listed PR(s); re-run this wave once they merge.`,
          );
          await finish(1);
        }
        await syncBaseBranch({});
      }
    } else {
      const res = await runIntegrationWave(w);
      prevWaveHadFailures = !res.ok; // B4: track for on-green mode
      if (!res.ok) {
        // #126: always write the failure report + log; the HALT decision is the
        // pure shouldHaltAfterWave(res, policy). Default 'block' halts (exit 1);
        // 'advisory' logs and continues to the next wave (CI is the gate).
        const report = {
          wave: { kind: w.kind, phase: w.phase, cmd: w.test.cmd },
          generatedAt: new Date().toISOString(),
          exitCode: res.exitCode,
          stdoutTail: res.stdoutTail,
        };
        const reportPath = path.join(SCRIPT_DIR, `wave-${idx}-failure-report.json`);
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
        if (shouldHaltAfterWave(res, integrationGatePolicy.value)) {
          console.error(`\n✗ Integration gate ${w.phase} failed (exit ${res.exitCode}). Report: ${reportPath}\n`);
          // #137 Phase 3 (tenet 3): hand the halt to a supervising agent.
          await writeEscalation({ wave: idx, kind: 'integration-gate-failed', reportPath, report }, {}).catch(() => {});
          await finish(1);
        }
        console.error(
          `\n⚠ Integration gate ${w.phase} failed (exit ${res.exitCode}) — ` +
          `--integration-gate-policy advisory: continuing to the next wave. Report: ${reportPath}\n`,
        );
      }
    }
  }

  // #132 B: tear the fixture stack down on the success path.
  await stopActiveFixtureServices();
  console.log(`\n✓ All waves complete.`);
  console.log(formatSummaryTable(state));
}

// CLI guard — only run main() when invoked directly (not when imported by tests).
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}` || import.meta.url === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

// Normalize: on Windows, argv[1] may have different slashes/drive case from import.meta.url.
const argvUrl = (() => {
  try { return fssync.realpathSync(process.argv[1] || ''); } catch { return process.argv[1] || ''; }
})();
const selfUrl = (() => {
  try { return fssync.realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; }
})();

if (isMain || (argvUrl && selfUrl && argvUrl === selfUrl)) {
  main().catch(err => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
