/**
 * Deterministic JSON stringifier to guarantee identical byte representations
 * for cryptographic signing and digest calculations regardless of key order.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalJson(item)).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys
    .filter(key => (obj as Record<string, unknown>)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson((obj as Record<string, unknown>)[key])}`);
  return '{' + entries.join(',') + '}';
}
