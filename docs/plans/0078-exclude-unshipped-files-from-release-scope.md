---
issue: 78
issue_title: "AGENTS.md-only commits cut a release with a byte-identical tarball"
---

# Exclude `AGENTS.md` and top-level tooling config from the release scope

## Release Recommendation

**Release:** ship independently

Issue #78 is not part of any `docs/architecture.md` roadmap step, so it carries no `Release:` tag.
A patch is already pending regardless: `./scripts/release/next-version.sh` prints `v3.2.2` today because of `3c39718` (a `README.md` change, which is shipped).

## Problem Statement

`scripts/release/lib.sh` decides what counts toward a release through `CLIFF_EXCLUDED_PATHS`.
It excludes `CHANGELOG.md`, `docs/plans/**`, `docs/retro/**`, and `.pi/**`, and it justifies the `.pi/**` entry by the fact that the directory is absent from `package.json` `files`, so a `.pi`-only bump publishes a byte-identical tarball.
`AGENTS.md` is in exactly that position but is not listed, so every commit that touches only `AGENTS.md` (plus already-excluded paths) keeps a release pending.
The issue asks to add it, and to check `files` for any other tracked, unshipped top-level file that belongs on the same list.

## Goals

- Exclude `AGENTS.md` from the release scope, on the same rule as `.pi/**`.
- Exclude every tracked top-level tooling file absent from the tarball (`.editorconfig`, `.fallowrc.json`, `.gitignore`, `.rumdl.toml`, `biome.json`, `cliff.toml`, `eslint.config.js`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `prek.toml`, `tsconfig.json`).
- Correct the `lib.sh` comment's claim that the `docs/*.md` reference docs are "shipped": they are not in the tarball, and they stay in scope for a different, stated reason.
- Bring the two prose descriptions of the release scope (`AGENTS.md` Releases, `.pi/prompts/ship-issue.md` step 4b) up to date; both were already stale, omitting `.pi/**`.

Not breaking: nothing a package consumer observes changes.
The only effect is that fewer commits enter future changelogs and fewer intervals cut a release.

## Non-Goals

- **An include-path allowlist.** Scoping the release to `--include-path` over the shipped paths was considered and declined by the operator in favor of an explicit exclude list that keeps parity in shape with `pi-packages`.
- **Excluding the `docs/*.md` reference docs** (`architecture.md`, `comparison-to-similar-projects.md`, `builtin-transport-seam-*.md`).
  The operator chose to keep them in scope so their changes reach the changelog, even though they drove two of the four byte-identical releases measured below.
- **Excluding directories** (`.github/**`, `scripts/**`, `test/**`).
  `ci:`, `build:`, and `test:` commits are already skipped by type in `cliff.toml`; the residual is a `fix(release):`/`chore:` commit to `scripts/`, which this plan's own step 1 illustrates and accepts.
- **A drift guard** that fails when a new top-level file is neither shipped nor excluded (see Open Questions).
- **The remaining `.pi/prompts` drift with `pi-packages` (#77).**
  #77's measured drift table does not list `ship-issue.md`, and the one-line edit here is a local adaptation (the `pi-packages` scope is `packages/<pkg>/**`), so the two do not collide.

## Background

- `scripts/release/lib.sh` owns `CLIFF_EXCLUDED_PATHS` and `cliff_args`, which turns each entry into `--exclude-path <glob>`.
  All four release scripts (`next-version.sh`, `prepare-release.sh`, `publish-released.sh`, `create-github-release.sh`) source it, so one edit changes every consumer.
- git-cliff retains a commit when any of its changed files is outside the excluded globs, so a mixed commit (`AGENTS.md` plus `src/`) still counts.
- The array form is load-bearing: the comment above it explains that a space-separated string collapses into a single bogus glob when sourced from zsh.
- `package.json` `files` is `["src", "README.md", "CHANGELOG.md", "LICENSE"]`; `npm pack --dry-run` confirms the tarball holds exactly those plus `package.json`.
- `pi-packages` gets this for free: its `cliff_args` passes `--include-path "packages/${pkg}/**"`, so its root `AGENTS.md` and tooling config are never in any package's scope.
- AGENTS.md: "commits touching only `docs/plans/**` or `docs/retro/**` do not" cut a release is prose that this change makes further out of date, and the Releases section tells readers to ask `next-version.sh` rather than reason from commit types.

## Design Overview

### Evidence (all measured on current `main`, 2026-09-23)

- **The issue reproduces.**
  Rendering `v3.2.0..v3.2.1` through `cliff_args` yields 4 changelog entries; adding `--exclude-path AGENTS.md` yields 0.
  With this change `v3.2.1` would not have been cut.
- **Historical drivers.**
  Of 35 release intervals, 4 contained no releasable commit touching a shipped path (`src/`, `README.md`, `LICENSE`, `package.json`): `v2.0.5` and `v3.2.1` (`AGENTS.md`-only commits), `v0.6.4` and `v2.0.6` (`docs/*.md` reference docs).
  No top-level tooling file ever drove a release on its own; excluding them is preventive, chosen by the operator.
- **Per-commit behavior with the new list** (changelog entries, before → after):

  | Commit | Touches | Before | After |
  | --- | --- | --- | --- |
  | `e70806c` | `biome.json` | 1 | 0 |
  | `2142af7` | `pnpm-workspace.yaml` | 1 | 0 |
  | `329c979` | `cliff.toml` | 1 | 0 |
  | `55ae7bc` | `AGENTS.md` | 1 | 0 |
  | `cac6c37` | `AGENTS.md`, `docs/architecture.md`, … | 1 | 1 |
  | `40ddc5a` | tooling files plus `.markdownlint-cli2.yaml` (no longer tracked) | 1 | 1 |
  | `3c39718` | `README.md`, a retro | 1 | 1 |

  Whole-history changelog entries: 140 → 100.
- **Dotfile globs match.**
  No historical commit touches only a dotfile, so a throwaway clone committed a `chore:` touching only `.editorconfig` plus one touching `.github/workflows/ci.yml`; with the new excludes the first dropped and the second stayed.

### The change

`CLIFF_EXCLUDED_PATHS` gains twelve literal entries, grouped under the existing `.pi/**` rule:

```bash
CLIFF_EXCLUDED_PATHS=(
  "CHANGELOG.md"
  "docs/plans/**"
  "docs/retro/**"
  ".pi/**"
  "AGENTS.md"
  ".editorconfig"
  ".fallowrc.json"
  ".gitignore"
  ".rumdl.toml"
  "biome.json"
  "cliff.toml"
  "eslint.config.js"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "prek.toml"
  "tsconfig.json"
)
```

The comment block is reworked, not only extended:

1. The `.pi/**` paragraph becomes the general rule: tracked content absent from `package.json` `files` is out of scope, because a bump for it publishes a byte-identical tarball.
   It names the three groups that fall under it (the `.pi/` workflow toolkit, `AGENTS.md` as contributor and agent guidance, and the top-level tooling config) and says a new top-level tooling file belongs on the list.
2. The `docs/` paragraph drops "shipped" (checked against `npm pack --dry-run`).
   It says the reference docs are not in the tarball, reach users through `README.md` links to GitHub, and stay in scope deliberately so their changes reach the changelog.
3. The `pi-packages` parity sentence is kept and extended: `pi-packages` needs no such entries because its `--include-path "packages/<pkg>/**"` already leaves root files out.

`package.json` stays out of the list: it is shipped, and its changes (dependency ranges, `version`) alter the tarball.

### Prose sites

Both prose descriptions point at `CLIFF_EXCLUDED_PATHS` as the list instead of enumerating it, so the next addition cannot leave them stale again:

- `AGENTS.md` Releases: commits touching only paths outside the published tarball (plans, retros, `.pi/`, `AGENTS.md`, top-level tooling config) do not cut a release; `CLIFF_EXCLUDED_PATHS` in `scripts/release/lib.sh` is the list, and `docs/*.md` reference docs stay in scope.
- `.pi/prompts/ship-issue.md` step 4b: the same fact in one sentence.

Order matters for the changelog: step 1's `fix(release):` commit touches `scripts/release/lib.sh`, which stays in scope, so it appears under Bug Fixes (as `ac4c6f8` did for `.pi/**`).
Step 2's commit touches only `AGENTS.md` and `.pi/`, so once step 1 has landed it is excluded by its own rule.

## Module-Level Changes

- `scripts/release/lib.sh` — add twelve entries to `CLIFF_EXCLUDED_PATHS`; rework the comment block as above.
- `AGENTS.md` — rewrite the release-scope sentence in Development → Releases (currently line 292).
- `.pi/prompts/ship-issue.md` — rewrite the release-scope clause in step 4b (currently line 67).

Greps run at planning time for the mechanism's vocabulary (`release scope`, `excluded from the release`, `retro-only`, `plan-only`, `docs-only range`, `CLIFF_EXCLUDED`) across `AGENTS.md`, `README.md`, `docs/` (excluding plans and retros), and `.pi/` found only those two prose sites.
`docs/architecture.md` has no release-scope content, and no `src/`/`test/` file is touched.

## Test Impact Analysis

No Vitest suite covers `scripts/release/`, and this change adds none: it is a data edit to a sourced shell array whose effect is observable only through git-cliff over real history.
Verification is by command, recorded per step below.

## Invariants at risk

- **The array survives zsh sourcing** (the `lib.sh` comment's own invariant).
  Pin: `zsh -c '. scripts/release/lib.sh; cliff_args; print -l -- $CLIFF_ARGS' | grep -c -- --exclude-path` prints `16` (currently `4`).
- **Mixed commits still count.**
  Pin: `cac6c37` and `3c39718` each still render one entry (table above).
- **The pending release is unchanged.**
  Pin: `./scripts/release/next-version.sh` prints `v3.2.2` before and after (the pending bump comes from `3c39718`'s `README.md` change and, after step 1, from the `fix(release):` commit itself).

## Build Order

This is a non-TDD plan (shell data and prose); execute it with `/build-plan`.
The Tidy-First assessment was skipped: the change touches no `src/`/`test/` files.

1. **`scripts/release/lib.sh`: exclude `AGENTS.md` and the top-level tooling config.**
   Add the twelve entries and rework the comment block per Design Overview.
   Verify:
   - `shellcheck scripts/release/*.sh` is clean.
   - `bash -c '. scripts/release/lib.sh; cliff_args; git-cliff "${CLIFF_ARGS[@]}" v3.2.0..v3.2.1 --strip all' | grep -c '^\*'` prints `0` (was `4`).
   - The per-commit table reproduces with `"$h^..$h"` ranges, and the whole-history count is `100`.
   - The zsh invariant above prints `16`.
   - Every tracked top-level file is shipped or excluded: `git ls-files | grep -v / | grep -vxE 'README\.md|LICENSE|CHANGELOG\.md|package\.json|AGENTS\.md|\.editorconfig|\.fallowrc\.json|\.gitignore|\.rumdl\.toml|biome\.json|cliff\.toml|eslint\.config\.js|pnpm-lock\.yaml|pnpm-workspace\.yaml|prek\.toml|tsconfig\.json'` prints nothing.
   - `./scripts/release/next-version.sh` prints `v3.2.2`.

   Commit: `fix(release): exclude AGENTS.md and top-level tooling config from the release scope (#78)`.
2. **Prose: name the full release-scope exclusions.**
   Rewrite the `AGENTS.md` Releases sentence and the `ship-issue.md` step 4b clause per Design Overview.
   Verify: `pnpm run lint` and `pnpm exec rumdl check .pi` are clean; `./scripts/release/next-version.sh` still prints `v3.2.2`, and rendering `HEAD^..HEAD` through `cliff_args` yields 0 entries (the commit is excluded by step 1's rule).

   Commit: `docs: name the full release-scope exclusions in AGENTS.md and ship-issue (#78)`.

## Risks and Mitigations

- **A future tooling file is added and not listed.**
  Its commits cut releases again, silently.
  Mitigation: the reworked comment states the rule so the list reads as policy rather than an arbitrary set, and step 1's "every top-level file is shipped or excluded" command is the check to rerun; a standing guard is an Open Question.
- **A shipped behavior hides in an excluded file.**
  If `files` ever grows to include one of these paths (for example shipping `tsconfig.json`), excluding it would hide real tarball changes.
  Mitigation: the comment ties the list to `package.json` `files` explicitly, so editing `files` points back at it.
- **`cliff.toml` changes drop out of the changelog.**
  A `chore:` changing changelog rendering no longer appears in the next changelog.
  Accepted: the rendered changelog itself is the visible artifact, and the change is not a released behavior.
- **Glob anchoring.**
  A literal pattern such as `AGENTS.md` is matched against the whole repository-relative path; a hypothetical nested `AGENTS.md` would not be matched.
  Accepted: none exists, and a nested one would be a new decision anyway.

## Open Questions

- **A standing drift guard.**
  A CI or `prek` check that fails when a tracked top-level file is neither in `package.json` `files` nor in `CLIFF_EXCLUDED_PATHS` would close the first risk.
  Deferred until a missed file actually drives a release; not filed.
