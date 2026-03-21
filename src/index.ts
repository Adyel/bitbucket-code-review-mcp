#!/usr/bin/env node

/**
 * Bitbucket Code Review MCP Server
 *
 * An MCP server that provides tools for posting well-formatted code review
 * comments on Bitbucket Cloud pull requests. Designed to work with AI agents
 * like Gemini CLI and Antigravity.
 *
 * The server does NOT review code itself — it provides tools for agents to
 * create comments tagged with [AI Review] for human review.
 *
 * Environment Variables:
 *   BITBUCKET_EMAIL             - Required: Atlassian account email
 *   BITBUCKET_API_TOKEN         - Required: Bitbucket API token
 *   BITBUCKET_DEFAULT_WORKSPACE - Optional: Default workspace slug
 *   BITBUCKET_DEFAULT_REPO_SLUG - Optional: Default repository slug
 *   BITBUCKET_AI_TAG            - Optional: Custom AI tag (default: 🤖 AI Review)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BitbucketClient } from "./bitbucket-client.js";
import { registerTools } from "./tools.js";

// ─── Validate Environment ───────────────────────────────────

function validateEnv(): {
  email: string;
  apiToken: string;
  defaultWorkspace?: string;
  defaultRepoSlug?: string;
} {
  const email = process.env.BITBUCKET_EMAIL;
  const apiToken = process.env.BITBUCKET_API_TOKEN;

  if (!email || !apiToken) {
    console.error(
      "❌ Missing required environment variables:\n" +
        "   BITBUCKET_EMAIL      - Your Atlassian account email\n" +
        "   BITBUCKET_API_TOKEN  - Your Bitbucket API token\n\n" +
        "Create an API token at: https://bitbucket.org/account/settings/api-tokens/\n" +
        "Required scopes: Repositories (Read), Pull requests (Read & Write)"
    );
    process.exit(1);
  }

  return {
    email,
    apiToken,
    defaultWorkspace: process.env.BITBUCKET_DEFAULT_WORKSPACE || undefined,
    defaultRepoSlug: process.env.BITBUCKET_DEFAULT_REPO_SLUG || undefined,
  };
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = validateEnv();

  // Initialize Bitbucket client
  const client = new BitbucketClient({
    email: env.email,
    apiToken: env.apiToken,
    defaultWorkspace: env.defaultWorkspace,
    defaultRepoSlug: env.defaultRepoSlug,
    pendingComments: process.env.BITBUCKET_COMMENTS_PENDING === "true",
  });

  // Create MCP server
  const server = new McpServer({
    name: "bitbucket-code-review",
    version: "1.0.0",
  });

  // Register all tools
  registerTools(server, client);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
