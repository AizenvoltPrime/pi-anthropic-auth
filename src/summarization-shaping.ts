import {
  PI_CONVERSATION_ENVELOPE_CLOSE,
  PI_CONVERSATION_ENVELOPE_OPEN,
  PI_SUMMARIZATION_SYSTEM_PROMPT_ANCHOR,
  PI_TRANSCRIPT_MARKERS,
  PI_TRANSCRIPT_THINKING_MARKER,
} from "./constants";

export type StrippedTranscriptReport = {
  text: string;
  removedSegments: number;
};

/**
 * Whether a system block is Pi's summarization system prompt.
 *
 * Summarization requests are synthesized by Pi and carry no user-authored
 * content, so recognizing one is what makes transcript rewriting safe.
 */
export function isSummarizationSystemText(text: string): boolean {
  return text.includes(PI_SUMMARIZATION_SYSTEM_PROMPT_ANCHOR);
}

/**
 * Remove transcribed assistant reasoning from every `<conversation>` envelope
 * in `text`, leaving anything outside an envelope untouched.
 *
 * Anthropic's `reasoning_extraction` classifier refuses a request that asks the
 * model to read back its own reasoning as prose, which is what Pi's
 * `[Assistant thinking]` transcript paragraphs are (Issue #65).  Relabeling the
 * marker was measured and refused identically, so the prose itself has to go.
 */
export function stripTranscribedThinking(
  text: string,
): StrippedTranscriptReport {
  const openIdx = text.indexOf(PI_CONVERSATION_ENVELOPE_OPEN);
  if (openIdx === -1) {
    return { text, removedSegments: 0 };
  }

  const bodyStart = openIdx + PI_CONVERSATION_ENVELOPE_OPEN.length;
  const closeIdx = text.indexOf(PI_CONVERSATION_ENVELOPE_CLOSE, bodyStart);
  if (closeIdx === -1) {
    return { text, removedSegments: 0 };
  }

  // The envelope's own newlines frame the transcript rather than belonging to
  // any segment; holding them aside keeps them in place when the first or last
  // segment is the one removed.
  const body = text.slice(bodyStart, closeIdx);
  const [, leading = "", transcript = "", trailing = ""] =
    /^(\n*)([\s\S]*?)(\n*)$/.exec(body) ?? [];

  const segments = splitTranscriptSegments(transcript);
  const kept = segments.filter(
    (segment) => !segment.startsWith(PI_TRANSCRIPT_THINKING_MARKER),
  );
  const removedSegments = segments.length - kept.length;
  if (removedSegments === 0) {
    return { text, removedSegments: 0 };
  }

  const shapedBody = leading + kept.join("\n\n") + trailing;
  return {
    text: text.slice(0, bodyStart) + shapedBody + text.slice(closeIdx),
    removedSegments,
  };
}

/**
 * Split a serialized conversation into its transcript segments, on the blank
 * lines that introduce a known marker.
 */
function splitTranscriptSegments(body: string): string[] {
  const boundary = new RegExp(
    `\\n\\n(?=(?:${PI_TRANSCRIPT_MARKERS.map(escapeForRegExp).join("|")}))`,
  );
  return body.split(boundary);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
