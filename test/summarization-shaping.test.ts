import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isSummarizationSystemText,
  stripTranscribedThinking,
} from "#src/summarization-shaping";

// ---------------------------------------------------------------------------
// Transcript fixtures
//
// Mirror what Pi's `serializeConversation` emits: paragraph markers joined
// with a blank line, wrapped by the caller in <conversation> tags and followed
// by a format prompt.  See docs/plans/0065-*.md for the measured evidence that
// the `[Assistant thinking]` paragraphs are what Anthropic's
// `reasoning_extraction` classifier refuses.
// ---------------------------------------------------------------------------

const FORMAT_PROMPT = [
  "Summarize the prefix to provide context for the retained suffix:",
  "",
  "## Original Request",
  "[What did the user ask for in this turn?]",
].join("\n");

function envelope(...segments: string[]): string {
  return `<conversation>\n${segments.join("\n\n")}\n</conversation>\n\n${FORMAT_PROMPT}`;
}

test("isSummarizationSystemText matches Pi's summarization system prompt", () => {
  const systemPrompt = [
    "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.",
    "",
    "Do NOT continue the conversation.",
  ].join("\n");

  assert.equal(isSummarizationSystemText(systemPrompt), true);
});

test("isSummarizationSystemText rejects an ordinary system prompt", () => {
  assert.equal(
    isSummarizationSystemText(
      "You are Claude Code, Anthropic's official CLI for Claude.",
    ),
    false,
  );
});

test("removes thinking segments and keeps every other transcript marker", () => {
  const text = envelope(
    "[User]: Refactor the parser.",
    "[Assistant thinking]: Let me reason about the tokenizer seam first.",
    "[Assistant]: I'll read the file first.",
    '[Assistant tool calls]: read(path="src/parser.ts")',
    "[Tool result]: export function parse() {}",
  );

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 1);
  assert.equal(
    report.text,
    envelope(
      "[User]: Refactor the parser.",
      "[Assistant]: I'll read the file first.",
      '[Assistant tool calls]: read(path="src/parser.ts")',
      "[Tool result]: export function parse() {}",
    ),
  );
});

test("removes a multi-paragraph thinking segment whole", () => {
  // A thinking block can contain blank lines, so a naive split on \n\n would
  // orphan its tail inside the request.
  const text = envelope(
    "[User]: Refactor the parser.",
    "[Assistant thinking]: First thought.\n\nSecond thought, after a blank line.",
    "[Assistant]: Done.",
  );

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 1);
  assert.equal(
    report.text,
    envelope("[User]: Refactor the parser.", "[Assistant]: Done."),
  );
});

test("removes a trailing thinking segment without leaving a blank run", () => {
  const text = envelope(
    "[User]: Refactor the parser.",
    "[Assistant thinking]: Some reasoning at the end of the transcript.",
  );

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 1);
  assert.equal(report.text, envelope("[User]: Refactor the parser."));
});

test("counts every removed thinking segment", () => {
  const text = envelope(
    "[User]: Refactor the parser.",
    "[Assistant thinking]: First reasoning block.",
    "[Assistant]: Reading.",
    "[Assistant thinking]: Second reasoning block.",
    "[Assistant]: Editing.",
  );

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 2);
  assert.doesNotMatch(report.text, /\[Assistant thinking\]/);
  assert.match(report.text, /\[Assistant\]: Reading\./);
  assert.match(report.text, /\[Assistant\]: Editing\./);
});

test("leaves an envelope without thinking segments untouched", () => {
  const text = envelope(
    "[User]: Refactor the parser.",
    "[Assistant]: Reading.",
  );

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 0);
  assert.equal(report.text, text);
});

test("leaves text outside a conversation envelope untouched", () => {
  // Without the envelope the text is not a Pi transcript, whatever it quotes.
  const text =
    "[Assistant thinking]: quoted from a transcript the user pasted into chat.";

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 0);
  assert.equal(report.text, text);
});

test("leaves text before and after the envelope untouched", () => {
  const text = `Preamble line.\n\n${envelope(
    "[User]: Refactor the parser.",
    "[Assistant thinking]: Reasoning.",
  )}`;

  const report = stripTranscribedThinking(text);

  assert.equal(report.removedSegments, 1);
  assert.equal(
    report.text,
    `Preamble line.\n\n${envelope("[User]: Refactor the parser.")}`,
  );
});
