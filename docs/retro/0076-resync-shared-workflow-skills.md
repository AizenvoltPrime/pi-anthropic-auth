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

[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
[#77]: https://github.com/gotgenes/pi-anthropic-auth/issues/77
[#78]: https://github.com/gotgenes/pi-anthropic-auth/issues/78
