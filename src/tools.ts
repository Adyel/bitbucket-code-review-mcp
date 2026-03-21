/**
 * MCP Tool definitions for Bitbucket Code Review.
 * Each tool is registered with Zod schemas for input validation.
 * Uses the non-deprecated `registerTool` API (MCP SDK >= 1.27).
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BitbucketClient } from "./bitbucket-client.js";
import {
  formatGeneralComment,
  formatInlineComment,
  formatCodeSuggestion,
  formatUpdatedComment,
  formatReply,
  formatFileLevelComment,
  isAIComment,
  type Severity,
} from "./comment-formatter.js";

// ─── Shared Schemas ──────────────────────────────────────────

const WorkspaceSchema = z
  .string()
  .optional()
  .describe(
    "Bitbucket workspace slug. Optional if BITBUCKET_DEFAULT_WORKSPACE env var is set."
  );

const RepoSlugSchema = z
  .string()
  .optional()
  .describe(
    "Repository slug. Optional if BITBUCKET_DEFAULT_REPO_SLUG env var is set."
  );

const PrIdSchema = z.number().int().positive().describe("Pull request ID.");

const SeveritySchema = z
  .enum(["suggestion", "warning", "bug", "note", "security"])
  .optional()
  .describe(
    "Comment severity level. Adds emoji & label: 💡 Suggestion, ⚠️ Warning, 🐛 Bug, 📝 Note, 🔒 Security"
  );

// ─── Tool Registration ──────────────────────────────────────

export function registerTools(server: McpServer, client: BitbucketClient): void {
  // ═══════════════════════════════════════════════════════════
  // PR Discovery Tools
  // ═══════════════════════════════════════════════════════════

  server.registerTool(
    "list_pull_requests",
    {
      description:
        "List pull requests for a repository, filterable by state (OPEN, MERGED, DECLINED, SUPERSEDED).",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        state: z
          .enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
          .optional()
          .describe("Filter by PR state. Defaults to OPEN if not specified."),
      },
    },
    async ({ workspace, repo_slug, state }) => {
      const result = await client.listPullRequests(
        workspace,
        repo_slug,
        state || "OPEN"
      );
      const prs = result.values.map((pr) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author.display_name,
        source_branch: pr.source.branch.name,
        destination_branch: pr.destination.branch.name,
        url: pr.links.html.href,
        created: pr.created_on,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(prs, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_pull_request",
    {
      description: "Get details of a specific pull request by ID.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    async ({ workspace, repo_slug, pr_id }) => {
      const pr = await client.getPullRequest(pr_id, workspace, repo_slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: pr.id,
                title: pr.title,
                description: pr.description,
                state: pr.state,
                author: pr.author.display_name,
                source_branch: pr.source.branch.name,
                destination_branch: pr.destination.branch.name,
                reviewers: pr.reviewers.map((r) => r.display_name),
                url: pr.links.html.href,
                created: pr.created_on,
                updated: pr.updated_on,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_pull_request_by_branch",
    {
      description:
        "Find pull requests by source branch name. Useful when you know the branch but not the PR ID.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        branch_name: z
          .string()
          .describe("The source branch name to search for."),
      },
    },
    async ({ workspace, repo_slug, branch_name }) => {
      const result = await client.getPullRequestByBranch(
        branch_name,
        workspace,
        repo_slug
      );
      const prs = result.values.map((pr) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author.display_name,
        source_branch: pr.source.branch.name,
        destination_branch: pr.destination.branch.name,
        url: pr.links.html.href,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text:
              prs.length > 0
                ? JSON.stringify(prs, null, 2)
                : `No pull requests found for branch "${branch_name}".`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_pull_request_from_url",
    {
      description:
        "Parse a Bitbucket PR URL and return the pull request details. Useful when user pastes a URL.",
      inputSchema: {
        pr_url: z
          .string()
          .url()
          .describe(
            "Full Bitbucket PR URL, e.g. https://bitbucket.org/workspace/repo/pull-requests/123"
          ),
      },
    },
    async ({ pr_url }) => {
      const ref = client.parsePullRequestUrl(pr_url);
      const pr = await client.getPullRequest(
        ref.prId,
        ref.workspace,
        ref.repoSlug
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: pr.id,
                title: pr.title,
                description: pr.description,
                state: pr.state,
                author: pr.author.display_name,
                source_branch: pr.source.branch.name,
                destination_branch: pr.destination.branch.name,
                reviewers: pr.reviewers.map((r) => r.display_name),
                url: pr.links.html.href,
                workspace: ref.workspace,
                repo_slug: ref.repoSlug,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_pull_request_diff",
    {
      description: "Get the full diff text for a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    async ({ workspace, repo_slug, pr_id }) => {
      const diff = await client.getPullRequestDiff(
        pr_id,
        workspace,
        repo_slug
      );
      return {
        content: [{ type: "text" as const, text: diff }],
      };
    }
  );

  server.registerTool(
    "list_pull_request_files",
    {
      description:
        "List files changed in a pull request with their status (added/modified/deleted/renamed) and line counts.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    async ({ workspace, repo_slug, pr_id }) => {
      const result = await client.listPRChanges(
        pr_id,
        workspace,
        repo_slug
      );
      const files = result.values.map((entry) => ({
        status: entry.status,
        old_path: entry.old?.path,
        new_path: entry.new?.path,
        lines_added: entry.lines_added,
        lines_removed: entry.lines_removed,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(files, null, 2),
          },
        ],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // Comment Tools
  // ═══════════════════════════════════════════════════════════

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
    async ({ workspace, repo_slug, pr_id, comment }) => {
      const formatted = formatGeneralComment(comment);
      const result = await client.createPRComment(
        pr_id,
        formatted,
        undefined,
        undefined,
        workspace,
        repo_slug
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id: result.id,
                message: "General comment posted successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
    async ({
      workspace,
      repo_slug,
      pr_id,
      file_path,
      line,
      comment,
      severity,
    }) => {
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
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id: result.id,
                file: file_path,
                line,
                message: "Inline comment posted successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
        suggested_code: z
          .string()
          .describe(
            "The suggested replacement code. This will render as an applicable suggestion in Bitbucket."
          ),
        explanation: z
          .string()
          .optional()
          .describe(
            "Optional explanation of why this change is suggested."
          ),
      },
    },
    async ({
      workspace,
      repo_slug,
      pr_id,
      file_path,
      line,
      suggested_code,
      explanation,
    }) => {
      const formatted = formatCodeSuggestion(suggested_code, explanation);
      const result = await client.createPRComment(
        pr_id,
        formatted,
        { path: file_path, to: line },
        undefined,
        workspace,
        repo_slug
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id: result.id,
                file: file_path,
                line,
                message:
                  "Code suggestion posted. The PR author can apply it with one click in Bitbucket.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id: result.id,
                file: file_path,
                message: "File-level comment posted successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "reply_to_comment",
    {
      description:
        "Reply to an existing comment thread on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the parent comment to reply to."),
        comment: z
          .string()
          .describe("The reply content (Markdown supported)."),
      },
    },
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
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id: result.id,
                parent_id: comment_id,
                message: "Reply posted successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
        comment_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the comment to update."),
        new_content: z
          .string()
          .describe(
            "Additional content to append (context, issues, examples)."
          ),
      },
    },
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
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id: result.id,
                message:
                  "Comment updated successfully with [Updated by AI] marker.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
        comment_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the comment to delete."),
      },
    },
    async ({ workspace, repo_slug, pr_id, comment_id }) => {
      const existing = await client.getPRComment(
        pr_id,
        comment_id,
        workspace,
        repo_slug
      );

      if (!isAIComment(existing.content.raw)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error:
                    "Cannot delete this comment — it was not created by AI. Only comments with the [AI Review] tag can be deleted to protect human comments.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      await client.deletePRComment(pr_id, comment_id, workspace, repo_slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id,
                message: "AI comment deleted successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
    async ({ workspace, repo_slug, pr_id }) => {
      const result = await client.listPRComments(
        pr_id,
        workspace,
        repo_slug
      );
      const comments = result.values
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
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(comments, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "resolve_comment",
    {
      description: "Resolve a comment thread on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        comment_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the comment thread to resolve."),
      },
    },
    async ({ workspace, repo_slug, pr_id, comment_id }) => {
      await client.resolveComment(pr_id, comment_id, workspace, repo_slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id,
                message: "Comment thread resolved.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
        comment_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the comment thread to reopen."),
      },
    },
    async ({ workspace, repo_slug, pr_id, comment_id }) => {
      await client.reopenComment(pr_id, comment_id, workspace, repo_slug);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                comment_id,
                message: "Comment thread reopened.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // Task Tools
  // ═══════════════════════════════════════════════════════════

  server.registerTool(
    "create_task",
    {
      description:
        "Create a task on a pull request, optionally linked to a specific comment.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        content: z.string().describe("Task description."),
        comment_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional comment ID to link the task to."),
      },
    },
    async ({ workspace, repo_slug, pr_id, content, comment_id }) => {
      const result = await client.createPRTask(
        pr_id,
        content,
        comment_id,
        workspace,
        repo_slug
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                task_id: result.id,
                state: result.state,
                message: "Task created successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List all tasks on a pull request.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    async ({ workspace, repo_slug, pr_id }) => {
      const result = await client.listPRTasks(pr_id, workspace, repo_slug);
      const tasks = result.values.map((t) => ({
        id: t.id,
        content: t.content.raw,
        state: t.state,
        comment_id: t.comment?.id ?? null,
        creator: t.creator.display_name,
        created: t.created_on,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(tasks, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Update a task's state on a pull request (OPEN or RESOLVED).",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
        task_id: z.number().int().positive().describe("Task ID to update."),
        state: z
          .enum(["OPEN", "RESOLVED"])
          .describe("New state for the task."),
      },
    },
    async ({ workspace, repo_slug, pr_id, task_id, state }) => {
      const result = await client.updatePRTask(
        pr_id,
        task_id,
        state,
        workspace,
        repo_slug
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                task_id: result.id,
                state: result.state,
                message: `Task updated to ${state}.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // Bulk Operations
  // ═══════════════════════════════════════════════════════════

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
    async ({ workspace, repo_slug, pr_id, comments }) => {
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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total: comments.length,
                posted: results.length,
                failed: errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
