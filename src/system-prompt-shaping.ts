import {
  MINIMAL_ANTHROPIC_OAUTH_PROMPT,
  PI_DEFAULT_PROMPT_PREFIX,
  PI_DOCS_SECTION_ANCHOR,
  PI_OWNED_SECTIONS,
  PI_TOOLS_FILLER_ANCHOR,
  TEXT_REPLACEMENTS,
} from "./constants";
import { debugLog, isToolUseOnlyDebugEnabled } from "./debug";
import {
  namedSection,
  type PromptChunk,
  parseSystemPromptChunks,
  renderSystemPromptChunks,
} from "./system-prompt-sections";

let warnedPromptUnstructured = false;

/**
 * Reset the one-time degraded-path warning latch. Exposed for tests.
 */
export function _resetShapingWarnings(): void {
  warnedPromptUnstructured = false;
}

/**
 * The name under which the untagged leading text is offered to the rule table.
 *
 * Upstream keys the preamble this way too — `buildSystemPromptSections`
 * returns it as `preamble`, and a mid-conversation update naming that section
 * frames it with the same string.
 */
const PREAMBLE_SECTION = "preamble";

/** What shaping does with one section of the prompt. */
type SectionDecision =
  | { kind: "keep" }
  | { kind: "drop" }
  | { kind: "replace"; body: string };

type StructuredShapingReport = {
  droppedSections: string[];
  replacedSections: string[];
  replacementMatches: string[];
};

/**
 * Shape Pi's system prompt for Anthropic OAuth.
 *
 * Pi renders the prompt as an untagged preamble followed by `<name>` sections.
 * Shaping decides section by section — replacing the Pi identity, dropping
 * Pi's documentation block, and stripping the custom-tool filler — so the
 * surrounding structure stays well-formed and every section Pi appends
 * survives byte-identically.
 *
 * A prompt with none of Pi's own sections is passed through untouched, with a
 * one-time warning: it means upstream restructured again, and the section
 * names this module keys on are no more trustworthy than any other guess.
 * Replacing the single untagged chunk in that case would discard the project
 * context, skills, and cwd along with the preamble.
 */
export function shapeAnthropicOAuthSystemPrompt(systemPrompt: string): string {
  const chunks = parseSystemPromptChunks(systemPrompt);
  if (!chunks.some(isPiOwnedSection)) {
    warnPromptUnstructuredOnce();
    return systemPrompt;
  }

  const report: StructuredShapingReport = {
    droppedSections: [],
    replacedSections: [],
    replacementMatches: [],
  };
  const shaped = chunks.flatMap((chunk, index) =>
    shapeChunk(chunk, index === 0, report),
  );

  if (shouldLogStructuredDebug(report)) {
    debugLog("system-prompt-shaping", {
      mode: "sections",
      originalLength: systemPrompt.length,
      sectionNames: chunks.map((chunk) => chunk.name),
      ...report,
    });
  }

  return renderSystemPromptChunks(shaped);
}

function isPiOwnedSection(chunk: PromptChunk): boolean {
  return chunk.name !== null && PI_OWNED_SECTIONS.includes(chunk.name);
}

/**
 * Apply the rule table to one chunk.
 *
 * @param isLeading - whether this is the prompt's first chunk, which is the
 *   only untagged text the table treats as the preamble.
 * @returns the chunks to emit in its place: none when dropped.
 */
function shapeChunk(
  chunk: PromptChunk,
  isLeading: boolean,
  report: StructuredShapingReport,
): PromptChunk[] {
  const name = chunk.name ?? (isLeading ? PREAMBLE_SECTION : undefined);
  if (name === undefined) {
    return [chunk];
  }

  const decision = decideSection(name, chunk.body, report);
  if (decision.kind === "drop") {
    report.droppedSections.push(name);
    return [];
  }
  if (decision.kind === "replace") {
    report.replacedSections.push(name);
    return [withBody(chunk, decision.body)];
  }
  return [chunk];
}

/**
 * Decide what to do with one named section of Pi's prompt.
 *
 * Shared by the leading prompt and by mid-conversation section updates, which
 * carry the same section names in a different envelope.
 */
function decideSection(
  name: string,
  body: string,
  report: StructuredShapingReport,
): SectionDecision {
  if (!isPiGeneratedSection(name)) {
    return { kind: "keep" };
  }

  const text = applyTextReplacements(body, report);

  if (name === PREAMBLE_SECTION && text.startsWith(PI_DEFAULT_PROMPT_PREFIX)) {
    return { kind: "replace", body: MINIMAL_ANTHROPIC_OAUTH_PROMPT };
  }
  if (name === "docs" && text.includes(PI_DOCS_SECTION_ANCHOR)) {
    return { kind: "drop" };
  }
  if (name === "tools") {
    const stripped = removeParagraphContaining(text, PI_TOOLS_FILLER_ANCHOR);
    if (stripped !== text) {
      return { kind: "replace", body: stripped };
    }
  }

  return text === body ? { kind: "keep" } : { kind: "replace", body: text };
}

function isPiGeneratedSection(name: string): boolean {
  return name === PREAMBLE_SECTION || PI_OWNED_SECTIONS.includes(name);
}

/** Rebuild a chunk around a new body, preserving whether it was tagged. */
function withBody(chunk: PromptChunk, body: string): PromptChunk {
  return chunk.name === null
    ? { name: null, raw: body, body }
    : namedSection(chunk.name, body);
}

function removeParagraphContaining(text: string, anchor: string): string {
  const paragraphs = text.split(/\n\n+/);
  const kept = paragraphs.filter((paragraph) => !paragraph.includes(anchor));
  return kept.length === paragraphs.length ? text : kept.join("\n\n").trim();
}

function applyTextReplacements(
  text: string,
  report: StructuredShapingReport,
): string {
  let result = text;
  for (const rule of TEXT_REPLACEMENTS) {
    if (result.includes(rule.match)) {
      report.replacementMatches.push(rule.match);
    }
    result = result.replaceAll(rule.match, rule.replacement);
  }
  return result;
}

function shouldLogStructuredDebug(report: StructuredShapingReport): boolean {
  if (!isToolUseOnlyDebugEnabled()) {
    return true;
  }

  return (
    report.droppedSections.length === 0 && report.replacementMatches.length > 0
  );
}

function warnPromptUnstructuredOnce(): void {
  if (warnedPromptUnstructured) {
    return;
  }
  warnedPromptUnstructured = true;
  console.warn(
    "[pi-anthropic-auth] Pi's system prompt carries none of its own sections; passing it through unshaped. " +
      "Upstream Pi may have restructured its prompt — re-verify PI_OWNED_SECTIONS.",
  );
}

type TextBlock = {
  type: "text";
  text: string;
  [key: string]: unknown;
};

/**
 * Apply system prompt shaping to an array of Anthropic system text blocks.
 *
 * Finds the first block containing Pi's default prompt preamble and replaces
 * its text in-place (returning a new array).  Blocks without the preamble are
 * passed through unchanged.
 */
export function shapeSystemBlocks(blocks: TextBlock[]): TextBlock[] {
  return blocks.map((block) => {
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive runtime guard
      block.type !== "text" ||
      !block.text.includes(PI_DEFAULT_PROMPT_PREFIX)
    ) {
      return block;
    }
    return { ...block, text: shapeAnthropicOAuthSystemPrompt(block.text) };
  });
}
