import { Server, ProtocolError } from '@modelcontextprotocol/server';
import type { ServerContext, CallToolResult } from '@modelcontextprotocol/server';
import type { RequestOptions } from '@modelcontextprotocol/client';
import { Gateway } from '../connection/gateway.js';
import { GatewayError } from '../errors.js';
import { managementTools, callManagementTool, failureResult } from '../management/tools.js';
import { PROTOCOL_VERSIONS, VERSION } from '../constants.js';
export function businessMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const values = Object.fromEntries(Object.entries(meta).filter(([key]) => !key.startsWith('io.modelcontextprotocol/') && key !== 'progressToken'));
  return Object.keys(values).length ? values : undefined;
}
function businessResult<T extends object>(result: T): T {
  const value = result as T & { _meta?: Record<string, unknown> };
  if (!value._meta) return result;
  const { _meta: original, ...rest } = value;
  const meta = businessMeta(original);
  return { ...rest, ...(meta ? { _meta: meta } : {}) } as T;
}
function requestOptions(ctx: ServerContext): RequestOptions {
  const token = ctx.mcpReq._meta?.progressToken;
  return {
    signal: ctx.mcpReq.signal,
    ...(token !== undefined ? { onprogress: (progress) => { void ctx.mcpReq.notify({ method: 'notifications/progress', params: { ...progress, progressToken: token } }).catch(() => {}); } } : {}),
  };
}
export function createGatewayServer(gateway: Gateway): Server {
  const server = new Server({ name: 'MAGDA-MCP', version: VERSION }, {
    supportedProtocolVersions: PROTOCOL_VERSIONS,
    capabilities: { tools: {}, resources: { subscribe: true } },
    instructions: 'MAGDA-MCP targets MAGDA 0.20.2. Use magda_mcp.status for connection diagnostics and magda_mcp.reconnect after the bound instance exits. MAGDA manages scopes. Never blindly retry a mutation with an unknown outcome.',
  });
  function identify(ctx: ServerContext): void {
    const info = server.getClientVersion();
    void ctx;
    gateway.setHostName(info?.name);
  }
  server.setRequestHandler('tools/list', async (_request, ctx) => {
    identify(ctx); await gateway.probe();
    return { tools: [...gateway.catalog.tools, ...managementTools] };
  });
  server.setRequestHandler('tools/call', async (request, ctx) => {
    identify(ctx);
    const { name, arguments: args } = request.params;
    try {
      let result: CallToolResult;
      if (managementTools.some(t => t.name === name)) result = await callManagementTool(gateway, name, args);
      else result = businessResult(await gateway.callTool(name, args, businessMeta(ctx.mcpReq._meta), requestOptions(ctx)));
      return server.projectCallToolResult(result, gateway.catalog.tools.find(t => t.name === name)?.outputSchema);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (error instanceof GatewayError) return failureResult(error);
      return failureResult(new GatewayError('CONNECTION_FAILED', 'The MAGDA request failed. Run magda_mcp.status for diagnostics.'));
    }
  });
  server.setRequestHandler('resources/list', async (_request, ctx) => { identify(ctx); await gateway.probe(); return { resources: gateway.catalog.resources }; });
  server.setRequestHandler('resources/templates/list', async (_request, ctx) => { identify(ctx); await gateway.probe(); return { resourceTemplates: gateway.catalog.resourceTemplates }; });
  server.setRequestHandler('resources/read', async (request, ctx) => {
    identify(ctx);
    try {
      const meta = businessMeta(ctx.mcpReq._meta);
      return businessResult(await gateway.readResource({ uri: request.params.uri, ...(meta ? { _meta: meta } : {}) }, requestOptions(ctx)));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (error instanceof GatewayError) throw new ProtocolError(-32603, error.message, { code: error.code });
      throw new ProtocolError(-32603, 'MAGDA resource read failed.');
    }
  });
  server.setRequestHandler('resources/subscribe', async (request, ctx) => { identify(ctx); await gateway.setSubscriptions('legacy:' + request.params.uri, [request.params.uri]); return {}; });
  server.setRequestHandler('resources/unsubscribe', async request => { await gateway.removeSubscriptions('legacy:' + request.params.uri); return {}; });
  const resourceUpdated = (params: { uri: string }) => { void server.sendResourceUpdated(params).catch(() => {}); };
  gateway.on('resourceUpdated', resourceUpdated);
  server.onclose = () => { gateway.off('resourceUpdated', resourceUpdated); void gateway.close(); };
  server.onerror = () => {};
  return server;
}
