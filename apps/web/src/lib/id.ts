export function makeId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID && globalThis.isSecureContext) return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
