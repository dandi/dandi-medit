/**
 * Utility to parse refusal hashtags from assistant message content.
 *
 * The system prompt asks the model to include a hashtag when it declines a
 * request: #irrelevant when the question is off topic, #personal-info when the
 * user supplies personal information unrelated to dandiset metadata, and
 * #manipulation when the user appears to be probing the rules. The tags are
 * meant for the client, not the reader, so they are stripped from the rendered
 * markdown and surfaced as a label instead.
 */

export const REFUSAL_TAGS = [
  "irrelevant",
  "personal-info",
  "manipulation",
] as const;

export type RefusalTag = (typeof REFUSAL_TAGS)[number];

/** Short user-facing label for each refusal tag */
export const refusalTagLabels: Record<RefusalTag, string> = {
  irrelevant: "Declined: off topic",
  "personal-info": "Declined: personal information",
  manipulation: "Declined: policy",
};

export interface ParsedRefusalTags {
  /** The message content with refusal tags removed */
  cleanedContent: string;
  /** The refusal tags that were found, in order of first appearance */
  tags: RefusalTag[];
}

/**
 * Matches a refusal hashtag on a word boundary. The leading group keeps the
 * character before the tag so it can be restored, and the trailing lookahead
 * prevents matching a longer hashtag such as #irrelevant-question.
 */
const TAG_PATTERN = /(^|[^\w#-])(#(?:irrelevant|personal-info|manipulation))(?![\w-])/g;

/**
 * Parse refusal tags from message content.
 * Returns the content with the tags removed along with the tags found.
 */
export function parseRefusalTags(content: string): ParsedRefusalTags {
  const tags: RefusalTag[] = [];
  if (!content) {
    return { cleanedContent: content, tags };
  }

  const cleanedLines: string[] = [];

  for (const line of content.split("\n")) {
    let lineHadTag = false;
    const cleanedLine = line.replace(
      TAG_PATTERN,
      (_match, prefix: string, tag: string) => {
        const name = tag.slice(1) as RefusalTag;
        if (!tags.includes(name)) {
          tags.push(name);
        }
        lineHadTag = true;
        return prefix;
      }
    );

    // Drop a line that held nothing but tags rather than leaving it blank
    if (lineHadTag && !cleanedLine.trim() && line.trim()) {
      continue;
    }

    // Close up the gap the tag left behind, keeping any leading indentation
    cleanedLines.push(
      lineHadTag
        ? cleanedLine.replace(/(\S)[ \t]{2,}/g, "$1 ").replace(/[ \t]+$/, "")
        : cleanedLine
    );
  }

  if (tags.length === 0) {
    return { cleanedContent: content, tags };
  }

  return {
    cleanedContent: cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    tags,
  };
}

/**
 * Check if content contains a refusal tag
 */
export function hasRefusalTags(content: string): boolean {
  return parseRefusalTags(content).tags.length > 0;
}
