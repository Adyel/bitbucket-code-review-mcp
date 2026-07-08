/**
 * Comment tools — add, suggest, update, delete, list, and resolve PR comments.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type BitbucketClient,
  type InlinePosition,
  BitbucketApiError,
} from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
  PrIdSchema,
  CommentIdSchema,
} from "../schemas/shared.js";
import { toolResponse, toolError, withErrorHandling } from "../utils/response.js";
import {
  formatComment,
  formatCodeSuggestion,
  formatUpdatedComment,
} from "../comment-formatter.js";

/**
 * Build the inline position for a comment from its optional location fields.
 * Returns undefined for a general (PR-level) comment.
 */
export function buildInlinePosition(
  filePath?: string,
  line?: number,
  endLine?: number
): InlinePosition | undefined {
  if (!filePath) return undefined;
  const inline: InlinePosition = { path: filePath };
  if (line !== undefined) {
    if (endLine !== undefined) {
      inline.from = line;
      inline.to = endLine;
    } else {
      inline.to = line;
    }
  }
  return inline;
}

export function registerComments(
  server: McpServer,
  client: BitbucketClient
): void {
  server.registerTool(
    "add_comment",
    {
      description:
        "Add a comment to a pull request. Omit file_path for a general PR comment; give file_path + line for an inline comment; give file_path only for a file-level comment; give parent_id to reply in a thread. For applicable code changes use add_suggestion; to post many comments at once use add_comments.",
      annotations: { title: "Add comment" },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment: z
          .string()
          .describe("The comment content (Markdown supported)."),
        file_path: z
          .string()
          .optional()
          .describe(
            "File path relative to repo root for an inline or file-level comment. Omit for a general comment."
          ),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Line number in the new version of the file. Requires file_path."
          ),
        parent_id: CommentIdSchema.optional().describe(
          "Parent comment ID to reply to. When set, positioning fields are ignored."
        ),
      },
    },
    withErrorHandling(
      async ({
        workspace,
        repo_slug,
        pr_id,
        comment,
        file_path,
        line,
        parent_id,
      }) => {
        if (line !== undefined && !file_path) {
          return toolError("`line` requires `file_path`.");
        }
        const inline = parent_id
          ? undefined
          : buildInlinePosition(file_path, line);
        const result = await client.createPRComment(
          pr_id,
          formatComment(comment),
          inline,
          parent_id,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          comment_id: result.id,
          message: "Comment posted successfully.",
        });
      }
    )
  );

  server.registerTool(
    "add_suggestion",
    {
      description:
        "Post a code suggestion on one or more lines using Bitbucket's suggestion syntax. The PR author can apply it with one click in the Bitbucket UI.",
      annotations: { title: "Add code suggestion" },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        file_path: z.string().describe("File path relative to repo root."),
        line: z
          .number()
          .int()
          .positive()
          .describe("Line number in the new version of the file."),
        end_line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Optional end line for multi-line suggestions spanning line..end_line."
          ),
        suggested_code: z
          .string()
          .describe(
            "The suggested replacement code. Renders as an applicable suggestion in Bitbucket."
          ),
        explanation: z
          .string()
          .optional()
          .describe("Optional explanation of why this change is suggested."),
      },
    },
    withErrorHandling(
      async ({
        workspace,
        repo_slug,
        pr_id,
        file_path,
        line,
        end_line,
        suggested_code,
        explanation,
      }) => {
        const result = await client.createPRComment(
          pr_id,
          formatCodeSuggestion(suggested_code, explanation),
          buildInlinePosition(file_path, line, end_line),
          undefined,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          comment_id: result.id,
          file: file_path,
          line,
          message:
            "Code suggestion posted. The PR author can apply it with one click in Bitbucket.",
        });
      }
    )
  );

  server.registerTool(
    "update_comment",
    {
      description:
        "Edit an existing comment. By default the body is replaced with new_content. Set append=true to keep the old body and add new_content below a divider. Set mark=true to prefix an [Updated by AI] marker.",
      annotations: { title: "Update comment" },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe("The ID of the comment to update."),
        new_content: z
          .string()
          .describe("The new comment body (Markdown supported)."),
        append: z
          .boolean()
          .optional()
          .describe(
            "Append to the existing body instead of replacing it. Defaults to false (clean replace)."
          ),
        mark: z
          .boolean()
          .optional()
          .describe(
            "Prefix an [Updated by AI] marker so the edit is traceable. Defaults to false."
          ),
      },
    },
    withErrorHandling(
      async ({
        workspace,
        repo_slug,
        pr_id,
        comment_id,
        new_content,
        append = false,
        mark = false,
      }) => {
        let existingRaw = "";
        if (append) {
          const existing = await client.getPRComment(
            pr_id,
            comment_id,
            workspace,
            repo_slug
          );
          existingRaw = existing.content.raw;
        }
        const updated = formatUpdatedComment(existingRaw, new_content, {
          append,
          mark,
        });
        const result = await client.updatePRComment(
          pr_id,
          comment_id,
          updated,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          comment_id: result.id,
          message: append
            ? "Comment updated (appended)."
            : "Comment updated (replaced).",
        });
      }
    )
  );

  server.registerTool(
    "delete_comment",
    {
      description:
        "Delete a comment. Only comments authored by this integration's own account can be deleted; Bitbucket also enforces permission server-side.",
      annotations: { title: "Delete comment", destructiveHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe("The ID of the comment to delete."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id, comment_id }) => {
      const existing = await client.getPRComment(
        pr_id,
        comment_id,
        workspace,
        repo_slug
      );

      // Belt: block the obvious "delete someone else's comment" case when we
      // can determine our own identity. If /user is unavailable (e.g. the token
      // lacks the account scope), skip the local check and let Bitbucket's API
      // be the authority (suspenders — the 403 mapping below).
      try {
        const me = await client.getCurrentUser();
        if (existing.user.uuid !== me.uuid) {
          return toolError(
            `Refusing to delete: comment ${comment_id} was authored by ${existing.user.display_name}, not this integration. Only your own comments can be deleted.`
          );
        }
      } catch {
        console.error(
          "[bitbucket] could not resolve current user for delete authorship check — relying on Bitbucket to enforce permission"
        );
      }

      try {
        await client.deletePRComment(pr_id, comment_id, workspace, repo_slug);
      } catch (error) {
        if (error instanceof BitbucketApiError && error.status === 403) {
          return toolError(
            "Bitbucket rejected the delete (403): the token lacks permission to delete this comment."
          );
        }
        throw error;
      }

      return toolResponse({
        success: true,
        comment_id,
        message: "Comment deleted successfully.",
      });
    })
  );

  server.registerTool(
    "list_comments",
    {
      description: "List all existing (non-deleted) comments on a pull request.",
      annotations: { title: "List comments", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const allComments = await client.listPRComments(
        pr_id,
        workspace,
        repo_slug
      );
      const comments = allComments
        .filter((c) => !c.deleted)
        .map((c) => ({
          id: c.id,
          author: c.user.display_name,
          content: c.content.raw,
          inline: c.inline
            ? {
                file: c.inline.path,
                line_from: c.inline.from,
                line_to: c.inline.to,
              }
            : null,
          parent_id: c.parent?.id ?? null,
          resolved: c.resolved ?? false,
          created: c.created_on,
        }));
      return toolResponse({ comments });
    })
  );

  server.registerTool(
    "set_comment_resolution",
    {
      description:
        "Resolve or reopen a comment thread on a pull request. Set resolved=true to resolve, false to reopen.",
      annotations: { title: "Set comment resolution" },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe(
          "The ID of the comment thread to resolve or reopen."
        ),
        resolved: z
          .boolean()
          .describe("true to resolve the thread, false to reopen it."),
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, comment_id, resolved }) => {
        if (resolved) {
          await client.resolveComment(pr_id, comment_id, workspace, repo_slug);
        } else {
          await client.reopenComment(pr_id, comment_id, workspace, repo_slug);
        }
        return toolResponse({
          success: true,
          comment_id,
          resolved,
          message: resolved
            ? "Comment thread resolved."
            : "Comment thread reopened.",
        });
      }
    )
  );
}
