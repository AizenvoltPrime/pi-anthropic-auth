#!/usr/bin/env bash
# Shared helpers for the git-cliff release scripts. Source this file; do not run it.
#
# This repository publishes a single package, so the only per-invocation scoping
# git-cliff needs is a set of path exclusions. They live here rather than in
# `cliff.toml` because git-cliff accepts `--include-path`/`--exclude-path` as
# command-line arguments only (Refs #63).

# Internal working docs are excluded from the release scope: a plan or a retro
# is not a released change. Under release-please they were not excluded at all,
# which is why v2.0.5 and v2.0.6 shipped no code.
#
# Tracked content absent from package.json `files` is excluded on the same rule:
# a bump for it would publish a byte-identical tarball. Three groups fall under
# it (Refs #78):
#
# - `.pi/`: skills, prompts, and agents — this repository's own workflow toolkit.
# - `AGENTS.md`: contributor and agent guidance, not package content.
# - The top-level tooling config: formatter, linter, type-check, hook, lockfile,
#   workspace, and release (`cliff.toml`) settings.
#
# A new top-level tooling file belongs on this list too. If package.json `files`
# ever grows to ship one of these paths, remove it here, or its changes stop
# releasing. package.json itself stays in scope: it is always shipped.
#
# `pi-packages` carries no equivalent entries because its `cliff_args` scopes each
# package with `--include-path "packages/<pkg>/**"`, which already leaves root
# files out, and it tracks nothing under `packages/*/.pi/`; the divergence is a
# layout difference, not a policy one.
#
# `docs/` itself stays included, deliberately. architecture.md,
# comparison-to-similar-projects.md, and the two builtin-transport-seam-*.md
# files are not in the tarball either, but they are user-facing reference docs
# reached through README.md links, so their changes are kept in the changelog.
#
# CHANGELOG.md is excluded so a changelog-writing commit never re-enters the
# next changelog.
#
# An array, not a space-separated string: bash word-splits an unquoted parameter
# and zsh does not, so a string collapses into a single bogus glob when this file
# is sourced from an interactive zsh. That excludes nothing, and the only symptom
# is a changelog quietly containing commits it should not.
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

# Populate the global array CLIFF_ARGS with the scoping flags for git-cliff.
#
# A global array rather than stdout: the values contain glob characters and must
# not be re-split or expanded by the caller's shell.
cliff_args() {
  local path
  CLIFF_ARGS=()
  for path in "${CLIFF_EXCLUDED_PATHS[@]}"; do
    CLIFF_ARGS+=(--exclude-path "$path")
  done
}

# Print the newest release tag, or nothing if the repository has never released.
# `-v:refname` compares the embedded version numerically, so `v10.0.0` sorts
# above `v9.0.0`; a lexical sort would not.
latest_tag() {
  git tag --list "v[0-9]*" --sort=-v:refname | head -1
}

# Print the version recorded in package.json.
package_json_version() {
  jq -r '.version' package.json
}
