/**
 * Bulk tools — Post multiple comments in a single call.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
  PrIdSchema,
  CommentIdSchema,
} from "../schemas/shared.js";
import { toolResponse, withErrorHandling } from "../utils/response.js";
import { formatComment } from "../comment-formatter.js";
import { buildInlinePosition } from "./comments.js";

export function registerBulk(
  server: McpServer,
  client: BitbucketClient
): void {
  server.registerTool(
    "add_comments",
    {
      description:
        "Post multiple comments in one call for efficient batch reviewing. Each item is routed like add_comment (general / inline / file-level / reply). Comments are posted sequentially and per-item successes and failures are reported.",
      annotations: { title: "Add comments (batch)" },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comments: z
          .array(
            z.object({
              comment: z
                .string()
                .describe("Comment content (Markdown supported)."),
              file_path: z
                .string()
                .optional()
                .describe(
                  "File path for an inline or file-level comment. Omit for a general comment."
                ),
              line: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Line number in the new file. Requires file_path."),
              parent_id: CommentIdSchema.optional().describe(
                "Parent comment ID to reply to. When set, positioning is ignored."
              ),
            })
          )
          .min(1)
          .describe("Array of comments to post."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id, comments }) => {
      const results = [];
      const errors = [];

      for (const item of comments) {
        try {
          const inline = item.parent_id
            ? undefined
            : buildInlinePosition(item.file_path, item.line);
          const result = await client.createPRComment(
            pr_id,
            formatComment(item.comment),
            inline,
            item.parent_id,
            workspace,
            repo_slug
          );
          results.push({
            success: true,
            comment_id: result.id,
            file: item.file_path ?? null,
            line: item.line ?? null,
          });
        } catch (error) {
          errors.push({
            success: false,
            file: item.file_path ?? null,
            line: item.line ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return toolResponse({
        total: comments.length,
        posted: results.length,
        failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      });
    })
  );
}
