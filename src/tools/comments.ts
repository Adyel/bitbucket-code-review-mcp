/**
 * Comment tools — Add, update, delete, list, resolve, and reopen PR comments.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
  PrIdSchema,
  CommentIdSchema,
  SeveritySchema,
} from "../schemas/shared.js";
import {
  toolResponse,
  withErrorHandling,
} from "../utils/response.js";
import {
  formatGeneralComment,
  formatInlineComment,
  formatCodeSuggestion,
  formatUpdatedComment,
  formatReply,
  formatFileLevelComment,
  isAIComment,
  type Severity,
} from "../comment-formatter.js";

export function registerComments(
  server: McpServer,
  client: BitbucketClient
): void {
  server.registerTool(
    "add_general_comment",
    {
      description:
        "Post a general (non-inline) comment on a pull request. Auto-tagged with [AI Review].",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment: z
          .string()
          .describe("The comment content (Markdown supported)."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id, comment }) => {
      const formatted = formatGeneralComment(comment);
      const result = await client.createPRComment(
        pr_id,
        formatted,
        undefined,
        undefined,
        workspace,
        repo_slug
      );
      return toolResponse({
        success: true,
        comment_id: result.id,
        message: "General comment posted successfully.",
      });
    })
  );

  server.registerTool(
    "add_inline_comment",
    {
      description:
        "Post an inline comment on a specific line of a specific file in a pull request. Auto-tagged with [AI Review].",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        file_path: z
          .string()
          .describe("File path relative to repo root, e.g. src/utils.ts"),
        line: z
          .number()
          .int()
          .positive()
          .describe("Line number in the new version of the file."),
        comment: z
          .string()
          .describe("The comment content (Markdown supported)."),
        severity: SeveritySchema,
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, file_path, line, comment, severity }) => {
        const formatted = formatInlineComment(
          comment,
          severity as Severity | undefined
        );
        const result = await client.createPRComment(
          pr_id,
          formatted,
          { path: file_path, to: line },
          undefined,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          comment_id: result.id,
          file: file_path,
          line,
          message: "Inline comment posted successfully.",
        });
      }
    )
  );

  server.registerTool(
    "add_inline_suggestion",
    {
      description:
        "Post a code suggestion on a specific line using Bitbucket's suggestion syntax. The PR author can apply it with one click in Bitbucket UI.",
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
            "Optional end line for multi-line suggestions. When set, the suggestion spans from 'line' to 'end_line'."
          ),
        suggested_code: z
          .string()
          .describe(
            "The suggested replacement code. This will render as an applicable suggestion in Bitbucket."
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
        const formatted = formatCodeSuggestion(suggested_code, explanation);
        const inlinePos: { path: string; to: number; from?: number } = {
          path: file_path,
          to: line,
        };
        if (end_line) {
          inlinePos.from = line;
          inlinePos.to = end_line;
        }
        const result = await client.createPRComment(
          pr_id,
          formatted,
          inlinePos,
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
    "add_file_level_comment",
    {
      description:
        "Post a file-level comment (not on a specific line) on a file in a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        file_path: z.string().describe("File path relative to repo root."),
        comment: z
          .string()
          .describe("The comment content (Markdown supported)."),
        severity: SeveritySchema,
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, file_path, comment, severity }) => {
        const formatted = formatFileLevelComment(
          comment,
          severity as Severity | undefined
        );
        const result = await client.createPRComment(
          pr_id,
          formatted,
          { path: file_path },
          undefined,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          comment_id: result.id,
          file: file_path,
          message: "File-level comment posted successfully.",
        });
      }
    )
  );

  server.registerTool(
    "reply_to_comment",
    {
      description: "Reply to an existing comment thread on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe(
          "The ID of the parent comment to reply to."
        ),
        comment: z
          .string()
          .describe("The reply content (Markdown supported)."),
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, comment_id, comment }) => {
        const formatted = formatReply(comment);
        const result = await client.createPRComment(
          pr_id,
          formatted,
          undefined,
          comment_id,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          comment_id: result.id,
          parent_id: comment_id,
          message: "Reply posted successfully.",
        });
      }
    )
  );

  server.registerTool(
    "update_comment",
    {
      description:
        "Update an existing comment with additional context, details, or examples. Appends an [Updated by AI] marker so changes are traceable. Works on any comment (AI or human).",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe("The ID of the comment to update."),
        new_content: z
          .string()
          .describe(
            "Additional content to append (context, issues, examples)."
          ),
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, comment_id, new_content }) => {
        const existing = await client.getPRComment(
          pr_id,
          comment_id,
          workspace,
          repo_slug
        );
        const updated = formatUpdatedComment(existing.content.raw, new_content);
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
          message:
            "Comment updated successfully with [Updated by AI] marker.",
        });
      }
    )
  );

  server.registerTool(
    "delete_comment",
    {
      description:
        "Delete an AI-generated comment. SAFETY: Only comments containing the [AI Review] tag can be deleted. Human comments are protected.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe(
          "The ID of the comment to delete."
        ),
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, comment_id }) => {
        const existing = await client.getPRComment(
          pr_id,
          comment_id,
          workspace,
          repo_slug
        );

        if (!isAIComment(existing.content.raw)) {
          return toolResponse({
            success: false,
            error:
              "Cannot delete this comment — it was not created by AI. Only comments with the [AI Review] tag can be deleted to protect human comments.",
          });
        }

        await client.deletePRComment(pr_id, comment_id, workspace, repo_slug);
        return toolResponse({
          success: true,
          comment_id,
          message: "AI comment deleted successfully.",
        });
      }
    )
  );

  server.registerTool(
    "list_comments",
    {
      description: "List all existing comments on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const allComments = await client.listPRComments(pr_id, workspace, repo_slug);
      const comments = allComments
        .filter((c) => !c.deleted)
        .map((c) => ({
          id: c.id,
          author: c.user.display_name,
          content: c.content.raw,
          is_ai: isAIComment(c.content.raw),
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
    "resolve_comment",
    {
      description: "Resolve a comment thread on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe(
          "The ID of the comment thread to resolve."
        ),
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, comment_id }) => {
        await client.resolveComment(pr_id, comment_id, workspace, repo_slug);
        return toolResponse({
          success: true,
          comment_id,
          message: "Comment thread resolved.",
        });
      }
    )
  );

  server.registerTool(
    "reopen_comment",
    {
      description:
        "Reopen a previously resolved comment thread on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: CommentIdSchema.describe(
          "The ID of the comment thread to reopen."
        ),
      },
    },
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, comment_id }) => {
        await client.reopenComment(pr_id, comment_id, workspace, repo_slug);
        return toolResponse({
          success: true,
          comment_id,
          message: "Comment thread reopened.",
        });
      }
    )
  );
}
