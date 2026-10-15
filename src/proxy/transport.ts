import type { Transport, TransportSendOptions, JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/server';
import { isJSONRPCRequest, isJSONRPCNotification } from '@modelcontextprotocol/server';
import { asGatewayError } from '../errors.js';
import type { Gateway } from '../connection/gateway.js';
/** Observes subscription filters; all framing, era selection and acknowledgement remain owned by the SDK. */
export class SubscriptionTransport implements Transport {
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined;
  hostName: string | undefined;
  private readonly pending = new Set<string>();
  private readonly cancelled = new Set<string>();
  constructor(private readonly inner: Transport, private readonly gateway: () => Gateway | undefined) {
    inner.onclose = () => this.onclose?.();
    inner.onerror = error => this.onerror?.(error);
    inner.onmessage = (message, extra) => { void this.receive(message, extra); };
  }
  private async receive(message: JSONRPCMessage, extra?: MessageExtraInfo): Promise<void> {
    if (isJSONRPCRequest(message)) {
      const meta = message.params?._meta as Record<string, unknown> | undefined;
      const info = (message.method === 'initialize' ? message.params?.clientInfo : meta?.['io.modelcontextprotocol/clientInfo']) as { name?: unknown } | undefined;
      if (typeof info?.name === 'string') { this.hostName = info.name; this.gateway()?.setHostName(info.name); }
      if (message.method === 'subscriptions/listen' && meta?.['io.modelcontextprotocol/protocolVersion'] === '2026-07-28') {
        const notifications = message.params?.notifications as { resourceSubscriptions?: unknown } | undefined;
        const requested = notifications?.resourceSubscriptions;
        if (Array.isArray(requested) && requested.every(u => typeof u === 'string') && requested.length <= 1024) {
          const requestId = message.id;
          const key = 'modern:' + JSON.stringify(requestId); this.pending.add(key);
          try {
            const gateway = this.gateway();
            const honored = requested.length && gateway ? await gateway.setSubscriptions(key, requested as string[]) : [];
            if (this.cancelled.delete(key)) { await gateway?.removeSubscriptions(key); return; }
            message = { ...message, params: { ...message.params, notifications: { ...notifications, resourceSubscriptions: honored } } };
          } catch (error) {
            const known = asGatewayError(error);
            await this.inner.send({ jsonrpc: '2.0', id: requestId, error: { code: -32603, message: known.message, data: { code: known.code } } });
            return;
          } finally { this.pending.delete(key); }
        }
      }
    } else if (isJSONRPCNotification(message) && message.method === 'notifications/cancelled') {
      const key = 'modern:' + JSON.stringify(message.params?.requestId);
      if (this.pending.has(key)) this.cancelled.add(key);
      void this.gateway()?.removeSubscriptions(key).catch(() => {});
    }
    this.onmessage?.(message, extra);
  }
  start(): Promise<void> { return this.inner.start(); }
  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> { return this.inner.send(message, options); }
  close(): Promise<void> { return this.inner.close(); }
  setProtocolVersion(version: string): void { this.inner.setProtocolVersion?.(version); }
  setSupportedProtocolVersions(versions: string[]): void { this.inner.setSupportedProtocolVersions?.(versions); }
}
