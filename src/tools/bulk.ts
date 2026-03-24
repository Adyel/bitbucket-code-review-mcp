/**
 * Bulk operation tools — Post multiple comments in a single call.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
  PrIdSchema,
  SeveritySchema,
} from "../schemas/shared.js";
import { toolResponse, withErrorHandling } from "../utils/response.js";
import {
  formatInlineComment,
  type Severity,
} from "../comment-formatter.js";

export function registerBulk(
  server: McpServer,
  client: BitbucketClient
): void {
  server.registerTool(
    "add_multiple_inline_comments",
    {
      description:
        "Post multiple inline comments in a single call for efficient batch reviewing. Each comment is auto-tagged with [AI Review].",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comments: z
          .array(
            z.object({
              file_path: z
                .string()
                .describe("File path relative to repo root."),
              line: z
                .number()
                .int()
                .positive()
                .describe("Line number in the new file."),
              comment: z.string().describe("Comment content."),
              severity: SeveritySchema,
            })
          )
          .min(1)
          .describe("Array of inline comments to post."),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id, comments }) => {
      const results = [];
      const errors = [];

      for (const item of comments) {
        try {
          const formatted = formatInlineComment(
            item.comment,
            item.severity as Severity | undefined
          );
          const result = await client.createPRComment(
            pr_id,
            formatted,
            { path: item.file_path, to: item.line },
            undefined,
            workspace,
            repo_slug
          );
          results.push({
            success: true,
            comment_id: result.id,
            file: item.file_path,
            line: item.line,
          });
        } catch (error) {
          errors.push({
            success: false,
            file: item.file_path,
            line: item.line,
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
