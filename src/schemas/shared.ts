/**
 * Shared Zod schemas reused across MCP tool definitions.
 */

import { z } from "zod";

export const WorkspaceSchema = z
  .string()
  .optional()
  .describe(
    "Bitbucket workspace slug. Optional if BITBUCKET_DEFAULT_WORKSPACE env var is set."
  );

export const RepoSlugSchema = z
  .string()
  .optional()
  .describe(
    "Repository slug. Optional if BITBUCKET_DEFAULT_REPO_SLUG env var is set."
  );

export const PrIdSchema = z.number().int().positive().describe("Pull request ID.");

export const CommentIdSchema = z
  .number()
  .int()
  .positive()
  .describe("The ID of the comment.");
