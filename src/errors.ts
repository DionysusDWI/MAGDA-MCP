export type GatewayErrorCode = 'NO_INSTANCE' | 'AMBIGUOUS_INSTANCE' | 'INVALID_RECORD' | 'INVALID_CONFIG' | 'INSTANCE_EXITED' | 'CONNECTION_FAILED' | 'AUTHENTICATION_FAILED' | 'UNSUPPORTED_VERSION' | 'CONTRACT_MISMATCH' | 'BUSY' | 'OUTCOME_UNKNOWN' | 'CANCELLED';
export class GatewayError extends Error {
  constructor(readonly code: GatewayErrorCode, message: string, readonly outcome?: 'unknown') { super(message); this.name = 'GatewayError'; }
  toJSON(): { code: GatewayErrorCode; message: string; outcome?: 'unknown' } {
    return { code: this.code, message: this.message, ...(this.outcome ? { outcome: this.outcome } : {}) };
  }
}
export function asGatewayError(error: unknown): GatewayError {
  return error instanceof GatewayError ? error : new GatewayError('CONNECTION_FAILED', 'Cannot communicate with MAGDA. Run doctor to check the instance and MCP settings.');
}
