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
