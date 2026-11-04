import { FolderOpen, House, Monitor, SquareTerminal, X } from 'lucide-preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { ApiError, resolveShareToken } from '../api/client'
import type { SessionKind } from '../core/session'
import { randomId } from '../core/util'
import { loadPrefs } from '../store/prefs'
import { AccountDialog } from './AccountDialog'
import { Dialog } from './components/Dialog'
import { FileManager } from './FileManager'
import { Home } from './Home'
import { RemoteView } from './RemoteView'
import { SettingsDialog, applyTheme } from './Settings'
import { AppActions, AppContext, SessionTab, cleanPeerId, presetFrom } from './state'
import { TerminalView } from './TerminalView'

const KIND_ICON = { remote: Monitor, file: FolderOpen, terminal: SquareTerminal }

export function App() {
  const [tabs, setTabs] = useState<SessionTab[]>([])
  const [active, setActive] = useState('home')
  const [dialog, setDialog] = useState<'settings' | 'account' | null>(null)
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => applyTheme(loadPrefs().theme), [])

  const actions: AppActions = useMemo(
    () => ({
      open(kind: SessionKind, peerId: string, opts) {
        const key = randomId()
        setTabs((t) => [...t, { key, kind, peerId, title: opts?.title || peerId, preset: opts?.preset, server: opts?.server }])
        setActive(key)
      },
      close(key) {
        setTabs((t) => {
          const idx = t.findIndex((x) => x.key === key)
          const next = t.filter((x) => x.key !== key)
          setActive((a) => (a === key ? (next[Math.max(0, idx - 1)]?.key ?? 'home') : a))
          return next
        })
      },
      rename(key, title) {
        setTabs((t) => t.map((x) => (x.key === key ? { ...x, title } : x)))
      },
      openSettings: () => setDialog('settings'),
      openAccount: () => setDialog('account'),
      refreshHome: () => setRevision((r) => r + 1),
    }),
    [],
  )

  // Deep links: #/<peer id>, #/<peer id>?files, #/?share_token=… (also used by older links).
  // Handled on load and whenever the hash changes (a link opened in an existing tab).
  useEffect(() => {
    const handle = () => openFromHash()
    handle()
    window.addEventListener('hashchange', handle)
    return () => window.removeEventListener('hashchange', handle)
  }, [])

  const openFromHash = () => {
    const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
    if (!hash) return
    history.replaceState(null, '', location.pathname + location.search)
    const [idPart, query = ''] = hash.split('?')
    const params = new URLSearchParams(query)
    const share = params.get('share_token')
    if (share) {
      void resolveShareToken(share)
        .then((sp) =>
          actions.open('remote', sp.peerId, {
            title: sp.hostname || sp.peerId,
            preset: presetFrom(sp.password),
            server: sp.idServer ? { idServer: sp.idServer, key: sp.key } : undefined,
          }),
        )
        .catch((e) => setNotice(e instanceof ApiError ? e.message : 'Could not open the share link'))
      return
    }
    const id = cleanPeerId(idPart)
    if (/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      const kind: SessionKind = params.has('files') ? 'file' : params.has('terminal') ? 'terminal' : 'remote'
      actions.open(kind, id)
    }
  }

  // Warn before closing the page with sessions open.
  useEffect(() => {
    if (!tabs.length) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [tabs.length])

  return (
    <AppContext.Provider value={actions}>
      <div class="app">
        <nav class="tabstrip" role="tablist">
          <button class={`tab${active === 'home' ? ' active' : ''}`} role="tab" aria-selected={active === 'home'} onClick={() => setActive('home')}>
            <House size={15} />
            <span class="title">Home</span>
          </button>
          {tabs.map((t) => {
            const Icon = KIND_ICON[t.kind]
            return (
              <div key={t.key} class={`tab${active === t.key ? ' active' : ''}`} role="tab" aria-selected={active === t.key} onClick={() => setActive(t.key)}>
                <Icon size={15} />
                <span class="title" title={t.title}>
                  {t.title}
                </span>
                <button
                  class="close"
                  title="Close"
                  onClick={(e) => {
                    e.stopPropagation()
                    actions.close(t.key)
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </nav>
        <div class="views">
          <div class={`view${active === 'home' ? ' active' : ''}`}>
            <Home revision={revision} />
          </div>
          {tabs.map((t) =>
            t.kind === 'remote' ? (
              <RemoteView key={t.key} tab={t} active={active === t.key} />
            ) : t.kind === 'file' ? (
              <FileManager key={t.key} tab={t} active={active === t.key} />
            ) : (
              <TerminalView key={t.key} tab={t} active={active === t.key} />
            ),
          )}
        </div>
      </div>
      {dialog === 'settings' && (
        <SettingsDialog
          onClose={() => {
            setDialog(null)
            setRevision((r) => r + 1)
          }}
        />
      )}
      {dialog === 'account' && (
        <AccountDialog
          onClose={() => setDialog(null)}
          onSignedIn={() => {
            setDialog(null)
            setRevision((r) => r + 1)
          }}
        />
      )}
      {notice && (
        <Dialog title="Notice" onClose={() => setNotice('')}>
          <p>{notice}</p>
          <div class="buttons">
            <button class="btn primary" onClick={() => setNotice('')}>
              OK
            </button>
          </div>
        </Dialog>
      )}
    </AppContext.Provider>
  )
}
