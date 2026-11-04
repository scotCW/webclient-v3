import { FolderOpen, House, LogIn, Monitor, SquareTerminal, X } from 'lucide-preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ApiError, ApiUser, accessToken, adoptAdminToken, currentUser, managedServer, onSignedOut, resolveShareToken } from '../api/client'
import { setManagedServer } from '../core/config'
import type { SessionKind } from '../core/session'
import { randomId } from '../core/util'
import { loadPrefs, setStorageScope } from '../store/prefs'
import { SignInPage } from './AccountDialog'
import { Dialog } from './components/Dialog'
import { FileManager } from './FileManager'
import { Home } from './Home'
import { RemoteView } from './RemoteView'
import { SettingsDialog, applyTheme } from './Settings'
import { AppActions, AppContext, SessionTab, cleanPeerId, presetFrom } from './state'
import { TerminalView } from './TerminalView'

const KIND_ICON = { remote: Monitor, file: FolderOpen, terminal: SquareTerminal }

/**
 * checking: validating a stored token; signedOut: only the sign-in page;
 * signedIn: the full client; share: a share link opened without an account,
 * limited to that one session.
 */
type Auth = 'checking' | 'signedOut' | 'signedIn' | 'share'

interface DeepLink {
  kind: SessionKind
  id: string
}

function parseHash(): { share?: string; link?: DeepLink } {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  if (!hash) return {}
  history.replaceState(null, '', location.pathname + location.search)
  const [idPart, query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  const share = params.get('share_token')
  if (share) return { share }
  const id = cleanPeerId(idPart)
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return {}
  const kind: SessionKind = params.has('files') ? 'file' : params.has('terminal') ? 'terminal' : 'remote'
  return { link: { kind, id } }
}

export function App() {
  const [auth, setAuth] = useState<Auth>('checking')
  const [signInNotice, setSignInNotice] = useState('')
  const [tabs, setTabs] = useState<SessionTab[]>([])
  const [active, setActive] = useState('home')
  const [dialog, setDialog] = useState<'settings' | null>(null)
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState('')
  /** a #/<id> link waiting for sign-in */
  const pendingLink = useRef<DeepLink | null>(null)
  const authRef = useRef<Auth>('checking')
  authRef.current = auth

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
      openAccount: () => setAuth('signedOut'),
      refreshHome: () => setRevision((r) => r + 1),
    }),
    [],
  )

  /** Finish signing in: scope local storage to the user and load the server settings. */
  const enter = async (user: ApiUser) => {
    setStorageScope(user.name)
    try {
      const m = await managedServer()
      setManagedServer(m.idServer ? m : null)
    } catch {
      /* keep whatever settings are already configured */
    }
    setSignInNotice('')
    setAuth('signedIn')
    setRevision((r) => r + 1)
    const link = pendingLink.current
    pendingLink.current = null
    if (link) actions.open(link.kind, link.id)
  }

  /** Our own token if it is still valid, otherwise the admin UI's (single sign-on). */
  const restoreSignIn = async (): Promise<ApiUser | null> => {
    if (accessToken()) {
      try {
        return await currentUser()
      } catch (e) {
        if (e instanceof ApiError && !/sign in again/i.test(e.message)) setSignInNotice(e.message)
      }
    }
    if (adoptAdminToken()) {
      try {
        return await currentUser()
      } catch {
        /* the admin UI's token is no longer valid either */
      }
    }
    return null
  }

  const openShare = (token: string) => {
    void resolveShareToken(token)
      .then((sp) =>
        actions.open('remote', sp.peerId, {
          title: sp.hostname || sp.peerId,
          preset: presetFrom(sp.password),
          server: sp.idServer ? { idServer: sp.idServer, key: sp.key } : undefined,
        }),
      )
      .catch((e) => setNotice(e instanceof ApiError ? e.message : 'Could not open the share link'))
  }

  const handleHash = () => {
    const { share, link } = parseHash()
    if (share) {
      // Share links work without an account, but only for that one device.
      if (authRef.current !== 'signedIn') setAuth('share')
      openShare(share)
    } else if (link) {
      if (authRef.current === 'signedIn') actions.open(link.kind, link.id)
      else pendingLink.current = link
    }
  }

  // Start-up: open a share link if there is one, otherwise require a valid sign-in.
  useEffect(() => {
    const { share, link } = parseHash()
    pendingLink.current = link ?? null
    if (share) {
      setAuth('share')
      openShare(share)
    } else {
      void restoreSignIn().then((user) => {
        if (user) void enter(user)
        else setAuth('signedOut')
      })
    }
    window.addEventListener('hashchange', handleHash)
    // Signing in to the admin UI in another tab signs the web client in too.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'access_token' || !e.newValue || authRef.current !== 'signedOut') return
      if (adoptAdminToken()) void currentUser().then(enter).catch(() => undefined)
    }
    window.addEventListener('storage', onStorage)
    const offSignedOut = onSignedOut(() => {
      setTabs([])
      setActive('home')
      setManagedServer(null)
      setStorageScope('')
      setAuth('signedOut')
    })
    return () => {
      window.removeEventListener('hashchange', handleHash)
      window.removeEventListener('storage', onStorage)
      offSignedOut()
    }
  }, [])

  // Warn before closing the page with sessions open.
  useEffect(() => {
    if (!tabs.length) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [tabs.length])

  if (auth === 'checking') {
    return (
      <div class="signin-page">
        <div class="spinner" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (auth === 'signedOut') {
    return <SignInPage notice={signInNotice} onSignedIn={(user) => void enter(user)} />
  }

  const shareOnly = auth === 'share'

  return (
    <AppContext.Provider value={actions}>
      <div class="app">
        <nav class="tabstrip" role="tablist">
          {!shareOnly && (
            <button class={`tab${active === 'home' ? ' active' : ''}`} role="tab" aria-selected={active === 'home'} onClick={() => setActive('home')}>
              <House size={15} />
              <span class="title">Home</span>
            </button>
          )}
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
          {shareOnly && (
            <>
              <div class="spacer" />
              <button class="tab" onClick={() => setAuth('signedOut')} title="Sign in for the full web client">
                <LogIn size={15} />
                <span class="title">Sign in</span>
              </button>
            </>
          )}
        </nav>
        <div class="views">
          {!shareOnly && (
            <div class={`view${active === 'home' ? ' active' : ''}`}>
              <Home revision={revision} />
            </div>
          )}
          {shareOnly && tabs.length === 0 && (
            <div class="view active signin-page">
              <div class="card signin-card" style={{ textAlign: 'center' }}>
                <h2>Shared session ended</h2>
                <p class="muted">Open the share link again to reconnect, or sign in for the full web client.</p>
                <button class="btn primary" onClick={() => setAuth('signedOut')}>
                  <LogIn size={16} /> Sign in
                </button>
              </div>
            </div>
          )}
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
