import { removeOwnedTemp } from './temp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpHandler, Server, ProtocolError } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node';
import type { ServerContext } from '@modelcontextprotocol/server';
import { loadBaseline } from '../../src/contract.js';
import type { GatewayOptions } from '../../src/connection/gateway.js';
export interface MockCall { name: string; args: Record<string, unknown>; meta: unknown; identity: string | undefined }
export async function mockMagda(version = '2026-07-28') {
  const baseline = await loadBaseline();
  const calls: MockCall[] = [];
  let behavior: 'normal' | 'businessError' | 'protocolError' | 'httpError' | 'hang' = 'normal';
  let releaseHang: (() => void) | undefined;
  let active = true;
  let token = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'magda-mcp-test-'));
  const allServers = new Set<Server>();
  let publish = (uri: string): void => { void uri; };
  const makeServer = () => {
    const server = new Server({ name: 'MAGDA', version: '1.0' }, { supportedProtocolVersions: [version], capabilities: { tools: {}, resources: { subscribe: true } } });
    allServers.add(server);
    server.onerror = () => {};
    server.setRequestHandler('tools/list', () => ({ tools: baseline.catalog.tools }));
    server.setRequestHandler('resources/list', () => ({ resources: baseline.catalog.resources }));
    server.setRequestHandler('resources/templates/list', () => ({ resourceTemplates: baseline.catalog.resourceTemplates }));
    server.setRequestHandler('tools/call', async (request, ctx: ServerContext) => {
      const name = request.params.name;
      if (name === 'system.describe') return { content: [{ type: 'text', text: '{"apiVersion":"1.0"}' }], structuredContent: { apiVersion: '1.0', operations: [] } };
      if (!baseline.catalog.tools.some(t => t.name === name)) throw new ProtocolError(-32602, 'Unknown native tool', { nativeCode: 'unknown_operation' });
      const envelope = ctx.mcpReq.envelope as { clientInfo?: { name?: string } } | undefined;
      calls.push({ name, args: request.params.arguments ?? {}, meta: ctx.mcpReq._meta, identity: envelope?.clientInfo?.name ?? server.getClientVersion()?.name });
      if (behavior === 'protocolError') throw new ProtocolError(-32602, 'Native invalid params', { nativeCode: 'invalid_params' });
      if (behavior === 'businessError') return { content: [{ type: 'text', text: '{"error":{"code":"permission_denied","requiredScope":"edit"}}' }], isError: true, _meta: { 'com.conceptualmachines.magda/revision': 41 } };
      if (behavior === 'hang') await new Promise<void>(resolve => { releaseHang = resolve; });
      const payload = { native: name, arguments: request.params.arguments ?? {}, items: [] };
      const result = { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload, isError: false, _meta: { 'com.conceptualmachines.magda/revision': 42, 'com.example/opaque': { keep: true } } };
      publish('magda://tracks');
      return result;
    });
    server.setRequestHandler('resources/read', request => ({ contents: [{ uri: request.params.uri, mimeType: 'application/json', text: '[]' }], _meta: { 'com.conceptualmachines.magda/revision': 42 } }));
    server.setRequestHandler('resources/subscribe', () => ({}));
    server.setRequestHandler('resources/unsubscribe', () => ({}));
    return server;
  };
  const modern = createMcpHandler(makeServer);
  const modernNode = toNodeHandler(modern);
  const legacySessions = new Map<string, NodeStreamableHTTPServerTransport>();
  const legacyServers = new Set<Server>();
  async function legacyRequest(req: Parameters<NodeStreamableHTTPServerTransport['handleRequest']>[0], res: Parameters<NodeStreamableHTTPServerTransport['handleRequest']>[1]) {
    const sessionId = req.headers['mcp-session-id'];
    let transport = typeof sessionId === 'string' ? legacySessions.get(sessionId) : undefined;
    if (!transport && sessionId) { res.writeHead(404); res.end('Unknown session'); return; }
    if (!transport) {
      const server = makeServer(); legacyServers.add(server);
      const created = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: id => { legacySessions.set(id, created); } });
      await server.connect(created); transport = created;
    }
    await transport.handleRequest(req, res);
  }
  publish = uri => {
    modern.notify.resourceUpdated(uri);
    if (version < '2026-07-28') for (const server of legacyServers) void server.sendResourceUpdated({ uri }).catch(() => {});
  };
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); res.end('Unauthorized'); return; }
    if (behavior === 'httpError' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += String(chunk);
      const request = JSON.parse(body) as { id: unknown };
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Rate limit exceeded', data: { httpStatus: 429 } } })); return;
    }
    const handling = version >= '2026-07-28' ? modernNode(req as Parameters<typeof modernNode>[0], res) : legacyRequest(req,res);
    void Promise.resolve(handling).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No mock port');
  const pid = process.pid;
  const recordPath = join(directory, 'remote-api-' + pid + '.json');
  const record = () => writeFile(recordPath, JSON.stringify({ pid, mcpUrl: 'http://127.0.0.1:' + address.port + '/mcp', mcpPort: address.port, mcpToken: token }));
  await record();
  const options: GatewayOptions = { dataDir: directory, baseline, upstreamVersion: version, alive: () => active, inspectProcess: async processId => ({ pid: processId, executable: 'C:\\MAGDA\\MAGDA.exe', version: '0.20.2', startedAt: '2026-01-01T00:00:00Z' }) };
  return {
    options, calls, pid, directory, token: () => token,
    setBehavior: (value: typeof behavior) => { behavior = value; },
    release: () => { releaseHang?.(); }, publish,
    stopIdentity: () => { active = false; },
    resumeIdentity: () => { active = true; },
    rotate: async () => { token = randomUUID(); await record(); },
    close: async () => { active = false; releaseHang?.(); await Promise.allSettled([...allServers].map(s => s.close())); await modern.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); await removeOwnedTemp(directory, 'magda-mcp-test-'); },
  };
}
