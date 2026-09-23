---
name: fallow
description: |
  Load before running `fallow` or reading its output: dead code, duplication, complexity,
  symbol traces, change review, and coverage gaps.
---

# Fallow

Fallow is a static analysis tool for TypeScript/JavaScript installed as a devDependency (2.104.0 at the time of writing; `pnpm exec fallow --version`).
It finds unused code, duplication, complexity hotspots, and refactoring targets, and it answers targeted questions about one file or one symbol.
Run it via `pnpm fallow` scripts or `pnpm fallow <subcommand>`, never `npx`.

## Quick reference

```bash
pnpm fallow                # full analysis: dead code + dupes + health
pnpm fallow:audit          # changed-file audit (PR gate)
pnpm fallow:health         # complexity, hotspots, refactoring targets
pnpm fallow:dead-code      # unused files, exports, types, deps
pnpm fallow:dupes          # duplicated code blocks
```

Question-shaped subcommands, each scoped smaller than a full run:

| Question | Command |
| --- | --- |
| What are this file's exports, imports, importers? | `fallow inspect --file <path>` |
| Who consumes this symbol? | `fallow dead-code --trace <file>:<symbol>` |
| What structural decisions does this change embed? | `fallow decision-surface --base <ref> --format json` |
| Where should a reviewer look in this change? | `fallow review --brief --base <ref>` |
| What is untested but reachable? | `fallow health --coverage-gaps` |
| What does this finding mean? | `fallow explain <issue-type>` |

The pi-packages copy of this skill documents fallow 3.x; `guard`, `suppressions`, `similar-code`, `--type-aware`, and `--symbol-impact` do not exist on 2.104.0.
Check `pnpm exec fallow <subcommand> --help` before adopting a command from there.

## JSON output for programmatic use

Always invoke via `pnpm --silent fallow … --format json --quiet 2>/dev/null` and append `|| true`.
The `--silent` is load-bearing: fallow exits 1 when issues are found (normal), and without `--silent` pnpm appends `[ELIFECYCLE] Command failed with exit code 1.` to **stdout** after the JSON — `json.load` then fails with "Extra data", and `2>/dev/null` does not strip it.
Only exit code 2 is a real error.
Some subcommands print nothing in human format under `--quiet` (`decision-surface` and `review --brief` both, measured on 2.104.0) — read `decision-surface` as JSON, and run `review --brief` without `--quiet`.

```bash
pnpm --silent fallow dead-code --format json --quiet 2>/dev/null || true
pnpm --silent fallow health --score --targets --format json --quiet 2>/dev/null || true
```

## Useful flags

| Flag | Purpose |
| --- | --- |
| `--unused-exports` | Filter to only unused exports |
| `--unused-files` | Filter to only unused files |
| `--changed-since main` | Only files changed since a ref (alias `--base`) |
| `--score` | Show health score (0–100) |
| `--hotspots` | Riskiest files by churn × complexity |
| `--targets` | Ranked refactoring recommendations |
| `--mode semantic` | Duplication: catch renamed-variable clones |

## Proving "nothing else calls this"

```bash
pnpm --silent fallow dead-code --trace <file>:<symbol> --quiet
```

`--trace` reads the module graph syntactically; on fallow 3.x, pi-packages measured it listing a consumer that takes the symbol as an object-literal shorthand property, which the type-aware `--symbol-impact` missed.
It cannot see a fully dynamic `import(variable)`; grep the symbol's name as well before deleting.

## Coverage gaps

`health --coverage-gaps` is a static question: which runtime files and exports no test dependency path reaches.
Read it as a reachability lead, not a coverage number, and discount barrels — an export re-exported from `index.ts` whose tests import the source module directly reads as untested.
CRAP scores are **estimated** from export references unless you feed real Istanbul coverage with `--coverage`, which needs `@vitest/coverage-istanbul` (not installed here).

## Change review

```bash
pnpm --silent fallow decision-surface --base <ref> --format json --quiet 2>/dev/null || true
pnpm --silent fallow review --brief --base <ref>
```

`decision-surface` returns at most five `signal_id`-anchored questions (`public-api-contract`, `coupling-boundary`, `dependency`); it always exits 0 and gates nothing.
This repo declares no `boundaries` zones, so `coupling-boundary` does not fire here.
`review --brief` renders the same analysis as an orientation brief ("where do I look?") rather than a verdict.
The `pre-completion-reviewer` runs the first of these over the range it reviews; a judgment it reports must cite a `signal_id` fallow emitted.

## Configuration

Config lives at `.fallowrc.json` in the repo root.
This is a single package, so the config declares one entry point manually — the Pi extension entry `["src/index.ts"]` — since fallow does not know that convention.
Rules use `"error"` (fail CI), `"warn"` (report only), or `"off"` (skip).

## Suppressing findings

```typescript
// fallow-ignore-next-line unused-export
export const keepThis = 1;

// fallow-ignore-next-line unused-type
export type KeepThisType = string;

// fallow-ignore-file
```

The kind token must be the exact singular issue kind (`unused-class-member`, not `unused-class-members`) and the only text after the directive — fallow parses every space-separated token as a kind, so trailing prose (`-- because …`) produces "stale suppression" noise.
Put rationale on the line above the directive.

Use `/** @public */` or `/** @expected-unused */` JSDoc tags for library API exports.

## Auto-fix cycle

Always dry-run first:

```bash
pnpm fallow fix --dry-run    # preview
pnpm fallow fix --yes        # apply (--yes required in non-TTY)
pnpm fallow dead-code        # verify
```

## Key gotchas

1. The default run resolves the module graph syntactically (no TypeScript compiler), so a fully dynamic `import(variable)` is not resolved.
2. Re-export chains through barrel files are resolved correctly.
3. `--changed-since` is additive — only new issues in changed files.
4. Never run `fallow watch` — it is interactive and never exits.
5. The human-readable `health --targets` output omits the "Refactoring targets" section entirely when there are zero targets — to confirm a file dropped off the list, use `--format json` and check the `targets` array is empty rather than grepping the text output.
6. Class-member liveness is keyed off `implements` clauses: a member reached only through a structural type the class does not explicitly `implements` reads as dead once the last `implements` is removed.
   Prefer re-declaring the genuine contract (`implements ThatInterface`) over a suppression.
   If the consumer is wired via an object-literal property (which fallow cannot trace), prefer moving the read into a traced closure body at the composition root (e.g. `getX: () => owner.member`) over a suppression; suppress only when neither is practical.
   A test helper that returns the instance inside an object literal (`return { provider, live }`) hides its call sites the same way — return the instance directly and pass collaborators in as parameters.
7. Duplication reports coordinates, not contents: when planning a dedup, read each clone group's exact line ranges before describing it.
   The same byte-run is often an act + assertion sequence (the test subject — do not collapse it) rather than a fixture literal that can be extracted.
