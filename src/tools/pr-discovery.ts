/**
 * PR Discovery tools — List, get, search pull requests and view diffs/changes.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import {
  WorkspaceSchema,
  RepoSlugSchema,
  PrIdSchema,
} from "../schemas/shared.js";
import {
  toolResponse,
  toolTextResponse,
  withErrorHandling,
} from "../utils/response.js";

export function registerPRDiscovery(
  server: McpServer,
  client: BitbucketClient
): void {
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
    withErrorHandling(async ({ workspace, repo_slug, state }) => {
      const prs = await client.listPullRequests(
        workspace,
        repo_slug,
        state || "OPEN"
      );
      const mapped = prs.map((pr) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author.display_name,
        source_branch: pr.source.branch.name,
        destination_branch: pr.destination.branch.name,
        url: pr.links.html.href,
        created: pr.created_on,
      }));
      return toolResponse({ pull_requests: mapped });
    })
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
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const pr = await client.getPullRequest(pr_id, workspace, repo_slug);
      return toolResponse({
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
      });
    })
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
    withErrorHandling(async ({ workspace, repo_slug, branch_name }) => {
      const prs = await client.getPullRequestByBranch(
        branch_name,
        workspace,
        repo_slug
      );
      const mapped = prs.map((pr) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author.display_name,
        source_branch: pr.source.branch.name,
        destination_branch: pr.destination.branch.name,
        url: pr.links.html.href,
      }));

      if (mapped.length === 0) {
        return toolTextResponse(
          `No pull requests found for branch "${branch_name}".`
        );
      }
      return toolResponse({ pull_requests: mapped });
    })
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
    withErrorHandling(async ({ pr_url }) => {
      const ref = client.parsePullRequestUrl(pr_url);
      const pr = await client.getPullRequest(
        ref.prId,
        ref.workspace,
        ref.repoSlug
      );
      return toolResponse({
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
      });
    })
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
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const diff = await client.getPullRequestDiff(
        pr_id,
        workspace,
        repo_slug
      );
      return toolTextResponse(diff);
    })
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
    withErrorHandling(async ({ workspace, repo_slug, pr_id }) => {
      const entries = await client.listPRChanges(pr_id, workspace, repo_slug);
      const files = entries.map((entry) => ({
        status: entry.status,
        old_path: entry.old?.path,
        new_path: entry.new?.path,
        lines_added: entry.lines_added,
        lines_removed: entry.lines_removed,
      }));
      return toolResponse({ files });
    })
  );

  server.registerTool(
    "get_file_content",
    {
      description:
        "Get the content of a specific file at a given commit/branch/tag. Useful for reading full file content during code review.",
      inputSchema: {
        workspace: WorkspaceSchema,
        repo_slug: RepoSlugSchema,
        commit: z
          .string()
          .describe(
            "The commit hash, branch name, or tag to read the file from."
          ),
        file_path: z
          .string()
          .describe("File path relative to repo root, e.g. src/utils.ts"),
      },
    },
    withErrorHandling(async ({ workspace, repo_slug, commit, file_path }) => {
      const content = await client.getFileContent(
        commit,
        file_path,
        workspace,
        repo_slug
      );
      return toolTextResponse(content);
    })
  );
}
