---
name: markdown-conventions
description: |
  Load before writing or editing any markdown, a plan, or a retro:
  one-sentence-per-line, tables, issue links, frontmatter, retro stage format, non-ASCII corruption scans.
---

# Markdown Conventions

Load this skill when writing or editing markdown files.

## Formatting rules

The enforcer is `rumdl` (runs as part of `pnpm run lint`, available standalone via `pnpm run lint:md`; also the pre-commit `rumdl fmt` hook), not `markdownlint-cli2` — there is no markdownlint binary in this repo.
`lint:md` covers `*.md docs/**/*.md` only, so it skips `.pi/**`; check a skill, prompt, or agent with `pnpm exec rumdl check .pi`.
Checking a file outside the repository (a scratch sample in `/tmp`) needs `--config .rumdl.toml` — `rumdl` does not discover repo config for it, so MD013 fires against the default 80-character limit.
Rules below are named by their markdownlint `MDxxx` IDs because `rumdl` implements the same rule family; use the IDs for reference, not the tool.

### Lines and sentences

- Use one sentence per line (unbroken) for better diffs.
  Each sentence occupies exactly one line; never wrap a sentence across lines or place two sentences on the same line.
  This applies to all prose, including list-item continuations.
- `rumdl`'s `MD057` can report an existing relative link as missing when its sentence runs long; split the sentence per the rule above rather than hunting the path.
- Author and append markdown with the `Write`/`Edit` tools, not shell heredocs (`cat <<EOF`) — heredocs don't interpolate `\uXXXX` escapes and make one-sentence-per-line slips easy, both of which trip the markdown linter.

### Non-ASCII in authored prose

An em-dash in a `newText`/`content` body is unreliably emitted, in four forms: a literal `\u2014`, a bare newline that splits the sentence, a newline plus `u2014`, or an invisible `\x0c` form feed plus literal text (`erence2` for an em-dash, `erence6` for an ellipsis).
All four are valid markdown that `rumdl` accepts, and no gate in this repo catches any of them.
The corruption is upstream of every tool: measured in pi-packages across 1764 session transcripts, 62 of 122 form-feed occurrences sat in plain assistant prose with no tool call involved, so `Edit` writes faithfully what the model already emitted.
After writing prose, re-read the region and scan it:

```bash
rg -n --multiline ' \n [a-z]' <file>            # a split sentence and the line it ran into
rg -n 'u20[0-9a-f]{2}' <file>                     # a literal or newline-split escape
rg -n '[\x0c\x{200b}-\x{200f}\x{feff}]' <file>  # a form feed or zero-width character
```

Replacing the visible `erence2` leaves the byte behind, so a grep for `erence2` passes on a still-corrupt file; replace the whole token.
Prefer a colon, semicolon, or parentheses when the sentence allows it.

Write the character itself in an `Edit`/`Write` body, never a `\uXXXX` token; the literal-character rule (`AGENTS.md` Editing Conventions item 4) governs `newText` as much as `oldText`.
That governs matching as much as writing: a rejected `oldText` on a line holding an em-dash is usually a token you emitted wrong, not a file that moved.
In pi-packages, ten batches failed on one issue because U+2014 left the model as a tab plus `a`, as a bare newline, or as the literal escape, while a spike matched and wrote a real em-dash in every trial; re-emit the character before changing tactics.
Only when it genuinely will not emit, write a placeholder and substitute it in a scripted pass (`@PH@`, then `s.replace('@PH@', '\u2014')`).
The escape there belongs to the substituting script; hand-written in an edit body it arrives over-escaped (`\\u2014`) and lands in the file as literal text (Refs #74).

### Code fences

- Always specify a language on fenced code blocks (e.g., ` ```typescript `, ` ```bash `, ` ```jsonc `, ` ```text `); use `text` for plain output.
- When embedding markdown that itself contains fenced code blocks, use a 4-backtick outer fence (` ````markdown `).

### Inserting a new section

Before inserting a new `##`/`###` section into an existing document, read the parent section end to end.
An insertion point that reads correctly at the seam can reparent what follows it — a shared example block, a trailing summary sentence — under the new heading.

### Lists, headings, and emphasis

- Use sequential numbering (`1.` `2.` `3.`) in ordered lists, restarting at `1.` under each new heading — markdownlint's MD029 rejects continued numbering across section boundaries.
- Do not use bold text (`**...**`) as a substitute for headings — use proper heading syntax; markdownlint's MD036 rejects emphasis used as headings.

### Tables and blockquotes

- Use compact table style with no cell padding — markdownlint's MD060 enforces consistent column style and is not auto-fixable.
  Example: `| Header | Header |` / `| --- | --- |` / `| cell | cell |` — spaces inside pipes, no padding variation.
- Separate adjacent blockquotes with an HTML comment (`<!-- -->`) to satisfy markdownlint's MD028.

### Issue references

- When an issue number would begin a line outside a fenced code block, prefix it with `Issue` (e.g. `Issue #42`) to prevent `#N` from being misread as a Markdown heading.
- In long-lived docs (`docs/architecture.md`, `docs/plans/`), reference GitHub issues with reference-style links — `[#42]` in the body, `[#42]: https://github.com/gotgenes/pi-anthropic-auth/issues/42` at the end of the file.
  Bare `#42` auto-links on GitHub but not in other renderers.
  Every `[#N]:` definition must have a matching `[#N]` reference in the body (markdownlint MD053 rejects unused definitions).
  A `[#N]` wrapped in backticks is a code span, not a link reference — it does not count toward the matching-reference requirement, so the `[#N]:` definition still trips MD053.
  Likewise, a `[#N]` inside a fenced code block (e.g. an `architecture.md` module-layout tree) is not a live reference — cite issues there as bare `#N` with no `[#N]:` definition (matching the block's existing entries), or MD053 rejects the orphaned definition.
  Write `[#N]` as plain text, including inside other formatting (`**[#N] label:**`).
  Do not add a definition for the doc's own issue number — it lives in frontmatter, not as a body link.
  Link reference definitions are file-scoped: when appending a stage entry to a retro that already defines `[#N]:`, reference it without re-adding the definition — a duplicate trips MD053.

## Documentation frontmatter

Docs under `docs/plans/` and `docs/retro/` use YAML frontmatter for structured metadata.
Plans and retros live in `docs/plans/` and `docs/retro/`.
GitHub renders it as a table at the top of the file.

Schema (both fields are strings/numbers — quote any title containing backticks or colons):

```yaml
---
issue: 14 # optional: omit for plans that predate issue tracking
issue_title: "Short descriptive title" # required
---
```

- `issue` stores the number only, never a URL.
- Do not duplicate frontmatter fields as inline metadata in the body (e.g., `Issue #N` in the H1 is fine; a separate `**Issue:** #N` line is not).
- Other doc types (`README.md`) do not use frontmatter.

### Retro file format

Get each stage timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"` — never write one from memory; a model has no clock.

Retro files use YAML frontmatter and accumulate `## Stage:` entries:

````markdown
---
issue: 42
issue_title: "Extract ExtensionPaths value object"
---

# Retro: #42 — Extract ExtensionPaths value object

## Stage: Planning (2026-05-20T14:00:00Z)

### Session summary

...

### Observations

...

## Stage: Implementation — TDD (2026-05-21T10:00:00Z)

### Session summary

...

### Observations

...

## Stage: Final Retrospective (2026-05-22T16:00:00Z)

### Session summary

...

### Diagnostic details

- **Model-performance correlation** — Explore subagent ran on claude-sonnet-4-20250514; appropriate for read-only codebase search.
- **Escalation-delay tracking** — 8 consecutive tool calls on the same lint error in TDD step 3 before switching approach.
- **Feedback-loop gap analysis** — `pnpm run check` ran only after step 6; should have run after step 4 (interface change).
````

The `### Diagnostic details` subsection is optional — include it only when the `/retro` prompt's diagnostic lenses produce actionable findings.
Omit it when all lenses find nothing notable.

## Accepted residuals

An accepted residual — an ADR bullet, a follow-up issue body — is a claim about the **mechanism**, not the symptom that exposed it.
Enumerate the mechanism's inputs before writing it.
