import { runMcpServer } from "../mcp/server.js";

/** Starts the read-only MCP server in the workspace where the command runs. */
export async function runMcp(): Promise<number> {
  try {
    await runMcpServer({ projectRoot: process.cwd() });
    return 0;
  } catch (cause) {
    process.stderr.write(
      `atlante mcp: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
}
