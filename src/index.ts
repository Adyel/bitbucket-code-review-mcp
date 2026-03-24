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
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BitbucketClient } from "./bitbucket-client.js";
import { registerTools } from "./tools/index.js";

// ─── Environment Schema ─────────────────────────────────────

const EnvSchema = z.object({
  BITBUCKET_EMAIL: z
    .string({ required_error: "BITBUCKET_EMAIL is required" })
    .min(1, "BITBUCKET_EMAIL cannot be empty"),
  BITBUCKET_API_TOKEN: z
    .string({ required_error: "BITBUCKET_API_TOKEN is required" })
    .min(1, "BITBUCKET_API_TOKEN cannot be empty"),
  BITBUCKET_DEFAULT_WORKSPACE: z.string().optional(),
  BITBUCKET_DEFAULT_REPO_SLUG: z.string().optional(),
  BITBUCKET_AI_TAG: z.string().optional(),
  BITBUCKET_COMMENTS_PENDING: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

function validateEnv() {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(
      `❌ Invalid environment variables:\n${issues}\n\n` +
        "Create an API token at: https://bitbucket.org/account/settings/api-tokens/\n" +
        "Required scopes: Repositories (Read), Pull requests (Read & Write)"
    );
    process.exit(1);
  }

  return result.data;
}

// ─── Main ────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf-8")
  );
  return pkg.version;
}

async function main(): Promise<void> {
  // Handle --version / -v flag
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(getVersion());
    process.exit(0);
  }

  const env = validateEnv();
  const version = getVersion();

  // Initialize Bitbucket client
  const client = new BitbucketClient({
    email: env.BITBUCKET_EMAIL,
    apiToken: env.BITBUCKET_API_TOKEN,
    defaultWorkspace: env.BITBUCKET_DEFAULT_WORKSPACE,
    defaultRepoSlug: env.BITBUCKET_DEFAULT_REPO_SLUG,
    pendingComments: env.BITBUCKET_COMMENTS_PENDING ?? false,
  });

  // Create MCP server
  const server = new McpServer({
    name: "bitbucket-code-review",
    version,
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
