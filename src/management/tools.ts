import type { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { ProtocolError } from '@modelcontextprotocol/server';
import type { Gateway } from '../connection/gateway.js';
import { GatewayError } from '../errors.js';
export const managementTools: Tool[] = [
  { name: 'magda_mcp.status', description: 'Inspect MAGDA connection, bound process, compatibility and candidate instances. Available while MAGDA is offline. Does not test write permissions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'magda_mcp.reconnect', description: 'Explicitly reconnect to MAGDA. Supply pid when several instances are available. Refuses while native requests are in flight. Does not replay requests.', inputSchema: { type: 'object', properties: { pid: { type: 'integer', minimum: 1 } }, additionalProperties: false }, annotations: { readOnlyHint: false, openWorldHint: false } },
];
export function objectResult(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
}
export function failureResult(error: GatewayError): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: error.toJSON() }) }], isError: true };
}
export async function callManagementTool(gateway: Gateway, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  const keys = Object.keys(args);
  if (name === 'magda_mcp.status') {
    if (keys.length) throw new ProtocolError(-32602, 'magda_mcp.status accepts no arguments.');
    return objectResult(await gateway.status());
  }
  if (keys.some(k => k !== 'pid') || (args.pid !== undefined && (!Number.isSafeInteger(args.pid) || (args.pid as number) <= 0))) throw new ProtocolError(-32602, 'reconnect accepts only an optional positive integer pid.');
  return objectResult(await gateway.reconnect(args.pid as number | undefined));
}
