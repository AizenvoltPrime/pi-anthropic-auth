---
issue: 76
issue_title: "Resync shared workflow skills with pi-packages and port shell-traps/edit-tool"
---

# Resync the shared workflow skills with pi-packages

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` carries no roadmap step for this issue, so it is not a batch member.
Every `.pi/**` commit is outside the release scope (`scripts/release/lib.sh`), but the `AGENTS.md` commits are inside it, so the change cuts a patch release whose tarball is byte-identical.
A patch (`v3.2.1`) is already pending for the same reason (measured: `efa65f1` touches one line of `AGENTS.md`), and [#78] tracks excluding `AGENTS.md` from the scope.

## Problem Statement

`AGENTS.md` says this repo's shared workflow skills are "kept in parity" with `~/development/pi/pi-packages/`, but they have drifted, and pi-packages has since added skills for problems this repo keeps running into.
Two of those skills address friction recorded in the retros here.
`shell-traps` carries the `rg -r` is `--replace` rule (misfired in the [#47], [#66], and [#74] retros).
`edit-tool` covers atomic `Edit` batches and non-ASCII `oldText` (four escaped em-dash corruptions in one docs step of [#74]).
This repo also has no skill-load trigger table, so a ported skill would never be loaded.

## Goals

1. Port every upstream skill improvement that applies to a single-package repo on fallow 2.104, and classify each differing hunk as keep-local, port, or drop (the table in Design Overview).
2. Port `shell-traps` and `edit-tool`, adapted: no `pi-autoformat`, worktree, monorepo, or `invisible-characters.mjs` content.
3. Port the prompt and agent hunks two ported skills cannot stand without:
   1. `tidy-first`: the Tidy-First assessor moves from the start of `/tdd-plan`/`/build-plan` into `/plan-issue`, between Decide and Write the plan (pi-packages `abfeabc9`).
   2. `pre-completion`: the reviewer takes a base ref and runs `fallow decision-surface` over the range (pi-packages `07114233`).
4. Add an `AGENTS.md` Skill Index table ("Before you… / Load"), rewrite every shared skill description as a "Load before…" trigger, and add the zsh shell facts `shell-traps` assumes `AGENTS.md` carries.
5. Fold the `AGENTS.md` Editing Conventions `rg -r` stopgap back into `shell-traps`.

This change is **not** breaking for package users: nothing under `src/` or `package.json` `files` changes.
It does change this repo's own workflow: the Tidy-First assessment moves from implementation time to planning time.

## Non-Goals

1. Prompt and agent drift that no ported skill depends on, for example the reviewer's sanctioned reads outside the repo and the assessor's Step 2b.
   Filed as [#77].
2. Pushing this repo's local-only improvements upstream (fallow's clone-coordinates item, testing's "fold a step that cannot pass yet", "label rewritten cases red or pin", "one probe per assertion clause", and `improvement-discovery`'s `A–G`).
   The operator chose to leave them local.
3. Porting pi-packages' other skills (`clarification-gates`, `delegation`, `git-workflow`, `reading-artifacts`, `reproduction`, `releasing`, `roadmap-fit`, `worktrees`, `package-*`).
4. Porting `scripts/lint/invisible-characters.mjs`, or the visible-escape gate gotgenes/pi-packages#967 designs.
   The ported skills name the manual scan instead.
5. Bumping `fallow` from `^2.91.0` (2.104.0 installed) to 3.x.
   The `fallow` port includes only subcommands 2.104.0 has (measured: no `guard`, `suppressions`, `type-aware`, `similar-code`, or `--symbol-impact`).
6. Adopting pi-packages' roadmap format (issue-number step identity, `roadmap-check.mjs`, Open-issue sweep dispositions) or its `MD060 aligned` table style.
   This repo has no roadmap tooling, and its tables are compact.
7. Excluding `AGENTS.md` from the release scope ([#78]).
8. Extending `lint:md` to cover `.pi/**`; the build verifies `.pi` files with an explicit `rumdl check` instead.

## Background

The previous parity sync was `302a0b2` (2026-08-17, unplanned), which ported skills, agents, and prompts together, adapted to the single package, and stripped pi-packages issue refs.
This plan follows the same adaptation rules.

1. No `--filter`/`--workspace`/`packages/<PKG>`; `docs/architecture.md` is one file; tests run as `pnpm test`.
2. `/ship-issue`, not `/ship`.
3. pi-packages issue numbers are stripped, because a bare `#N` here links to this repo's issue `N`.
   Refs to this repo's own issues stay.
4. `pi-autoformat` is installed globally, but it formats nothing here: there is no `~/.pi/agent/extensions/pi-autoformat/config.json` and no project config, and its README says no formatter runs until `chains` are declared.
   Its reflow rules are dropped.

Drift was measured on 2026-09-23 against pi-packages `main` at `60c22b0a` (fetched, level with `origin/main`), counting `diff` lines on both sides:

| Skill | Lines | Composition |
| --- | --- | --- |
| `improvement-discovery` | 270 | mostly upstream table padding, monorepo paths, the scout, and the roadmap format |
| `fallow` | 145 | fallow 3.22 surface, boundaries, type-aware, snapshots, coverage |
| `markdown-conventions` | 116 | `pi-autoformat` reflow, form-feed corruption, retro format, monorepo paths |
| `testing` | 70 | new mutation/nesting rules; local-only rules from [#47], [#52], [#54] |
| `tidy-first` | 59 | assessor relocated to `/plan-issue` |
| `code-design` | 39 | four new rules and a "Reading Pi's own source" section |
| `pre-completion` | 35 | base ref, re-dispatch rules |
| `pi-extension-lifecycle` | 10 | description only |
| `mermaid` | 9 | description plus a foreign issue number in an example |
| `design-review` | 7 | description plus a pi-permission-system example |

The issue's table missed `fallow` and `improvement-discovery`.

Measured baselines:

1. `pnpm exec rumdl check .pi` passes on 25 files, and `lint:md` (`*.md docs/**/*.md`) does not cover `.pi/**`.
2. No tracked file contains a control or zero-width character (`git grep -nP '[\x00-\x08\x0b\x0c\x0e-\x1f\x{200b}-\x{200f}\x{2060}\x{feff}]'`, no hits).
3. `pnpm --silent fallow decision-surface --base HEAD~5 --format json --quiet` on 2.104.0 emits a `decisions` array with a `public-api-contract` entry, so the reviewer's decision-surface check works on the installed version.
4. This planning session's own `echo ===...` aborted a command chain under zsh equals-expansion, which is the fact `shell-traps` expects `AGENTS.md` to carry.

## Design Overview

### Hunk classification

Keep = intentional local adaptation or local-only improvement; Port = upstream improvement, adapted; Drop = monorepo-, tool-, or version-specific upstream content.

#### Descriptions (all ten shared skills)

Port each "Load before…" description (pi-packages #937's trigger form), adapted.
`markdown-conventions` drops "`pi-autoformat` reflow quirks" and "architecture-doc module tree".
`improvement-discovery` reads "Load before planning an improvement round or editing the `docs/architecture.md` roadmap" (no `/plan-improvements` here).
`tidy-first` takes the upstream `/plan-issue` wording (Goal 3).

#### `design-review`, `mermaid`, `pi-extension-lifecycle`

Description only.
Keep the local examples (`commandText()` without pi-permission-system's `BashProgram`, `(#46)` in the Mermaid label).

#### `code-design`

| Hunk | Verdict |
| --- | --- |
| Shared predicate, different burden of proof | Port |
| `git revert` a series of commits rather than hand-editing | Port |
| Reserve `promptGuidelines` for pre-choice guidance | Port |
| Reading Pi's own source | Port, adapted: `../pi` (= `~/development/pi/pi`), no worktree path, version from this repo's `devDependencies` pin under `node_modules/.pnpm/@earendil-works+pi-coding-agent@<version>*/`; keep the `AGENTS.md` gotcha "Read Pi's Source From The Clone" as is |
| `no-deprecated` on a deliberate deprecation | Port |
| pnpm `root package.json`, `catalog` | Keep local |

#### `testing`

| Hunk | Verdict |
| --- | --- |
| `.mockResolvedValue()` and the "checked against `any`" sentence | Port |
| Spike uses the `test/helpers/` builder | Drop (this repo has no `test/helpers/`) |
| `Promise.withResolvers` bullet position, and the five bullets upstream moved below the probe rules | Port upstream's order |
| "Name both outcomes… under the fixture's defaults" | Port |
| "Prove a pin by mutation… one probe per assertion clause (Refs [#52])" | Keep local, then add upstream's bullets after it: mutation scoped to one claim, two input shapes, bulk red masks probe quality, test authored after Green, ambient-global red probe |
| `describe` nesting (unit then scenario; no issue-number names) | Port (pi-subagents examples labeled "from another Pi package", as `improvement-discovery` already does) |
| Commands (`pnpm test <test-path>`) | Keep local |
| "Fold a step whose new test cannot pass until a later step" | Keep local |
| Guard-deleting mutation; classification-changing fix | Port (strip pi-packages `#965`) |
| "Label each rewritten case red or invariant pin" (Refs [#54]) | Keep local |
| Default-parameter call sites are invisible to a literal-argument grep | Port |

#### `markdown-conventions`

| Hunk | Verdict |
| --- | --- |
| `rumdl`, not `markdownlint-cli2` (no markdownlint binary) | Port |
| `--config .rumdl.toml` for a file outside the repo | Port (`.rumdl.toml` exists) |
| New: `lint:md` does not cover `.pi/**`; check skills with `pnpm exec rumdl check .pi` | Add (measured above) |
| `pi-autoformat` reflow section | Drop (inert here) |
| Non-ASCII in authored prose | Merge (below) |
| "Inserting a new section" position | Keep local |
| Issue-link URL and `docs/architecture.md` path | Keep local |
| ADR numbering across packages | Drop (no `docs/decisions/` here) |
| Frontmatter location sentence | Keep local |
| Retro file format (`date -u` timestamps, stage layout, optional Diagnostic details) | Port, adapted to `docs/retro/` |
| Architecture docs (module-tree provenance rule, `/finish-phase`) | Drop (this repo's `AGENTS.md` layout list cites issues throughout, and there is no `/finish-phase`) |
| "An accepted residual is a claim about the mechanism" | Port as its own short paragraph |

The merged "Non-ASCII in authored prose" section keeps everything [#74] added, since the visible forms are this repo's measured failures, and adds upstream's invisible form and its re-emit and placeholder guidance.
Target content:

1. An em-dash in a `newText`/`content` body is unreliably emitted, in four forms: a literal `\u2014`, a bare newline that splits the sentence, a newline plus `u2014`, or an invisible `\x0c` form feed plus literal text (`erence2` for an em-dash, `erence6` for an ellipsis).
2. All four are valid markdown, and no gate in this repo catches any of them.
3. After writing prose, re-read the region and run the existing scans (`rg -n --multiline ' \n [a-z]' <file>`, `rg -n 'u20[0-9a-f]{2}' <file>`) plus a form-feed/zero-width scan (`rg -n '[\x0c\x{200b}-\x{200f}\x{feff}]' <file>`).
4. Replacing the visible `erence2` leaves the byte behind, so replace the whole token.
5. Prefer a colon, semicolon, or parentheses when the sentence allows it.
6. Write the character itself, never a `\uXXXX` token; a rejected `oldText` on an em-dash line is usually a token you emitted wrong, so re-emit before changing tactics.
7. Only when it will not emit, use the `@PH@` placeholder pass; the escape belongs to the substituting script, since hand-written in an edit body it arrives over-escaped (`\\u2014`).
8. `(Refs #74)` stays; the pi-packages numbers go.

#### `fallow`

| Hunk | Verdict |
| --- | --- |
| Intro: "answers targeted questions about one file or one symbol"; `pnpm fallow <subcommand>` | Port, without "root devDependency" |
| Question table | Port rows 2.104.0 has: `inspect --file`, `dead-code --trace`, `decision-surface --base`, `review --brief --base`, `health --coverage-gaps`, `explain`; drop `guard`, `health --trend`, `list --boundaries`, `suppressions` |
| "Some subcommands print nothing under `--quiet`; read JSON" | Port |
| Flags table: `--changed-since` alias `--base` | Port; drop `--workspace`, `--group-by` |
| Architecture boundaries | Drop (no zones configured) |
| Type-aware companion; `--symbol-impact` | Drop (not in 2.104.0) |
| Proving "nothing else calls this" | Port, adapted to `--trace` alone |
| Health snapshots and trends | Drop (no committed snapshot) |
| Coverage feed (Istanbul) | Drop (`@vitest/coverage-istanbul` not installed); keep the `--coverage-gaps` paragraph |
| Change review (`decision-surface`, `review --brief`) | Port; it is the reviewer's §2k (Goal 3) |
| Known limitation 1: graph resolved syntactically | Port, without the `--type-aware` clause |
| Limitation 6 (`implements` over suppression) | Keep local |
| Limitation 7: clone coordinates | Keep local; drop upstream's `similar-code` item |

#### `improvement-discovery`

| Hunk | Verdict |
| --- | --- |
| "fallow measures structure rather than intent" wording (twice) | Port |
| Monorepo paths, `pkg:` labels, `--workspace` commands, snapshot/coverage/type-coupling reads | Drop |
| `health --coverage-gaps` read | Port (one command, 2.104.0 has it) |
| `craftsmanship-scout` references, "10 phases" | Keep local (the local text reads test files by hand and says "many phases") |
| Boy-scout work routed to "`/plan-issue`'s Tidy-First assessment" | Port (Goal 3) |
| Table padding | Keep local (compact) |
| "Dependency order: section order is the working sequence" | Drop (tied to issue-number step identity) |
| Step identity by issue, render shape, `S<issue>` Mermaid nodes, `roadmap-check.mjs`, Open-issue sweep dispositions, Commit-type field | Drop (Non-Goal 6) |
| `Category A–G` | Keep local (upstream still says `A–F`, a stale count) |
| New: sweep `#### Deferred tidyings` in `docs/retro/` during discovery | Add, so the heading Goal 3 introduces has a reader (upstream puts it in the unported `/plan-improvements`) |

#### `pre-completion`

| Hunk | Verdict |
| --- | --- |
| Base ref: `git rev-parse <plan-commit>^`, or `origin/main` with no plan commit (upstream's `$BASE` is a worktree variable) | Port, adapted |
| Base ref in the dispatch prompt and example | Port (example keeps [#46] and its local plan path) |
| Re-derivation mandate when a change removes or narrows a guard | Port |
| A PASS is scoped to the commit it reviewed | Port, `/ship-issue` |
| Re-dispatch scoped to the delta after WARN fixes | Port |
| A finding in untouched code is a record defect | Port |
| A non-blocking observation can still be the issue's defect | Port, strip `(Refs #923)` |
| `packages/*/docs/plans/` | Drop |

#### `tidy-first`

Port the whole rewrite (planning-time dispatch, design summary plus `<file>:<symbol>` list as the input, triage into the TDD Order with leading-or-integrated placement, rejections under `#### Deferred tidyings`), with the `/plan-improvements` mention replaced by `improvement-discovery`.

### New skills

`shell-traps` is ported nearly verbatim.

1. The intro keeps "the zsh facts every session needs stay in `AGENTS.md`", made true by Goal 4.
2. The `rg -r` sentence gains `(Refs #47, #66, #74)` from the `AGENTS.md` stopgap it replaces.
3. The repo-relative-path sentence uses `src/x.ts`, and names pi-permission-system's `external_directory` gate as conditional ("when installed").
4. The rest (backtick bodies, `--body-file`, `-F <file>`, SIGPIPE under `pipefail`, counting and re-verifying) applies unchanged.

`edit-tool` drops its `pi-autoformat and source files` section.

1. The form-feed paragraph says no gate here catches it and points to the `markdown-conventions` scan, instead of claiming a pre-commit hook.
2. "Run the full package suite" becomes `pnpm test`.
3. pi-packages refs (`#933`, `#863`, `#960`, `#864`) are stripped.

### Load triggers

The operator chose an `AGENTS.md` index plus trigger descriptions.
A new `## Skill Index` section goes after `### Project Agents` in the Architecture section.
Rendered target (compact table, one row per skill; `colgrep` and `github-voice` are user-installed but already assumed by the prompts):

```markdown
## Skill Index

Before you do the thing in the left column, load the skill in the right one.

| Before you… | Load |
| --- | --- |
| touch OAuth shaping in `src/`, or debug an Anthropic OAuth failure | `anthropic` |
| run a live `pi -p … -e …` repro | `pi-cli-repro` |
| assess a new Pi/pi-ai release, or change code that depends on upstream internals | `upstream-watch` |
| create or edit a skill's frontmatter | `frontmatter` |
| write, refactor, or review TypeScript, or design around a Pi SDK internal | `code-design` |
| add a parameter to a shared interface or rewire layers | `design-review` |
| write or debug a test, or sequence TDD steps | `testing` |
| write or edit markdown, a plan, or a retro | `markdown-conventions` |
| author or review a Mermaid diagram | `mermaid` |
| explore unfamiliar code | `colgrep` |
| compose a bash call with a pipeline, loop, heredoc, in-place edit, or `gh … --body` | `shell-traps` |
| run a multi-entry `Edit`, a scripted substitution, or a block insertion | `edit-tool` |
| run or read `fallow` | `fallow` |
| plan an improvement round or edit the roadmap | `improvement-discovery` |
| decide when an extension flushes, notifies, or intercepts | `pi-extension-lifecycle` |
| settle a design in `/plan-issue`, before writing the plan | `tidy-first` |
| finish `/tdd-plan` or `/build-plan` | `pre-completion` |
| write GitHub-facing text | `github-voice` |
```

The `### Project Skills` list gains `shell-traps` and `edit-tool` (shared) and `upstream-watch` (repo-specific, present but never listed), and `### Project Prompts` gains the unlisted `upstream-impact`.

### Shell facts in `AGENTS.md`

A new `### Shell` subsection under `## Development` carries pi-packages' zsh facts verbatim, minus the pi-permission-system tripwire sentence: quote globs meant for a command, no word-split of an unquoted parameter, no bash word starting with `=`, never name a variable `status`.
Editing Conventions item 5 (`rg -r`) is removed; items 1–4 stay sequential.

### Tidy-First relocation (prompt and agent halves)

Ported from pi-packages `abfeabc9` and `701ad507`, adapted:

1. `plan-issue.md`: a Load-skills line for `tidy-first`, and a `## Tidy First assessment` section between `## Decide` and `## Write the plan`.
   The TDD Order bullet gains the preparatory-step sentences, and stage-notes step 3 gains the `#### Deferred tidyings` instruction, citing `improvement-discovery` as the reader instead of `/plan-improvements`.
2. `tdd-plan.md`, `build-plan.md`: drop the `tidy-first` Load-skills line and the `## Tidy First` section; open the execute section with the "preparatory steps are ordinary steps, run no second assessment" paragraph.
3. `tidy-first-assessor.md`: the `abfeabc9` hunks (dispatcher, design-summary input, placement notes, contradiction reporting, output format), plus `701ad507`'s evidence block cut to the two commands 2.104.0 has, `fallow inspect --file` and `fallow dead-code --trace`.
   The zone/`guard` paragraph is dropped (no zones).
   The local "do not widen the extension's surface" rule stays.
4. `AGENTS.md` `### Project Agents` item 2: "run during `/plan-issue`, after the design is settled".
   `### Project Skills` item 6 is unchanged in substance.

### Decision surface (agent half)

Ported from `pre-completion-reviewer.md` upstream, adapted:

1. Bash allowlist gains `pnpm fallow decision-surface`.
2. Input gains **Base ref**.
3. A new §2k Decision surface runs `pnpm --silent fallow decision-surface --base "<base ref>" --format json --quiet 2>/dev/null || true`, with SKIP/PASS/WARN rules for `public-api-contract` and `dependency`.
   The `coupling-boundary` bullet is dropped, because it requires `.fallowrc.json` zones this repo does not have.
4. The WARN list gains "a surfaced decision the range does not answer", and the output format gains the `### Decision surface` block.

## Module-Level Changes

1. `.pi/skills/shell-traps/SKILL.md`: new.
2. `.pi/skills/edit-tool/SKILL.md`: new.
3. `.pi/skills/{code-design,design-review,fallow,improvement-discovery,markdown-conventions,mermaid,pi-extension-lifecycle,pre-completion,testing,tidy-first}/SKILL.md`: per the classification.
4. `.pi/prompts/plan-issue.md`, `.pi/prompts/tdd-plan.md`, `.pi/prompts/build-plan.md`: Tidy-First relocation only.
5. `.pi/agents/tidy-first-assessor.md`: Tidy-First relocation only.
6. `.pi/agents/pre-completion-reviewer.md`: decision surface only.
7. `AGENTS.md`: intro sentence (toolkit list names shell and edit traps), `### Project Skills`, `### Project Prompts`, `### Project Agents`, new `## Skill Index`, new `### Shell`, Editing Conventions item 5 removed.

Greps run at planning time:

1. `tidy` across `AGENTS.md`, `.pi/`, `README.md`, `docs/architecture.md`: hits only in `AGENTS.md` (items 6 and 2 of the skill and agent lists), `tdd-plan.md`, `build-plan.md`, `tidy-first-assessor.md`, `code-design` (a generic section, unaffected), and `improvement-discovery` line 89, all listed above.
2. `rg -r` in `AGENTS.md`, `.pi/`: only Editing Conventions item 5.
3. `upstream-watch|upstream-impact` in `AGENTS.md`, `README.md`, `docs/architecture.md`: no hits, which confirms the listing gap.
4. `README.md` and `docs/architecture.md` mention no skill, prompt, or agent, so neither changes.

## Test Impact Analysis

None: no `src/` or `test/` file changes.
Verification is `rumdl`, greps, and `pnpm run lint`.

## Invariants at Risk

1. [#74]'s visible-form scans in `markdown-conventions` (`u20[0-9a-f]{2}`, the split-sentence pattern).
   Upstream dropped the `u20` scan, so a wholesale port would regress this repo's measured failure mode.
   Pinned by a grep in step 3's verify.
2. `.pi` passes `rumdl` (25 files today, 27 after).
   `lint:md` does not cover `.pi/**`, so every step runs `pnpm exec rumdl check .pi` explicitly.
3. No control or zero-width character in tracked files.
   Every step runs the `git grep -nP` scan from Background.
4. No pi-packages leakage: after every step, `rg -n 'packages/<|--workspace|--filter|/ship([^-]|$)|pi-autoformat|invisible-characters|similar-code|--type-aware|fallow guard' .pi AGENTS.md` returns only lines the classification keeps on purpose.
   Measured baseline: one hit, `pi-extension-lifecycle` line 224, naming `pi-autoformat` as a project in its session-data sample, which stays.
   The Non-ASCII section may add a hit naming `invisible-characters.mjs` as unported.

## TDD Order

This is a docs-only plan for `/build-plan`; each step is one commit.
Each step's verify: `pnpm exec rumdl check .pi AGENTS.md`, the Non-ASCII scans on touched files, and the Invariant 4 leakage grep.

1. Port `shell-traps` and add the `AGENTS.md` `### Shell` subsection; remove Editing Conventions item 5.
   Commit: `docs: port the shell-traps skill and zsh shell facts from pi-packages (#76)`.
2. Port `edit-tool`.
   Commit: `docs: port the edit-tool skill from pi-packages (#76)`.
3. Reconcile `markdown-conventions`, including the merged Non-ASCII section.
   Verify also: `rg -n "u20\[0-9a-f\]\{2\}" .pi/skills/markdown-conventions/SKILL.md` still hits.
   Commit: `docs: resync markdown-conventions with pi-packages (#76)`.
4. Reconcile `testing`.
   Commit: `docs: resync the testing skill with pi-packages (#76)`.
5. Reconcile `code-design`, and descriptions of `design-review`, `mermaid`, `pi-extension-lifecycle`.
   Commit: `docs: resync code-design and skill trigger descriptions with pi-packages (#76)`.
6. Reconcile `fallow`.
   Verify also: run each ported question-table command once with `--help` to confirm 2.104.0 accepts it.
   Commit: `docs: resync the fallow skill with fallow 2.104's surface (#76)`.
7. Relocate Tidy-First: `tidy-first` skill, `plan-issue.md`, `tdd-plan.md`, `build-plan.md`, `tidy-first-assessor.md`, `AGENTS.md` Project Agents item 2.
   Verify also: `rg -n tidy .pi/prompts .pi/agents AGENTS.md` shows no remaining "start of `/tdd-plan`" wording.
   Commit: `docs: dispatch the Tidy-First assessor during planning (#76)`.
8. Reconcile `improvement-discovery`, including the boy-scout routing to `/plan-issue` and the `Deferred tidyings` sweep.
   It follows step 7 because it cites the relocated assessor.
   Commit: `docs: resync improvement-discovery with pi-packages (#76)`.
9. Decision surface: `pre-completion` skill and `pre-completion-reviewer.md`.
   Verify also: run the §2k command with `--base HEAD~8` and confirm JSON with a `decisions` key.
   Commit: `docs: hand the pre-completion reviewer fallow's decision surface (#76)`.
10. `AGENTS.md` Skill Index, Project Skills/Prompts lists, intro sentence.
    Verify also: every `.pi/skills/*` directory has an index row (`ls .pi/skills` against the table).
    Commit: `docs: add a skill index to AGENTS.md (#76)`.

Finish with `pnpm run lint` and the pre-completion review.

## Risks and Mitigations

1. The running `/build-plan` session loaded the pre-edit `pre-completion` skill, but step 9 changes what the reviewer expects (a base ref).
   Mitigation: before dispatching the reviewer, re-read `.pi/skills/pre-completion/SKILL.md` from disk and pass the base ref (this plan's commit parent).
2. Steps 7 and 9 edit prompts the implementing session is itself running (stale prompt-template expansion).
   Mitigation: the on-disk file is authoritative; the in-flight `/build-plan` is unaffected because its Tidy-First section only applies to code-touching plans.
3. Em-dash corruption while authoring many prose edits, the failure this issue exists for.
   Mitigation: every step's verify runs the three scans; the new `edit-tool` rule applies from step 2 onward.
4. Over-porting monorepo content that reads plausibly but is false here (a gate that does not exist, a subcommand 2.104.0 lacks).
   Mitigation: Invariant 4's leakage grep and step 6's `--help` check.
5. A planning-time assessor lengthens `/plan-issue`.
   Accepted: upstream measured the implementation-time assessment contradicting frozen plans, and [#74]'s retro records the assessor resolving a decision the plan left open.

## Open Questions

1. Whether the Skill Index should also replace the prompts' "Load skills" lists.
   Deferred: the prompts keep their lists (as upstream's do), and [#77] can revisit.
2. Whether a fallow 3.x bump is worth it to recover the dropped `guard`, `--symbol-impact`, and type-aware content.
   Deferred until a boundary or symbol-impact question actually comes up here.

[#46]: https://github.com/gotgenes/pi-anthropic-auth/issues/46
[#47]: https://github.com/gotgenes/pi-anthropic-auth/issues/47
[#52]: https://github.com/gotgenes/pi-anthropic-auth/issues/52
[#54]: https://github.com/gotgenes/pi-anthropic-auth/issues/54
[#66]: https://github.com/gotgenes/pi-anthropic-auth/issues/66
[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
[#77]: https://github.com/gotgenes/pi-anthropic-auth/issues/77
[#78]: https://github.com/gotgenes/pi-anthropic-auth/issues/78
