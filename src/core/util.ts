export const utf8 = (s: string) => new TextEncoder().encode(s)
export const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b)

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s.trim())
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', concat(...parts) as BufferSource)
  return new Uint8Array(digest)
}

export function bytesEqual(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown[]>> {
  private handlers: { [K in keyof Events]?: Set<(...args: Events[K]) => void> } = {}

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    const set = (this.handlers[event] ??= new Set())
    set.add(fn)
    return () => set.delete(fn)
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    this.handlers[event]?.forEach((fn) => fn(...args))
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
