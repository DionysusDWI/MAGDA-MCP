import { JSONRPCErrorResponseSchema } from '@modelcontextprotocol/core';
/** Preserve correlated native JSON-RPC failures returned with a non-2xx HTTP status.
 * The SDK normally reports only the HTTP failure in this case. A successful HTTP
 * envelope lets its JSON-RPC layer deliver the original code, message and data.
 * Authentication challenges remain owned by the SDK; no request is retried here.
 */
export const magdaFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: 'error' });
  if (response.ok || response.status === 401 || typeof init?.body !== 'string') return response;
  try {
    const sent = JSON.parse(init.body) as { id?: unknown };
    if (sent.id === undefined || sent.id === null) return response;
    const bytes = await response.clone().text();
    const parsed = JSONRPCErrorResponseSchema.safeParse(JSON.parse(bytes));
    if (parsed.success && parsed.data.id === sent.id) {
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
    }
  } catch { /* Non-RPC HTTP errors keep their original status. */ }
  return response;
};
