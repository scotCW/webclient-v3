import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { SessionKind } from '../core/session'

export interface SessionTab {
  key: string
  kind: SessionKind
  peerId: string
  title: string
  /** password from a share link / address book: base64 salted hash or plain text */
  preset?: { hash?: string; plain?: string }
}

export interface AppActions {
  open(kind: SessionKind, peerId: string, opts?: { title?: string; preset?: SessionTab['preset'] }): void
  close(key: string): void
  rename(key: string, title: string): void
  openSettings(): void
  openAccount(): void
  refreshHome(): void
}

export const AppContext = createContext<AppActions | null>(null)

export function useApp(): AppActions {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext missing')
  return ctx
}

/** Normalise what people type as a peer id (spaces are common when copying). */
export function cleanPeerId(id: string) {
  return id.replace(/\s+/g, '')
}
