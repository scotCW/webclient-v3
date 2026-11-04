// Account API (login, address book, groups, share links).
import { loadServerConfig } from '../core/config'
import { myId } from '../store/prefs'

export interface ApiUser {
  name: string
  email?: string
  note?: string
  status?: number
  is_admin?: boolean
}

export interface AbPeer {
  id: string
  username?: string
  hostname?: string
  alias?: string
  platform?: string
  tags?: string[]
  hash?: string
  password?: string
}

export interface AbProfile {
  guid: string
  name: string
  owner?: string
  rule?: number
  note?: string
}

export interface GroupPeer {
  id: string
  info?: { username?: string; device_name?: string; os?: string }
  device_group_name?: string
  user?: string
  user_name?: string
  note?: string
}

export interface SharedPeer {
  idServer: string
  key: string
  peerId: string
  /** plain one-time password or a base64 salted hash */
  password: string
  hostname: string
  username: string
  platform: string
}

const TOKEN = 'v3:access-token'
const USER = 'v3:user'
// The admin UI served by the same API keeps its sign-in here; both use the same tokens.
const ADMIN_TOKEN = 'access_token'
const ADMIN_TOKEN_COPY = 'wc-option:local:access_token'

export class ApiError extends Error {}

function base(): string {
  return loadServerConfig().apiServer.replace(/\/+$/, '')
}

export function accessToken(): string {
  try {
    return localStorage.getItem(TOKEN) ?? ''
  } catch {
    return ''
  }
}

/** The admin UI's token on this origin, if it is signed in. */
export function adminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN) ?? ''
  } catch {
    return ''
  }
}

/**
 * Single sign-on with the admin UI: take over its token when we have none of our
 * own (or ours is no longer valid). Returns false when there is nothing to adopt.
 */
export function adoptAdminToken(): boolean {
  const t = adminToken()
  if (!t || t === accessToken()) return false
  try {
    localStorage.setItem(TOKEN, t)
  } catch {
    return false
  }
  return true
}

export function storedUser(): ApiUser | null {
  try {
    return JSON.parse(localStorage.getItem(USER) || 'null') as ApiUser | null
  } catch {
    return null
  }
}

const signOutListeners = new Set<() => void>()

/** Called whenever the session ends: sign-out, or the server rejecting the token. */
export function onSignedOut(fn: () => void): () => void {
  signOutListeners.add(fn)
  return () => signOutListeners.delete(fn)
}

function storeLogin(token: string, user: ApiUser | null) {
  const wasSignedIn = !!accessToken()
  try {
    if (token) localStorage.setItem(TOKEN, token)
    else localStorage.removeItem(TOKEN)
    if (user) localStorage.setItem(USER, JSON.stringify(user))
    else localStorage.removeItem(USER)
  } catch {
    /* storage unavailable */
  }
  if (wasSignedIn && !token) signOutListeners.forEach((fn) => fn())
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = accessToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(base() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError('Cannot reach the account server')
  }
  if (res.status === 401) {
    storeLogin('', null)
    throw new ApiError('Signed out: please sign in again')
  }
  let data: unknown = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (!res.ok) throw new ApiError(`Account server error (${res.status})`)
  }
  const err = (data as { error?: string } | null)?.error
  if (!res.ok || err) throw new ApiError(err || `Account server error (${res.status})`)
  return data as T
}

const deviceInfo = () => ({ os: navigator.platform || 'web', type: 'webclient', name: 'Web client' })

export async function loginOptions(): Promise<string[]> {
  try {
    const ops = await request<string[]>('GET', '/api/login-options', undefined, false)
    return Array.isArray(ops) ? ops : []
  } catch {
    return []
  }
}

export async function login(username: string, password: string): Promise<ApiUser> {
  const res = await request<{ access_token: string; user: ApiUser }>('POST', '/api/login', {
    username,
    password,
    id: myId(),
    uuid: myId(),
    autoLogin: true,
    type: 'account',
    deviceInfo: deviceInfo(),
  }, false)
  storeLogin(res.access_token, res.user)
  return res.user
}

/** Start an OIDC login: returns the URL to open and a code to poll with. */
export async function oidcStart(op: string): Promise<{ url: string; code: string }> {
  return request('POST', '/api/oidc/auth', { op, id: myId(), uuid: myId(), deviceInfo: deviceInfo() }, false)
}

/** Poll an OIDC login; resolves null while it is still pending. */
export async function oidcPoll(code: string): Promise<ApiUser | null> {
  const q = new URLSearchParams({ code, id: myId(), uuid: myId() })
  let res: { access_token?: string; user?: ApiUser; error?: string }
  try {
    res = await request('GET', `/api/oidc/auth-query?${q}`, undefined, false)
  } catch (e) {
    if (e instanceof ApiError && /No authed oidc/i.test(e.message)) return null
    throw e
  }
  if (!res.access_token) return null
  storeLogin(res.access_token, res.user ?? null)
  return res.user ?? null
}

/** Sign out everywhere on this site: the token is shared with the admin UI. */
export async function logout() {
  const token = accessToken()
  try {
    await request('POST', '/api/logout', { id: myId(), uuid: myId() })
  } finally {
    try {
      if (adminToken() === token) {
        localStorage.removeItem(ADMIN_TOKEN)
        localStorage.removeItem(ADMIN_TOKEN_COPY)
      }
    } catch {
      /* storage unavailable */
    }
    storeLogin('', null)
  }
}

export async function currentUser(): Promise<ApiUser> {
  const user = await request<ApiUser>('POST', '/api/currentUser', { id: myId(), uuid: myId() })
  storeLogin(accessToken(), user)
  return user
}

export interface ManagedServer {
  idServer: string
  relayServer: string
  key: string
}

/** Server settings for signed-in users; the API only hands these out with a valid token. */
export async function managedServer(): Promise<ManagedServer> {
  const res = await request<{ data?: { id_server?: string; relay_server?: string; key?: string } }>('POST', '/api/server-config-v2')
  const d = res.data ?? {}
  return { idServer: d.id_server ?? '', relayServer: d.relay_server ?? '', key: d.key ?? '' }
}

export async function personalAddressBook(): Promise<string> {
  const res = await request<{ guid: string }>('POST', '/api/ab/personal')
  return res.guid
}

export async function sharedAddressBooks(): Promise<AbProfile[]> {
  const res = await request<{ data?: AbProfile[] }>('POST', '/api/ab/shared/profiles?current=1&pageSize=100')
  return res.data ?? []
}

export async function addressBookPeers(guid: string): Promise<AbPeer[]> {
  const out: AbPeer[] = []
  for (let page = 1; page < 50; page++) {
    const q = new URLSearchParams({ current: String(page), pageSize: '100', ab: guid })
    const res = await request<{ total?: number; data?: AbPeer[] }>('POST', `/api/ab/peers?${q}`)
    const data = res.data ?? []
    out.push(...data)
    if (data.length < 100 || out.length >= (res.total ?? 0)) break
  }
  return out
}

export async function addPeerToAddressBook(guid: string, peer: AbPeer) {
  await request('POST', `/api/ab/peer/add/${encodeURIComponent(guid)}`, peer)
}

export async function accessibleDevices(): Promise<GroupPeer[]> {
  const out: GroupPeer[] = []
  for (let page = 1; page < 50; page++) {
    const q = new URLSearchParams({ current: String(page), pageSize: '100', status: '1', accessible: '' })
    const res = await request<{ total?: number; data?: GroupPeer[] }>('GET', `/api/peers?${q}`)
    const data = res.data ?? []
    out.push(...data)
    if (data.length < 100 || out.length >= (res.total ?? 0)) break
  }
  return out
}

export async function resolveShareToken(token: string): Promise<SharedPeer> {
  const res = await request<{
    data?: {
      id_server?: string
      key?: string
      peer?: { tmppwd?: string; info?: { id?: string; hostname?: string; username?: string; platform?: string; hash?: string } }
    }
  }>('POST', '/api/shared-peer', { share_token: token }, false)
  const d = res.data ?? {}
  const info = d.peer?.info ?? {}
  if (!info.id) throw new ApiError('This share link is invalid or has expired')
  return {
    idServer: d.id_server ?? '',
    key: d.key ?? '',
    peerId: info.id,
    password: d.peer?.tmppwd || info.hash || '',
    hostname: info.hostname ?? '',
    username: info.username ?? '',
    platform: info.platform ?? '',
  }
}
