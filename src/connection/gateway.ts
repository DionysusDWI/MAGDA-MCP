import { EventEmitter } from 'node:events';
import { magdaFetch } from './http.js';
import { Client, StreamableHTTPClientTransport, ProtocolError } from '@modelcontextprotocol/client';
import type { CallToolResult, ReadResourceResult, McpSubscription, RequestOptions, ResourceUpdatedNotificationParams } from '@modelcontextprotocol/client';
import { discover, selectEndpoint } from '../discovery/index.js';
import type { DiscoveryOptions, DiscoveryResult, Endpoint } from '../discovery/index.js';
import { inspectWindowsProcess } from '../platform/windows/process.js';
import type { InspectProcess, ProcessInfo } from '../platform/windows/process.js';
import { asGatewayError, GatewayError } from '../errors.js';
import { fingerprint } from '../contract.js';
import type { Baseline, Catalog } from '../contract.js';
import { MAGDA_VERSION, PROTOCOL_VERSIONS, VERSION } from '../constants.js';
export interface GatewayOptions extends DiscoveryOptions {
  baseline: Baseline; pid?: number; inspectProcess?: InspectProcess;
  upstreamVersion?: string; requestTimeoutMs?: number;
}
export class Gateway extends EventEmitter {
  private client: Client | undefined;
  private endpoint: Endpoint | undefined;
  private processInfo: ProcessInfo | null = null;
  private preparing: Promise<void> | undefined;
  private reconnecting = false;
  private disposed = false;
  private lost = false;
  private boundPid: number | undefined;
  private inFlight = 0;
  private identity = 'MAGDA-MCP/unknown';
  private liveCatalog: Catalog | undefined;
  private actualFingerprint: string | undefined;
  private apiVersion: string | undefined;
  private state: 'offline' | 'connecting' | 'connected' | 'disconnected' | 'incompatible' = 'offline';
  private lastError: GatewayError | undefined;
  private discovery: DiscoveryResult | undefined;
  private readonly requestedSubscriptions = new Map<string, Set<string>>();
  private upstreamSubscription: McpSubscription | undefined;
  private honoredUris = new Set<string>();
  private subscriptionQueue: Promise<void> = Promise.resolve();
  private recovering: NodeJS.Timeout | undefined;
  constructor(private readonly options: GatewayOptions) { super(); }
  setHostName(name: string | undefined): void {
    if (!name) return;
    const normalized = (name ?? 'unknown').normalize('NFC').trim().toLowerCase().split('').filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').slice(0, 96) || 'unknown';
    const identity = 'MAGDA-MCP/' + normalized;
    if (!this.endpoint && !this.client) this.identity = identity;
  }
  get catalog(): Catalog { return (this.client ? this.liveCatalog : undefined) ?? this.options.baseline.catalog; }
  get nativeClient(): Client | undefined { return this.client; }
  get busy(): boolean { return this.inFlight > 0 || this.reconnecting; }
  private remember(error: unknown): GatewayError {
    const known = asGatewayError(error); this.lastError = known; return known;
  }
  async probe(): Promise<void> { try { await this.ensureConnected(); } catch (error) { this.remember(error); } }
  async ensureConnected(): Promise<void> {
    if (this.disposed) throw new GatewayError('CONNECTION_FAILED', 'The MCP connection has closed.');
    if (this.reconnecting) throw new GatewayError('BUSY', 'An explicit reconnect is in progress.');
    if (!this.preparing) {
      const pending = this.prepare(); this.preparing = pending;
      void pending.finally(() => { if (this.preparing === pending) this.preparing = undefined; }).catch(() => {});
    }
    try { await this.preparing; } catch (error) { throw this.remember(error); }
  }
  private async prepare(): Promise<void> {
    this.discovery = await discover(this.options);
    if (this.lost) throw new GatewayError('INSTANCE_EXITED', 'The bound MAGDA instance exited. Use magda_mcp.reconnect to select an instance explicitly.');
    let target: Endpoint;
    try { target = selectEndpoint(this.discovery, this.boundPid ?? this.options.pid); }
    catch (error) {
      if (this.boundPid !== undefined) { this.lost = true; this.state = 'disconnected'; await this.disconnect(); throw new GatewayError('INSTANCE_EXITED', 'The bound MAGDA instance is unavailable. Explicit reconnect is required.'); }
      this.state = 'offline'; throw error;
    }
    if (this.client && this.endpoint?.url === target.url && this.endpoint.token === target.token) return;
    const info = await (this.options.inspectProcess ?? inspectWindowsProcess)(target.pid);
    if (this.processInfo?.startedAt && info?.startedAt && info.startedAt !== this.processInfo.startedAt) {
      this.lost = true; this.state = 'disconnected'; await this.disconnect();
      throw new GatewayError('INSTANCE_EXITED', 'The process identity changed. Explicit reconnect is required.');
    }
    const restoring = this.endpoint !== undefined;
    await this.disconnect();
    this.boundPid = target.pid; this.endpoint = target; this.processInfo = info; this.state = 'connecting';
    const supported = this.options.upstreamVersion ? [this.options.upstreamVersion] : PROTOCOL_VERSIONS;
    const modern = this.options.upstreamVersion ? this.options.upstreamVersion >= '2026-07-28' : true;
    const client = new Client({ name: this.identity, version: VERSION }, {
      supportedProtocolVersions: supported,
      versionNegotiation: { mode: modern ? (this.options.upstreamVersion ? { pin: this.options.upstreamVersion } : 'auto') : 'legacy', probe: { timeoutMs: 5000, maxRetries: 0 } },
      inputRequired: { autoFulfill: false },
    });
    client.onerror = () => {};
    client.setNotificationHandler('notifications/resources/updated', notification => {
      this.emit('resourceUpdated', { uri: notification.params.uri });
    });
    client.onclose = () => {
      if (this.client === client) { this.client = undefined; this.state = 'disconnected'; this.scheduleRecovery(); }
    };
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(target.url), {
        fetch: magdaFetch, authProvider: { token: async () => this.endpoint?.token },
        requestInit: { redirect: 'error' }, onInsufficientScope: 'throw', maxStepUpRetries: 0,
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      }));
      const requestOptions = { timeout: this.options.requestTimeoutMs ?? 30000 };
      const [tools, resources, templates, description] = await Promise.all([
        client.listTools({}, requestOptions), client.listResources({}, requestOptions), client.listResourceTemplates({}, requestOptions),
        client.request({ method: 'tools/call', params: { name: 'system.describe', arguments: {} } }, requestOptions),
      ]);
      if (description.isError) throw new GatewayError('CONNECTION_FAILED', 'MAGDA system.describe failed.');
      this.liveCatalog = { tools: tools.tools, resources: resources.resources, resourceTemplates: templates.resourceTemplates };
      this.actualFingerprint = fingerprint(this.liveCatalog);
      const content = description.structuredContent as Record<string, unknown> | undefined;
      this.apiVersion = typeof content?.apiVersion === 'string' ? content.apiVersion : undefined;
      if (this.disposed) throw new GatewayError('CONNECTION_FAILED', 'The MCP connection has closed.');
      this.client = client;
      if (info?.version !== MAGDA_VERSION) {
        this.state = 'incompatible'; this.lastError = new GatewayError('UNSUPPORTED_VERSION', 'Native changes require a verified MAGDA 0.20.2 executable. Read access remains available.');
      } else if (this.apiVersion !== this.options.baseline.apiVersion || this.actualFingerprint !== this.options.baseline.fingerprint) {
        this.state = 'incompatible'; this.lastError = new GatewayError('CONTRACT_MISMATCH', 'The running MAGDA interface differs from the verified 0.20.2 contract. Native changes are blocked.');
      } else { this.state = 'connected'; this.lastError = undefined; }
      if (this.requestedSubscriptions.size) await this.applySubscriptions(client);
      if (restoring) for (const uri of this.honoredUris) this.emit('resourceUpdated', { uri });
      this.emit('connected');
    } catch (error) {
      if (this.client === client) this.client = undefined;
      await client.close().catch(() => {}); this.state = 'disconnected';
      throw error instanceof GatewayError ? error : new GatewayError('CONNECTION_FAILED', 'Cannot connect to the selected MAGDA MCP endpoint. Check its MCP listener and credentials.');
    }
  }
  async status(): Promise<Record<string, unknown>> {
    await this.probe();
    return {
      state: this.state, boundPid: this.boundPid ?? null,
      candidatePids: this.discovery?.endpoints.map(e => e.pid) ?? [], discoveryIssues: this.discovery?.issues ?? [],
      applicationVersion: this.processInfo?.version ?? null, protocolVersion: this.client?.getNegotiatedProtocolVersion() ?? null,
      apiVersion: this.apiVersion ?? null, identity: this.identity,
      contract: { baselineVerified: this.options.baseline.verified, matches: this.actualFingerprint === this.options.baseline.fingerprint, versionVerified: this.processInfo?.version === MAGDA_VERSION },
      catalogSource: this.liveCatalog && this.client ? 'live' : 'baseline',
      counts: { nativeTools: this.catalog.tools.length, localTools: 2, tools: this.catalog.tools.length + 2, resources: this.catalog.resources.length, templates: this.catalog.resourceTemplates.length },
      inFlight: this.inFlight, writePermissions: 'managed-by-magda-not-probed', lastError: this.lastError?.toJSON() ?? null,
    };
  }
  async reconnect(pid?: number): Promise<Record<string, unknown>> {
    if (this.busy || this.preparing) throw new GatewayError('BUSY', 'A native request or connection change is in progress. Wait before reconnecting.');
    this.reconnecting = true;
    try {
      const found = await discover(this.options); selectEndpoint(found, pid);
      await this.disconnect(); this.boundPid = pid; this.endpoint = undefined; this.processInfo = null; this.lost = false; this.liveCatalog = undefined; this.actualFingerprint = undefined;
      // Explicit selection replaces the startup --pid preference for this connection.
      const selected = selectEndpoint(found, pid); this.boundPid = selected.pid;
      await this.prepare();
    } finally { this.reconnecting = false; }
    return this.status();
  }
  async callTool(name: string, args: Record<string, unknown> | undefined, meta?: Record<string, unknown>, options: RequestOptions = {}): Promise<CallToolResult> {
    if (this.reconnecting) throw new GatewayError('BUSY', 'An explicit reconnect is in progress.');
    this.inFlight++;
    let sent = false;
    let mutation = true;
    try {
      await this.ensureConnected();
      const tool = this.catalog.tools.find(t => t.name === name);
      mutation = tool?.annotations?.readOnlyHint !== true;
      if (mutation && this.state === 'incompatible') throw this.lastError ?? new GatewayError('CONTRACT_MISMATCH', 'Native changes are blocked by compatibility checks.');
      const client = this.client!;
      if (options.signal?.aborted) throw new GatewayError('CANCELLED', 'The request was cancelled before sending.');
      sent = true;
      return await client.request({ method: 'tools/call', params: { name, ...(args !== undefined ? { arguments: args } : {}), ...(meta ? { _meta: meta } : {}) } }, { timeout: this.options.requestTimeoutMs ?? 30000, ...options, allowInputRequired: true });
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (sent && mutation) throw this.remember(new GatewayError('OUTCOME_UNKNOWN', 'The native request ended without a confirmed response. Its result is unknown. Inspect MAGDA before retrying; no mutation was replayed.', 'unknown'));
      if (options.signal?.aborted) throw new GatewayError('CANCELLED', 'The request was cancelled. Cancelling a request does not cancel a MAGDA background job.');
      throw this.remember(error);
    } finally { this.inFlight--; }
  }
  async readResource(params: { uri: string; _meta?: Record<string, unknown> }, options: RequestOptions = {}): Promise<ReadResourceResult> {
    if (this.reconnecting) throw new GatewayError('BUSY', 'An explicit reconnect is in progress.');
    this.inFlight++;
    try { await this.ensureConnected(); return await this.client!.request({ method: 'resources/read', params }, { timeout: this.options.requestTimeoutMs ?? 30000, ...options }); }
    catch (error) { if (error instanceof ProtocolError) throw error; throw this.remember(error); }
    finally { this.inFlight--; }
  }
  async setSubscriptions(key: string, uris: string[]): Promise<string[]> {
    await this.ensureConnected();
    const previous = this.requestedSubscriptions.get(key);
    this.requestedSubscriptions.set(key, new Set(uris));
    const pending = this.subscriptionQueue.then(async () => { await this.applySubscriptions(this.client!); });
    this.subscriptionQueue = pending.catch(() => {});
    try { await pending; return uris.filter(uri => this.honoredUris.has(uri)); }
    catch (error) { if (previous) this.requestedSubscriptions.set(key, previous); else this.requestedSubscriptions.delete(key); throw error; }
  }
  async removeSubscriptions(key: string): Promise<void> {
    this.requestedSubscriptions.delete(key);
    if (!this.client || this.disposed) return;
    const pending = this.subscriptionQueue.then(async () => { if (this.client) await this.applySubscriptions(this.client); });
    this.subscriptionQueue = pending.catch(() => {}); await pending;
  }
  private async applySubscriptions(client: Client): Promise<void> {
    const wanted = new Set([...this.requestedSubscriptions.values()].flatMap(set => [...set]));
    const old = this.upstreamSubscription; this.upstreamSubscription = undefined;
    if (old) await old.close().catch(() => {});
    if (client.getNegotiatedProtocolVersion()! >= '2026-07-28') {
      this.honoredUris = new Set();
      if (!wanted.size) return;
      const sub = await client.listen({ resourceSubscriptions: [...wanted] }, { timeout: 5000 });
      this.upstreamSubscription = sub; this.honoredUris = new Set(sub.honoredFilter.resourceSubscriptions ?? []);
      void sub.closed.then(reason => { if (reason === 'remote' && this.upstreamSubscription === sub) this.scheduleRecovery(); });
    } else {
      for (const uri of this.honoredUris) if (!wanted.has(uri)) await client.unsubscribeResource({ uri });
      for (const uri of wanted) if (!this.honoredUris.has(uri)) await client.subscribeResource({ uri });
      this.honoredUris = wanted;
    }
  }
  private scheduleRecovery(): void {
    if (this.disposed || this.lost || !this.requestedSubscriptions.size || this.recovering) return;
    this.recovering = setTimeout(() => {
      this.recovering = undefined;
      void this.ensureConnected().then(async () => {
        if (this.client) await this.applySubscriptions(this.client);
        for (const uri of this.honoredUris) this.emit('resourceUpdated', { uri } satisfies ResourceUpdatedNotificationParams);
      }).catch(() => this.scheduleRecovery());
    }, 1000);
    this.recovering.unref();
  }
  private async disconnect(): Promise<void> {
    if (this.recovering) { clearTimeout(this.recovering); this.recovering = undefined; }
    const sub = this.upstreamSubscription; this.upstreamSubscription = undefined;
    const client = this.client; this.client = undefined; this.honoredUris = new Set();
    if (sub) await sub.close().catch(() => {});
    if (client) await client.close().catch(() => {});
  }
  async close(): Promise<void> { this.disposed = true; this.requestedSubscriptions.clear(); await this.disconnect(); this.emit('closed'); this.removeAllListeners(); }
}
