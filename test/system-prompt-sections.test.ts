import assert from "node:assert/strict";
import { test } from "vitest";

import {
  namedSection,
  parseSystemPromptChunks,
  renderSystemPromptChunks,
} from "#src/system-prompt-sections";

// ---------------------------------------------------------------------------
// Pi 0.86.0 emits the system prompt as an untagged preamble followed by
// `<name>\n...\n</name>` sections joined with a blank line (upstream
// `buildSystemPromptSections` + `getSystemMessageText`).  These tests pin the
// parser against that shape and against the inputs that could make it
// mis-slice a prompt.
// ---------------------------------------------------------------------------

const SECTIONED_PROMPT = [
  "You are an expert coding assistant operating inside pi, a coding agent harness.",
  "",
  "<tools>",
  "- read: Read file contents",
  "</tools>",
  "",
  "<cwd>",
  "/tmp/project",
  "</cwd>",
].join("\n");

/** Assert the parse/render round-trip is byte-exact for `text`. */
function assertRoundTrips(text: string): void {
  assert.equal(
    renderSystemPromptChunks(parseSystemPromptChunks(text)),
    text,
    "parse/render must reproduce the input byte-for-byte",
  );
}

test("splits an untagged preamble from the sections that follow", () => {
  const chunks = parseSystemPromptChunks(SECTIONED_PROMPT);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    [null, "tools", "cwd"],
  );
  assert.equal(
    chunks[0]?.body,
    "You are an expert coding assistant operating inside pi, a coding agent harness.",
  );
  assert.equal(chunks[1]?.body, "- read: Read file contents");
  assert.equal(chunks[1]?.raw, "<tools>\n- read: Read file contents\n</tools>");
  assert.equal(chunks[2]?.body, "/tmp/project");
});

test("round-trips the sectioned prompt byte-for-byte", () => {
  assertRoundTrips(SECTIONED_PROMPT);
});

test("treats an untagged chunk's body as its raw text", () => {
  assert.deepEqual(parseSystemPromptChunks("just some prose"), [
    { name: null, raw: "just some prose", body: "just some prose" },
  ]);
});

test("parses a section that opens the text with no preamble", () => {
  const chunks = parseSystemPromptChunks("<cwd>\n/tmp\n</cwd>");

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    ["cwd"],
  );
  assert.equal(chunks[0]?.body, "/tmp");
});

test("does not mistake an attribute-bearing tag for a section start", () => {
  // Pi renders context files as <project_instructions path="...">, nested
  // inside the project_context section body.  Only bare <name> tags open a
  // section, so the inner tag must stay part of the body.
  const text = [
    "<project_context>",
    "Project-specific instructions and guidelines:",
    "",
    '<project_instructions path="/tmp/project/AGENTS.md">',
    "Preserve built-in Anthropic behavior by default.",
    "</project_instructions>",
    "</project_context>",
  ].join("\n");

  const chunks = parseSystemPromptChunks(text);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    ["project_context"],
  );
  assert.match(chunks[0]?.body ?? "", /<project_instructions path=/);
  assertRoundTrips(text);
});

test("closes a section on its own name, not a nested tag of another name", () => {
  // A context file documenting pi's prompt can legally contain a <tools>
  // block.  Matching the close tag by name keeps it inside project_context.
  const text = [
    "<project_context>",
    "Our AGENTS.md documents the prompt:",
    "",
    "<tools>",
    "- read: Read file contents",
    "</tools>",
    "</project_context>",
    "",
    "<cwd>",
    "/tmp",
    "</cwd>",
  ].join("\n");

  const chunks = parseSystemPromptChunks(text);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    ["project_context", "cwd"],
  );
  assert.match(chunks[0]?.body ?? "", /- read: Read file contents/);
  assertRoundTrips(text);
});

test("leaves an unmatched open tag as untagged text", () => {
  const text = "<tools>\n- read: Read file contents";

  const chunks = parseSystemPromptChunks(text);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    [null],
  );
  assertRoundTrips(text);
});

test("keeps extra blank lines between sections inside the preceding chunk", () => {
  // Boundaries consume exactly two newlines, so a third stays with the chunk
  // before it and the round-trip is still exact.
  const text = "preamble\n\n\n<cwd>\n/tmp\n</cwd>";

  const chunks = parseSystemPromptChunks(text);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    [null, "cwd"],
  );
  assert.equal(chunks[0]?.raw, "preamble\n");
  assertRoundTrips(text);
});

test("parses an extension-registered section it knows nothing about", () => {
  const text =
    "<cwd>\n/tmp\n</cwd>\n\n<my_ext-1>\nCustom content.\n</my_ext-1>";

  const chunks = parseSystemPromptChunks(text);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    ["cwd", "my_ext-1"],
  );
  assert.equal(chunks[1]?.body, "Custom content.");
  assertRoundTrips(text);
});

test("rejects a tag name upstream would not emit as a section", () => {
  // Upstream validates section names with /^[a-z][a-z0-9_-]*$/.
  const text = "<Tools>\nbody\n</Tools>";

  assert.deepEqual(
    parseSystemPromptChunks(text).map((chunk) => chunk.name),
    [null],
  );
});

test("keeps untagged text that follows a section", () => {
  const text = "<cwd>\n/tmp\n</cwd>\n\ntrailing prose";

  const chunks = parseSystemPromptChunks(text);

  assert.deepEqual(
    chunks.map((chunk) => chunk.name),
    ["cwd", null],
  );
  assert.equal(chunks[1]?.body, "trailing prose");
  assertRoundTrips(text);
});

test("round-trips an empty prompt", () => {
  assert.deepEqual(parseSystemPromptChunks(""), []);
  assertRoundTrips("");
});

test("namedSection builds a chunk that renders as an upstream section", () => {
  const chunk = namedSection("tools", "- read: Read file contents");

  assert.equal(chunk.name, "tools");
  assert.equal(chunk.body, "- read: Read file contents");
  assert.equal(chunk.raw, "<tools>\n- read: Read file contents\n</tools>");
  assert.deepEqual(parseSystemPromptChunks(chunk.raw), [chunk]);
});
