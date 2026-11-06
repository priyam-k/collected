import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from '@collected/core/commands/mcp';
import type { CollectedApi } from './api.js';
import { isLocal, maxAgeMinutes, type AgentConfig } from './config.js';
import { READ_SOURCES, ensureFresh } from './freshness.js';
import { cliVersion } from './version.js';

export { TOOLS, INSTRUCTIONS, buildServer, callTool, type McpDeps, type ToolSpec } from '@collected/core/commands/mcp';

/*
 * `collected mcp`: the tool table (core/src/commands/mcp.ts) on stdio. In local mode a read syncs stale sources
 * first, as the commands do. stdout is the protocol stream, so nothing prints there (cli.ts routes console.log to
 * stderr before this runs).
 */

export interface StdioDeps {
  api: CollectedApi;
  cfg: Pick<AgentConfig, 'server' | 'freshness'>;
  /** Freshness notes in local mode; stderr by default. */
  warn?: (line: string) => void;
}

/** Serve on stdio until the client goes away. */
export async function serveMcp(deps: StdioDeps): Promise<void> {
  const server = buildServer({
    api: deps.api,
    version: cliVersion(),
    before: async (cmd) => {
      if (isLocal(deps.cfg) && cmd in READ_SOURCES) await ensureFresh(deps.api, cmd, { maxAgeMinutes: maxAgeMinutes(deps.cfg), flags: {}, warn: deps.warn ?? ((l) => console.error(l)) });
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
