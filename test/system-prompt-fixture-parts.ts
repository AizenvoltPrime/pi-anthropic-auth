// ---------------------------------------------------------------------------
// Shared literals for system-prompt fixtures.
//
// `test/system-prompt-shaping.test.ts` writes its Pi-prompt fixtures by hand,
// while `test/upstream-prompt-drift.test.ts` builds the equivalent prompt with
// Pi's own `buildSystemPrompt`.  The two must agree on the content Pi treats as
// caller-supplied, or the hand-written fixture stops standing in for the real
// prompt and the drift check loses its subject.
//
// Only plain literals live here.  `buildSystemPrompt` stays imported solely by
// `upstream-prompt-drift.test.ts` — that file is the suite's one sanctioned
// door into a Pi internal (see AGENTS.md, Testing Guidance), and this module
// must not become a second one.
// ---------------------------------------------------------------------------

/** Heading of the `--append-system-prompt` content both fixtures append. */
export const APPENDED_NOTE = "## Custom Note (from another extension)";

/** Body line following {@link APPENDED_NOTE}. */
export const APPENDED_NOTE_BODY = "- Some critical project instruction.";

/** Full `--append-system-prompt` value: {@link APPENDED_NOTE} plus its body. */
export const APPENDED_SYSTEM_PROMPT = `${APPENDED_NOTE}\n${APPENDED_NOTE_BODY}`;

/** Working directory both fixtures report. */
export const FIXTURE_CWD = "/tmp/project";

/** Path of the context file both fixtures load project instructions from. */
export const FIXTURE_CONTEXT_FILE_PATH = `${FIXTURE_CWD}/AGENTS.md`;

/** Sole line of that context file, asserted to survive shaping. */
export const PROJECT_INSTRUCTION =
  "Preserve built-in Anthropic behavior by default.";

/** Extension-contributed `promptGuidelines` bullet, asserted to survive shaping. */
export const EXTRA_GUIDELINE = "Always check the frobnicator before deploying";

/**
 * Tool snippets both fixtures render.
 *
 * A tool appears in the prompt only when `toolSnippets` supplies a one-line
 * snippet for it *and* its name is in `selectedTools`, so the two must be kept
 * consistent — {@link FIXTURE_SELECTED_TOOLS} lists exactly these keys.
 */
export const FIXTURE_TOOL_SNIPPETS: Record<string, string> = {
  read: "Read file contents",
  bash: "Execute shell commands",
};

/** Tools selected for both fixtures; matches {@link FIXTURE_TOOL_SNIPPETS}. */
export const FIXTURE_SELECTED_TOOLS = Object.keys(FIXTURE_TOOL_SNIPPETS);
