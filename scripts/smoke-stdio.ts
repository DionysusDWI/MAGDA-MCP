import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';
const dataDir = process.argv[2];
for (const version of ['2026-07-28', '2025-11-25', '2025-06-18']) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli/index.js'), 'serve', ...(dataDir ? ['--data-dir', dataDir] : [])], stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'stdio-smoke', version: '0.1.0' }, { supportedProtocolVersions: [version], versionNegotiation: { mode: version >= '2026-07-28' ? { pin: version } : 'legacy' } });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const status = await client.callTool({ name: 'magda_mcp.status', arguments: {} });
    const tracks = await client.callTool({ name: 'tracks.list', arguments: {} });
    const resource = await client.readResource({ uri: 'magda://tracks' });
    console.log(JSON.stringify({ version, tools: tools.tools.length, status: status.structuredContent, trackReadError: tracks.isError, resourceCount: resource.contents.length }));
  } finally { await client.close(); }
}
