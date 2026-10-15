import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Transport } from '@modelcontextprotocol/server';
import { Gateway } from '../connection/gateway.js';
import type { GatewayOptions } from '../connection/gateway.js';
import { createGatewayServer } from './server.js';
import { SubscriptionTransport } from './transport.js';
export function startStdio(options: GatewayOptions, transport?: Transport): { close(): Promise<void> } {
  const gateways = new Set<Gateway>();
  let active: Gateway | undefined;
  const observed = new SubscriptionTransport(transport ?? new StdioServerTransport(), () => active);
  const handle = serveStdio(() => {
    const gateway = new Gateway(options); gateway.setHostName(observed.hostName); active = gateway; gateways.add(gateway);
    gateway.once('closed', () => gateways.delete(gateway));
    return createGatewayServer(gateway);
  }, { transport: observed, onerror: () => { process.stderr.write('[MAGDA-MCP] Protocol or connection error; use doctor for diagnostics.\n'); } });
  return { close: async () => { await handle.close(); await Promise.allSettled([...gateways].map(gateway => gateway.close())); } };
}
