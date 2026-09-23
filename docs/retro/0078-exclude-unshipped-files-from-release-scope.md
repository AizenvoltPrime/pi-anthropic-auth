---
issue: 78
issue_title: "AGENTS.md-only commits cut a release with a byte-identical tarball"
---

# Retro: #78 — AGENTS.md-only commits cut a release with a byte-identical tarball

## Stage: Planning (2026-09-23T04:45:11Z)

### Session summary

Planned a two-step `/build-plan` change: add `AGENTS.md` and the eleven tracked top-level tooling files to `CLIFF_EXCLUDED_PATHS` in `scripts/release/lib.sh`, rework its comment, and repoint the two stale release-scope prose sites (`AGENTS.md` Releases, `.pi/prompts/ship-issue.md` step 4b) at the array.
Every claim in the plan was measured against git-cliff over real history before writing.

### Observations

- The issue reproduces: `v3.2.0..v3.2.1` renders 4 entries today and 0 with `--exclude-path AGENTS.md`.
- Of 35 release intervals, 4 touched no shipped path: 2 from `AGENTS.md`-only commits (`v2.0.5`, `v3.2.1`), 2 from `docs/*.md` reference docs (`v0.6.4`, `v2.0.6`); no tooling file ever drove a release alone.
- A premise inherited from #63 was false: the `lib.sh` comment calls the `docs/*.md` reference docs "shipped", but `npm pack --dry-run` shows the tarball holds only `src/`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`.
- Operator chose option B (exclude `AGENTS.md` plus tooling files) over A (`AGENTS.md` only) and C (an `--include-path` allowlist), and chose to keep the reference docs in scope with a corrected comment.
- Dotfile glob matching had no historical evidence, so it was checked with throwaway commits in a temp clone.
- Both prose sites were already stale before this issue (they omitted `.pi/**`); the plan points them at the array instead of enumerating it again.
- Planning-time trap: a zsh `for ((i=1; …))` loop over an array silently shifted every tag pair by one (zsh arrays are 1-indexed); rerunning under `bash -c` fixed it.
- A standing drift guard (top-level file neither shipped nor excluded) was left as an Open Question and not filed.
- Tidy-First skipped: no `src/`/`test/` files touched.

## Stage: Implementation — Build (2026-09-23T04:48:55Z)

### Session summary

Both plan steps landed as planned: `15f1f11` added twelve entries to `CLIFF_EXCLUDED_PATHS` and reworked the `lib.sh` comment (including the corrected `docs/` "shipped" claim), and `5180fa9` repointed the `AGENTS.md` Releases sentence and `ship-issue.md` step 4b at the array.
Every measured prediction reproduced: `v3.2.0..v3.2.1` renders 0 entries, the per-commit table matches, zsh sourcing yields 16 `--exclude-path` flags, and `next-version.sh` still prints `v3.2.2`.

### Observations

- No deviations from the plan.
- `shellcheck scripts/release/*.sh` reports a pre-existing SC2129 style note in `prepare-release.sh` (identical on the base); `lib.sh` alone is clean, and shellcheck is not part of `pnpm run lint`.
- Whole-history entry count is 101 after step 1, not the plan's 100: the plan measured before the `fix(release):` commit existed, and that commit is itself in scope, as the plan predicted.
- Step 2's commit is excluded by step 1's own rule (0 entries for `HEAD^..HEAD`).
- Pre-completion reviewer: WARN.
  Reviewer warnings: the standing drift guard in Open Questions has no issue number; this is the deliberate, unfiled deferral recorded at planning.

## Stage: Final Retrospective (2026-09-23T19:08:37Z)

### Session summary

One session covered planning, build, ship, and this retro.
It planned and landed two commits (`15f1f11` `fix(release):`, `5180fa9` `docs:`) that exclude `AGENTS.md` and eleven top-level tooling files from the release scope and correct the `lib.sh` claim that the `docs/*.md` reference docs are shipped.
CI was green, #78 closed, and `v3.2.2` released; the pre-completion reviewer returned WARN (the intentionally unfiled drift guard).

### Observations

#### What went well

- **Testing an inherited premise paid off.**
  The `lib.sh` comment and the #63 plan both called the `docs/*.md` reference docs "shipped"; one `npm pack --dry-run` showed they are not in the tarball.
  That turned a silent assumption into an explicit operator decision (keep them in scope, with the reason stated), which is what the `AGENTS.md` "A cited claim is not a verified one" rule asks for.
- **Measured options before asking.**
  The `ask_user` options carried measured counts (4 of 35 intervals shipped no package change; 2 from `AGENTS.md`, 2 from reference docs, 0 from tooling), so the operator chose B knowing it was preventive rather than evidenced.
- **Every plan prediction was a runnable command.**
  The build stage re-ran them verbatim and the reviewer re-ran them independently; the only drift (history count 100 to 101) was the plan's own `fix(release):` commit, which the plan had predicted would be in scope.
- **Throwaway clone for missing evidence.**
  No historical commit touched only a dotfile, so glob matching for `.editorconfig` was checked with synthetic commits in a `mktemp` clone instead of being assumed.

#### What caused friction (agent side)

1. `other` (zsh array indexing) — the first per-release-interval scan used `tags=($(...))` with a C-style `for ((i=1; i<${#tags[@]}; i++))` loop over `tags[i-1]`/`tags[i]`.
   zsh arrays are 1-indexed, so every pair shifted by one and `v3.2.1` (the issue's own case) was missing from the output.
   Self-caught because the known-positive case was absent; rerun under `bash -c`.
   Impact: one rerun; a wrong table was nearly used as evidence.
2. `instruction-violation` (self-identified, at retro) — `/plan-issue` mandates loading `anthropic`, `colgrep`, `code-design`, and `design-review`, and `/build-plan` mandates `anthropic`; only `markdown-conventions` and `pre-completion` were loaded.
   The change was release shell data and prose with no OAuth or TypeScript surface, and the Skill Index gates those skills on `src/` work.
   Impact: none observed.
3. `other` (unnoticed unpushed commit) — `7822cf0 chore: remove unnecessary @latest` was already local and unpushed when the session started (`git pull --ff-only` reports "Already up to date." when ahead), and the ship push carried it.
   Named in the final report, and it is `.pi/`-only, so excluded from the changelog.
   Impact: none, but it was noticed only from the push range, not checked before pushing.
4. `other` (em-dash corruption) — in this retro entry, all five em-dashes were emitted as a bare newline plus `dash;`, one of the forms the `markdown-conventions` skill lists.
   The note recording it split the same way (a sixth instance).
   The skill's post-write scans caught every instance, and scripted substitutions repaired them.
   Impact: two repair calls.

#### What caused friction (user side)

- None this session; the operator's single decision point (scope B, keep reference docs) was answered once and not revisited.
- Opportunity: the issue already asked to "check `package.json` `files` for any other tracked, unshipped top-level file"; naming the preferred mechanism (exclude list vs include-path) in the issue would have removed one of the two `ask_user` questions.

### Diagnostic details

1. **Model-performance correlation** — every main-session turn ran on `anthropic/claude-opus-5-5`, including the mechanical ship stage (push, CI watch, close, release), as in #76.
   The `pre-completion-reviewer` ran on its configured `anthropic/claude-sonnet-5` (34 tool uses, 90 s) and independently re-derived every measured prediction, a good fit.
2. **Feedback-loop gap analysis** — verification was incremental: baseline `check`/`lint` before step 1, per-step `shellcheck`, git-cliff, zsh-sourcing, and `lint` runs, then the full suite at ship.
   `shellcheck` is not part of `pnpm run lint`, so its pre-existing SC2129 note in `prepare-release.sh` surfaced only because the plan named the command.

### Changes made

1. No prompt, skill, or `AGENTS.md` changes.
   The one proposal (a zsh 1-indexed-array rule in the `AGENTS.md` Shell section) was declined by the operator; it stays recorded here only.
   Considered and not proposed: conditional `anthropic` skill loading across five prompts (belongs to the #77 resync), a pre-push unpushed-commit listing in `/ship-issue` (no harm observed), and a `shellcheck` lint gate (out of retro scope).
