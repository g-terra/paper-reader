// Small polyfills for older iPad/iPhone browsers (Safari and Chrome on iOS share WebKit, so an iPad
// that hasn't been updated in a while lacks these). pdf.js and some libraries call them directly.
// This module must be the first import of main.tsx so it runs before anything else.

const P = Promise as unknown as { withResolvers?: unknown };
if (!P.withResolvers) {
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const U = URL as unknown as { parse?: unknown; canParse?: unknown };
if (!U.parse) {
  U.parse = (url: string | URL, base?: string | URL) => {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  };
}
if (!U.canParse) U.canParse = (url: string | URL, base?: string | URL) => (U.parse as (u: string | URL, b?: string | URL) => URL | null)(url, base) !== null;

function defineAt(proto: { at?: unknown }) {
  if (proto.at) return;
  Object.defineProperty(proto, 'at', {
    configurable: true,
    writable: true,
    value(this: ArrayLike<unknown>, i: number) {
      const n = Math.trunc(i) || 0;
      const k = n < 0 ? this.length + n : n;
      return k < 0 || k >= this.length ? undefined : this[k];
    },
  });
}
defineAt(Array.prototype);
defineAt(String.prototype as unknown as { at?: unknown });
defineAt(Object.getPrototypeOf(Int8Array.prototype));

const u8 = Uint8Array.prototype as unknown as { toHex?: unknown };
if (!u8.toHex) {
  Object.defineProperty(u8, 'toHex', {
    configurable: true,
    writable: true,
    value(this: Uint8Array) {
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    },
  });
}

if (!(globalThis as { structuredClone?: unknown }).structuredClone) {
  (globalThis as { structuredClone?: unknown }).structuredClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
}

export {};
