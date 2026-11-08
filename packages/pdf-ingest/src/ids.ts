/** Random id that also works outside secure contexts (e.g. the dev server opened over the LAN). */
export function makeId(prefix = ''): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function' && globalThis.isSecureContext !== false) return prefix + c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
