---
issue: 76
issue_title: "Resync shared workflow skills with pi-packages and port shell-traps/edit-tool"
---

# Retro: #76 — Resync shared workflow skills with pi-packages and port shell-traps/edit-tool

## Stage: Planning (2026-09-23T03:35:43Z)

### Session summary

Diffed all ten shared skills against pi-packages `main` (`60c22b0a`) and classified every hunk as keep-local, port, or drop in the plan's Design Overview.
The operator chose "skills + coupled hunks" (so the Tidy-First assessor moves into `/plan-issue`, and the reviewer gains `fallow decision-surface`), an `AGENTS.md` Skill Index for load triggers, and leaving local-only improvements local.
Filed [#77] (remaining prompt/agent drift) and [#78] (`AGENTS.md`-only commits cut a release).

### Observations

- The issue's drift table missed `fallow` (145 lines) and `improvement-discovery` (270); most of the latter is upstream's `MD060 aligned` table padding, which this repo does not use.
- Upstream's `fallow` skill documents 3.22; this repo pins 2.104.0, which lacks `guard`, `suppressions`, `type-aware`, `similar-code`, and `--symbol-impact` (measured via `--help`).
  `decision-surface` does exist on 2.104.0 and emits JSON (measured), so the reviewer's §2k ports cleanly minus its `coupling-boundary` arm (no zones here).
- `pi-autoformat` is installed globally but inert here (no `chains` config), so its reflow rules are dropped rather than ported.
- Upstream dropped the `u20[0-9a-f]{2}` scan from `markdown-conventions`; this repo's [#74] failures were exactly those visible forms, so the plan merges instead of porting wholesale, and pins the scan with a grep.
- `lint:md` does not cover `.pi/**`; every build step runs `pnpm exec rumdl check .pi` explicitly (baseline: 25 files clean).
- This session hit zsh equals-expansion itself (`echo ===` aborted a chain), which is the evidence for porting the zsh shell facts into `AGENTS.md`.
- `next-version.sh` already prints `v3.2.1` because `efa65f1` (a retro commit) touched one line of `AGENTS.md`; hence [#78].
- The operator should note that step 9 changes the pre-completion protocol mid-`/build-plan`: re-read the skill from disk before dispatching the reviewer.

## Stage: Implementation — Build (2026-09-23T04:01:43Z)

### Session summary

Completed all 10 plan steps as 10 `docs:` commits (`5939fd1`..`55ae7bc`): ported `shell-traps` and `edit-tool`, reconciled the ten shared skills per the plan's classification, relocated the Tidy-First assessor into `/plan-issue`, gave the reviewer the `fallow decision-surface` check, and added the `AGENTS.md` Skill Index and Shell section.
Pre-completion reviewer: PASS (base ref `efa65f1`, no decisions surfaced).

### Observations

- Every splice that carried non-ASCII text was done by a Python script copying lines from the upstream file, or with ASCII placeholders (`@BS@`, `@MD@`) substituted in the script, rather than typing em-dashes or backslash escapes into `Edit` bodies; no corruption reached a commit (every step ran the `u20`, split-sentence, and form-feed scans).
- Measured deviation: on fallow 2.104.0, `review --brief --quiet` prints nothing in human format (like `decision-surface`), so the `fallow` skill runs `review --brief` without `--quiet`, unlike upstream.
- The `--config .rumdl.toml` claim for files outside the repo was verified: without it, a `/tmp` sample reports MD013 at 80 characters.
- Deviation: the Skill Index landed as `### Skill Index` under `## Architecture` (next to the Project Skills/Prompts/Agents lists), not as a top-level `##` section; the `AGENTS.md` intro points to it.
- Upstream's reviewer output example for WARN used a `coupling-boundary` signal, which this repo cannot emit, so it was replaced with a `public-api-contract` WARN built from a real signal this repo produced during planning.
- Upstream's `code-design` "Shared predicate" section carried a sentence split across three lines (an autoformat artifact); it was rejoined on port.

## Stage: Final Retrospective (2026-09-23T04:05:48Z)

### Session summary

One session covered planning, build, ship, and this retro: 10 `docs:` commits resynced the shared skills, ported `shell-traps` and `edit-tool`, moved the Tidy-First assessor into `/plan-issue`, and added the `AGENTS.md` Skill Index; the reviewer returned PASS, CI was green, and `v3.2.1` shipped (a byte-identical tarball, tracked by [#78]).
The prompt/agent drift the operator scoped out is [#77].

### Observations

#### What went well

- Novel: splicing ported text by script instead of retyping it.
  Each skill, prompt, and agent edit read the upstream file in Python and copied its lines (or used ASCII placeholders substituted in the script), so no em-dash or backslash was ever typed into an `Edit` body.
  Result: about 20 edited files, zero corruption, zero repair calls, against four corruptions and about 12 repair calls in one docs step of [#74].
- A throwaway `verify76.sh` (rumdl on `.pi` plus `AGENTS.md`, the three non-ASCII scans, and the leakage grep) ran after every step, which made the plan's Invariants 1-4 a per-commit check instead of an end-of-build sweep.
- Measuring the installed fallow's surface at planning time (`--help` per subcommand, a live `decision-surface` run) kept 3.x-only content (`guard`, `--symbol-impact`, `--type-aware`) out of the port; the reviewer independently confirmed every documented command exists on 2.104.0.

#### What caused friction (agent side)

1. `instruction-violation` (self-identified, recurring: the #74 retro and pi-packages both record it) — `echo =========` separators aborted command chains under zsh equals-expansion three times during planning.
   At that point `AGENTS.md` did not yet carry the zsh facts (step 1 added them), so the rule lived only in pi-packages.
   Impact: one lost `cat` of `edit-tool` needing a separate `Read`; the other two only printed an error after the useful output.
2. `missing-context` — the plan's step 6 verify checked each ported fallow command with `--help` (existence) but not its output under the documented flags; `review --brief --quiet` prints nothing on 2.104.0, found only at build time.
   Impact: one extra measurement and a documented deviation, no rework.
3. `other` — the build stage heading was written as `Implementation - Build` (ASCII hyphen) to dodge em-dash emission, diverging from the template's `Implementation — Build` that later greps match on.
   Impact: none until fixed here by scripted substitution.
4. `other` — the plan's leakage regex first used `/ship\b`, which also matches `/ship-issue`; caught while self-reviewing the plan, before commit.
   Impact: one edit.

#### What caused friction (user side)

- The issue's Proposed change step 1 asked to classify hunks as "local improvement (push upstream)", and the operator then chose to leave them local.
  Opportunity: when filing a resync issue, state whether upstream pushes are in scope, so the planning `ask_user` has one decision fewer.

### Diagnostic details

1. **Model-performance correlation** — every main-session turn ran on `anthropic/claude-opus-5-5`, including the ship stage (push, CI watch, close, release), which is mechanical and could run on a cheaper model; the `pre-completion-reviewer` ran on its configured `anthropic/claude-sonnet-5` (63 tool calls, 302 s) and did judgment-bearing work (spot-diffing every ported file against upstream), a good fit.
2. **Feedback-loop gap analysis** — rumdl, the non-ASCII scans, the leakage grep, and `pnpm run lint` ran after every build step; no gap.

### Changes made

1. `docs/retro/0076-resync-shared-workflow-skills.md`: this Final Retrospective entry, and the build stage heading corrected from `Implementation - Build` to the template spelling.
2. Proposed and declined by the operator: a `markdown-conventions` sentence recommending splicing existing text by script rather than retyping it; the evidence stays in this retro only.

[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
[#77]: https://github.com/gotgenes/pi-anthropic-auth/issues/77
[#78]: https://github.com/gotgenes/pi-anthropic-auth/issues/78
