/**
 * Task tools — Create, list, and update tasks on pull requests.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
  PrIdSchema,
} from "../schemas/shared.js";
import { toolResponse, withErrorHandling } from "../utils/response.js";

export function registerTasks(
  server: McpServer,
  client: BitbucketClient
): void {
  server.registerTool(
    "create_task",
    {
      description:
        "Create a task on a pull request, optionally linked to a specific comment.",
      annotations: { title: "Create task" },
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
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, content, comment_id }) => {
        const result = await client.createPRTask(
          pr_id,
          content,
          comment_id,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          task_id: result.id,
          state: result.state,
          message: "Task created successfully.",
        });
      }
    )
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List all tasks on a pull request.",
      annotations: { title: "List tasks", readOnlyHint: true },
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        pr_id: PrIdSchema,
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const allTasks = await client.listPRTasks(pr_id, workspace, repo_slug);
      const tasks = allTasks.map((t) => ({
        id: t.id,
        content: t.content.raw,
        state: t.state,
        comment_id: t.comment?.id ?? null,
        creator: t.creator.display_name,
        created: t.created_on,
      }));
      return toolResponse({ tasks });
    })
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Update a task's state on a pull request (OPEN or RESOLVED).",
      annotations: { title: "Update task" },
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
    withErrorHandling(
      async ({ workspace, repo_slug, pr_id, task_id, state }) => {
        const result = await client.updatePRTask(
          pr_id,
          task_id,
          state,
          workspace,
          repo_slug
        );
        return toolResponse({
          success: true,
          task_id: result.id,
          state: result.state,
          message: `Task updated to ${state}.`,
        });
      }
    )
  );
}
