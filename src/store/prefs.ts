// Local, per-browser storage: preferences, recent and favourite peers, and
// remembered passwords. Passwords are only ever kept as the salted hash the
// protocol uses (sha256(password + peer salt)), never as plain text.
import { randomId } from '../core/util'

export type ImageQualityPref = 'best' | 'balanced' | 'low'
export type CodecPref = 'auto' | 'vp9' | 'vp8' | 'av1' | 'h264' | 'h265'
export type ScalePref = 'fit' | 'original'

export interface Prefs {
  myName: string
  imageQuality: ImageQualityPref
  codec: CodecPref
  scale: ScalePref
  disableAudio: boolean
  disableClipboard: boolean
  showRemoteCursor: boolean
  viewOnly: boolean
  lockAfterSessionEnd: boolean
  theme: 'system' | 'light' | 'dark'
}

export interface PeerRecord {
  id: string
  alias?: string
  hostname?: string
  username?: string
  platform?: string
  lastConnected?: number
}

const DEFAULT_PREFS: Prefs = {
  myName: 'Web client',
  imageQuality: 'balanced',
  codec: 'auto',
  scale: 'fit',
  disableAudio: false,
  disableClipboard: false,
  showRemoteCursor: false,
  viewOnly: false,
  lockAfterSessionEnd: false,
  theme: 'system',
}

function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function set(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable or full */
  }
}

// Peer lists and remembered passwords belong to the signed-in account, so two
// people sharing a browser do not see each other's devices.
let scope = ''

export function setStorageScope(user: string) {
  scope = user
}

const scoped = (name: string) => (scope ? `v3:u:${scope}:${name}` : `v3:${name}`)

export function loadPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...get<Partial<Prefs>>('v3:prefs', {}) }
}

export function savePrefs(p: Prefs) {
  set('v3:prefs', p)
}

/** Stable id this browser announces to peers (shown in their connection list). */
export function myId(): string {
  let id = get<string>('v3:my-id', '')
  if (!id) {
    id = `web-${randomId().slice(0, 8)}`
    set('v3:my-id', id)
  }
  return id
}

export function recentPeers(): PeerRecord[] {
  return get<PeerRecord[]>(scoped('recent'), [])
}

export function rememberPeer(rec: PeerRecord) {
  const list = recentPeers().filter((p) => p.id !== rec.id)
  const old = recentPeers().find((p) => p.id === rec.id)
  list.unshift({ ...old, ...rec, lastConnected: Date.now() })
  set(scoped('recent'), list.slice(0, 50))
}

export function forgetPeer(id: string) {
  set(scoped('recent'), recentPeers().filter((p) => p.id !== id))
  setFavorite(id, false)
  setSavedPassword(id, null)
}

export function favorites(): string[] {
  return get<string[]>(scoped('favorites'), [])
}

export function setFavorite(id: string, on: boolean) {
  const f = new Set(favorites())
  if (on) f.add(id)
  else f.delete(id)
  set(scoped('favorites'), [...f])
}

export function savedPassword(id: string): string | null {
  return get<Record<string, string>>(scoped('passwords'), {})[id] ?? null
}

/** Store (or with null, forget) a peer's salted password hash, base64. */
export function setSavedPassword(id: string, hashB64: string | null) {
  const all = get<Record<string, string>>(scoped('passwords'), {})
  if (hashB64) all[id] = hashB64
  else delete all[id]
  set(scoped('passwords'), all)
}

export function setPeerAlias(id: string, alias: string) {
  const list = recentPeers()
  const p = list.find((x) => x.id === id)
  if (p) {
    p.alias = alias || undefined
    set(scoped('recent'), list)
  }
}
