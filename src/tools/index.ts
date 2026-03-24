/**
 * Tool registration entry point.
 * Composes all tool domain modules into a single registerTools function.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import { registerPRDiscovery } from "./pr-discovery.js";
import { registerComments } from "./comments.js";
import { registerTasks } from "./tasks.js";
import { registerBulk } from "./bulk.js";

export function registerTools(
  server: McpServer,
  client: BitbucketClient
): void {
  registerPRDiscovery(server, client);
  registerComments(server, client);
  registerTasks(server, client);
  registerBulk(server, client);
}
