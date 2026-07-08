/**
 * Comment formatter for Bitbucket code review comments.
 * Handles AI tagging, code suggestions, and update markers.
 * The tag is configurable via the BITBUCKET_AI_TAG environment variable.
 */

/**
 * Get the configurable AI review tag from environment or use default.
 * Set BITBUCKET_AI_TAG="" to disable tagging entirely.
 */
export function getAITag(): string {
  const envTag = process.env.BITBUCKET_AI_TAG;
  if (envTag !== undefined) return envTag; // empty string = disabled
  return "🤖 AI Review";
}

/**
 * Check whether the AI tag is enabled (non-empty).
 */
export function isTagEnabled(): boolean {
  return getAITag().length > 0;
}

/**
 * The marker appended/prepended when an update opts into marking.
 */
export function getUpdateMarker(): string {
  return `✏️ Updated by AI`;
}

/**
 * Build the tag prefix string. Returns empty string if the tag is disabled.
 */
function tagPrefix(suffix?: string): string {
  const tag = getAITag();
  if (!tag) return suffix ? `${suffix}\n\n` : "";
  return suffix ? `**[${tag}]** ${suffix}\n\n` : `**[${tag}]**\n\n`;
}

/**
 * Format a review comment (general, inline, file-level, or reply) with the
 * optional AI tag. Positioning is handled by the caller via the inline payload,
 * not by the comment text.
 */
export function formatComment(comment: string): string {
  return `${tagPrefix()}${comment}`;
}

/**
 * Format a code suggestion using Bitbucket's suggestion syntax.
 * Renders as an "Apply suggestion" button in the Bitbucket UI.
 */
export function formatCodeSuggestion(
  suggestedCode: string,
  explanation?: string
): string {
  const parts: string[] = [tagPrefix(`💡 **Suggestion**`).trimEnd()];

  if (explanation) {
    parts.push("", explanation);
  }

  parts.push("", "```suggestion", suggestedCode, "```");

  return parts.join("\n");
}

export interface UpdateOptions {
  /** When true, append to the existing body instead of replacing it. */
  append?: boolean;
  /** When true, include the "Updated by AI" marker. */
  mark?: boolean;
}

/**
 * Build the raw content for an updated comment.
 *
 * - Default (replace, no mark): returns `newContent` verbatim — a clean edit.
 * - `mark`: prefixes a `**[✏️ Updated by AI]**` marker.
 * - `append`: keeps `existingContent`, adds a `---` divider, then the new text.
 */
export function formatUpdatedComment(
  existingContent: string,
  newContent: string,
  options: UpdateOptions = {}
): string {
  const { append = false, mark = false } = options;
  const marked = mark
    ? `**[${getUpdateMarker()}]**\n\n${newContent}`
    : newContent;

  if (append) {
    return `${existingContent}\n\n---\n\n${marked}`;
  }
  return marked;
}
