// Server settings. Defaults come from the hosting API's
// /webclient-config/index.js (which writes them to localStorage); the user can
// override them in Settings.

export interface ServerConfig {
  /** host[:port] of the ID server (hbbs), default port 21116 */
  idServer: string
  /** host[:port] of the relay server (hbbr); empty = use the one the ID server names */
  relayServer: string
  /** the server's public key (base64), required by servers started with -k */
  key: string
  /** base URL of the account API, e.g. https://api.example.com */
  apiServer: string
}

const OVERRIDES = 'v3:server'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function loadServerConfig(): ServerConfig {
  const defaults: ServerConfig = {
    idServer: read('custom-rendezvous-server'),
    relayServer: read('relay-server'),
    key: read('key'),
    // The dev server proxies the API, so use it directly during development.
    apiServer: import.meta.env.DEV ? location.origin : read('api-server') || location.origin,
  }
  try {
    const raw = localStorage.getItem(OVERRIDES)
    if (raw) {
      const o = JSON.parse(raw) as Partial<ServerConfig>
      for (const k of Object.keys(defaults) as (keyof ServerConfig)[]) {
        if (typeof o[k] === 'string' && o[k]) defaults[k] = o[k] as string
      }
    }
  } catch {
    /* ignore broken overrides */
  }
  return defaults
}

export function saveServerOverrides(cfg: Partial<ServerConfig>) {
  try {
    localStorage.setItem(OVERRIDES, JSON.stringify(cfg))
  } catch {
    /* storage unavailable */
  }
}

export function loadServerOverrides(): Partial<ServerConfig> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES) || '{}') as Partial<ServerConfig>
  } catch {
    return {}
  }
}

const ID_PORT = 21116
const RELAY_PORT = 21117

function splitHost(server: string, defaultPort: number): [string, number] {
  const s = server.trim()
  const v6 = /^\[(.+)\](?::(\d+))?$/.exec(s)
  if (v6) return [`[${v6[1]}]`, v6[2] ? parseInt(v6[2]) : defaultPort]
  const i = s.lastIndexOf(':')
  if (i > 0 && s.indexOf(':') === i) return [s.slice(0, i), parseInt(s.slice(i + 1)) || defaultPort]
  return [s, defaultPort]
}

/**
 * WebSocket URL for the ID server or a relay. Pages served over https must use
 * wss, which these servers only offer behind a TLS reverse proxy at
 * /ws/id and /ws/relay; plain http pages use the raw WebSocket ports (+2).
 */
export function wsUrl(server: string, kind: 'id' | 'relay'): string {
  if (/^wss?:\/\//.test(server)) return server
  const [host, port] = splitHost(server, kind === 'id' ? ID_PORT : RELAY_PORT)
  if (location.protocol === 'https:') return `wss://${host}/ws/${kind}`
  return `ws://${host}:${port + 2}`
}

export const CLIENT_VERSION = '1.4.0'
