---
issue: 53
issue_title: "Re-examine the compat-dispatch gap now that pi 0.81.0 exposes ModelRegistry.getProvider"
---

# Retro: #53 — Re-examine the compat-dispatch gap now that pi 0.81.0 exposes ModelRegistry.getProvider

## Stage: Planning (2026-09-24T06:16:33Z)

### Session summary

Answered the issue's four questions and the comment's two against pi v0.86.0 and v0.87.1, swept every release through 0.87.1 and unreleased `main` for better APIs at the operator's prompt, and measured the supported path live.
The plan is docs-only (`/build-plan`): record the findings, replace the `agent.streamFunction` workaround with `ctx.modelRegistry.streamSimple()`, narrow the documented residual to explicit `compat.streamSimple` callers and the untyped `setDefaultStreamFn` fallback, and close the issue at ship time.

### Observations

- The direction changed twice.
  The first `ask_user` offered a provider-aware `setDefaultStreamFn` override (found in the release sweep), and the operator picked it.
  A spike then showed `getDefaultStreamFn` is not exported and `streamFn` has been required in the pi-agent-core types since 0.81.0.
  Checking the published `pi-observational-memory@3.1.4` also showed it already routes through `modelRegistry.streamSimple`.
  Re-asking on that evidence moved the operator to docs-only.
  Lesson: check the seam's *export surface* and a real consumer before building an option set around a mechanism read from source.
- The operator's nudge ("Pi has had quite a number of releases") was load-bearing: the issue's four questions alone would have steered toward the api-registry override, which is now constructible but still inexact.
- Live probe (pi 0.87.1, haiku-4-5, `PI_ANTHROPIC_AUTH_DEBUG=all`): `ctx.modelRegistry.streamSimple` produced a `before-provider-request` shaping line and explicit `compat.streamSimple` did not.
  The synthetic payload (`AGENTS.md` as the system prompt) returned 200 even unshaped, so the status code did not discriminate; the debug line is the evidence.
  My first `rg` filter used `^` anchors that matched nothing and briefly read as a failed run; check raw output before interpreting an empty filter.
- The issue's cost section (raise the floor to 0.81.0, major bump) is moot: the floor is already `>=0.86.0`.
- No follow-up issue filed: the operator declined the "docs now, default fn as follow-up" option.
- Tidy-First assessment skipped: `src/` edits are comments only.

## Stage: Implementation — Build (2026-09-24T06:30:22Z)

### Session summary

Executed all five plan steps: re-ran the live probe (still 2 vs 1 `before-provider-request` lines), rewrote the `docs/architecture.md` decision record, and narrowed the claim in `README.md` and the `src/` comments.
Then narrowed it in `AGENTS.md`, the `anthropic` skill, the upstream-watch skill (two new assumption rows), and both seam decision records.
Four `docs:` commits; tests, typecheck, and lint green throughout.

### Observations

- No deviations from the plan's file list.
  `docs/architecture.md` cites issues as plain `Issue #N`, so it got no `[#53]` definition despite the plan saying so; the two seam records use reference links and got one each.
- The step-2 insertion initially split the "That default resolves… / Up to pi 0.80.7…" run, leaving "that registry" with a distant referent; a second edit moved the new paragraphs after the bridge paragraph.
- The em-dash trap fired twice in one step: an `oldText` with an escaped em-dash failed to match (harmless), and a `newText` wrote two literal `\u2014` escapes into `.pi/skills/anthropic/SKILL.md`.
  The `u20xx` scan caught it; the sentence was reworded with parentheses instead.
- Two sweep false-greens were caught before they could count: zsh passed a `$X` glob-flag variable as one word, and `rg` skips hidden `.pi/` without `--hidden`.
  Only the re-run with inline flags and `--hidden` actually covered the skills.
- Pre-completion reviewer: PASS.
  It independently re-verified every upstream claim at v0.86.0/v0.87.1 and the `agentLoop` example signature against the installed 0.86.0 `agent-loop.d.ts`.
  Its evidence-provenance section noted (WARN-level, non-blocking) that the probe is n=1 on a synthetic payload, which the docs already disclose.

## Stage: Final Retrospective (2026-09-24T06:37:34Z)

### Session summary

One session took #53 from plan through `v3.3.1`: an investigation issue that ended docs-only, recording why neither code override is worth shipping and pointing background-agent authors at `ctx.modelRegistry.streamSimple()`.
The direction changed twice during planning, both times on evidence, and the build and ship stages ran without rework beyond self-caught slips.

### Observations

#### What went well

- Reading a real published consumer refuted a premise the repo had carried since #46.
  `npm pack pi-observational-memory` plus one `cat` of `src/agents/worker-stream.ts` showed the canonical background agent already on the supported path, which collapsed a code plan into a docs plan.
- A disposable probe extension issuing one request from `session_start`, counted by `before-provider-request` debug lines, gave a deterministic routing signal when the HTTP status did not discriminate (the synthetic payload returned 200 even unshaped).
  Re-running it at the start of the build stage meant the committed docs cite a measurement from the shipped tree.
- Re-asking after new evidence, rather than planning on the operator's first answer, followed `AGENTS.md`'s "Do not ask on an open gap" and cost one extra question instead of a reverted plan.

#### What caused friction (agent side)

- `missing-context` — the planning session answered the issue's four questions from the pi clone and did not load `upstream-watch` or sweep changelogs until the operator said Pi had shipped many releases since the issue was filed.
  Impact: the release sweep (and everything it found) depended on a user nudge; without it the plan would have weighed only the api-registry override.
- `premature-convergence` / `instruction-violation` (self-identified) — the first `ask_user` offered a provider-aware `setDefaultStreamFn` override designed from `stream-fn.ts` in the clone, before confirming `getDefaultStreamFn` was exported from the installed `pi-agent-core` `dist/index.d.ts`.
  `code-design` already says to confirm an API exists in the installed version before designing around it.
  Impact: the operator picked an option the next four tool calls refuted; one extra `ask_user` round, no commits wasted.
- `other` (tooling) — `rg` skips hidden paths, so repo-wide claim sweeps silently omitted `.pi/skills/`.
  The planning sweep needed a separate `.pi` grep, and the build's final sweep needed a re-run with `--hidden` after a zsh word-split re-run.
  Impact: two extra tool calls; a stale claim in a skill could have shipped unnoticed.
- `instruction-violation` (self-identified) — an `Edit` `newText` wrote two literal escaped em-dashes into `.pi/skills/anthropic/SKILL.md`, and a `$X` flag variable was not word-split by zsh.
  Both rules exist (`AGENTS.md` Editing Conventions item 4, Shell); the `u20xx` scan and an empty-output check caught them.
  Impact: one fix edit and one re-run.
- `other` — the first probe filter used `^` anchors on output lines that did not start there, and the empty result briefly read as failed runs A and C.
  Impact: one extra tool call to read raw output.

#### What caused friction (user side)

- The operator's one-line nudge ("Pi has had quite a number of releases") was the highest-leverage input of the session.
  It arrived mid-investigation; the same context in the issue body ("re-check against the latest Pi before planning") or a prompt rule would have made it unnecessary.

### Diagnostic details

- **Model-performance correlation** — the main session ran `claude-opus-5-5`; the one subagent, `pre-completion-reviewer`, ran `claude-sonnet-5` and independently re-verified every upstream claim at two tags, a good fit for fact re-verification.
- **Unused-tool detection** — the `upstream-watch` skill, indexed in `AGENTS.md` for "change code that depends on upstream internals", was never loaded during planning; its "Read both changelogs" section is the sweep the operator had to request.
- **Feedback-loop gap analysis** — nothing notable: `pnpm run lint` ran after every build step, `check` after the `src/` comment edits, and `test` before review and before push.

### Changes made

1. `.pi/prompts/plan-issue.md`: Load skills gains an `upstream-watch` bullet for issues that revisit an upstream-dependent decision, with a changelog sweep through the latest release and `main`.
2. `.pi/prompts/plan-issue.md`: the Decide section gains an export check (installed `dist/index.d.ts`) and a real-caller check (`npm pack <pkg>`) before an `ask_user` option rests on either.
3. `.pi/skills/pi-cli-repro/SKILL.md`: new "Prove which call paths reach the wrapper" experiment (probe extension plus `before-provider-request` line counts).
4. Declined by the operator: an `rg --hidden` line in `.pi/skills/shell-traps/SKILL.md`.
