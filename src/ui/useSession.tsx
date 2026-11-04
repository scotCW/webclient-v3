import { useEffect, useState } from 'preact/hooks'
import { accessToken } from '../api/client'
import { loadServerConfig } from '../core/config'
import { PeerSummary, Session } from '../core/session'
import { loadPrefs, rememberPeer } from '../store/prefs'
import { CodeDialog, PasswordDialog } from './components/Dialog'
import { SessionTab, useApp } from './state'

export type Phase = 'connecting' | 'password' | 'twoFactor' | 'ready' | 'closed'

/**
 * Create a session for a tab and track its login state. `attempt` changes
 * recreate it (reconnect).
 */
export function useSession(tab: SessionTab, attempt: number) {
  const app = useApp()
  const [session, setSession] = useState<Session | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [status, setStatus] = useState('Connecting…')
  const [wrong, setWrong] = useState(false)
  const [closedReason, setClosedReason] = useState('')
  const [peer, setPeer] = useState<PeerSummary | null>(null)

  useEffect(() => {
    const s = new Session(tab.peerId, tab.kind, loadServerConfig(), accessToken(), loadPrefs(), tab.preset ?? null)
    setSession(s)
    if (import.meta.env.DEV) (window as unknown as { __session: Session }).__session = s
    setPhase('connecting')
    setStatus('Connecting…')
    setClosedReason('')
    setPeer(null)
    const offs = [
      s.on('status', setStatus),
      s.on('password', (w) => {
        setWrong(w)
        setPhase('password')
      }),
      s.on('twoFactor', (w) => {
        setWrong(w)
        setPhase('twoFactor')
      }),
      s.on('ready', (pi) => {
        setPeer(pi)
        setPhase('ready')
        rememberPeer({ id: tab.peerId, hostname: pi.hostname, username: pi.username, platform: pi.platform })
        const name = pi.hostname || tab.peerId
        app.rename(tab.key, tab.kind === 'remote' ? name : `${name} (${tab.kind === 'file' ? 'files' : 'terminal'})`)
      }),
      s.on('peerInfo', setPeer),
      s.on('closed', (reason) => {
        setClosedReason(reason)
        setPhase('closed')
      }),
    ]
    void s.start()
    return () => {
      offs.forEach((off) => off())
      s.close()
    }
  }, [tab.key, attempt])

  const loginUi =
    session && phase === 'password' ? (
      <PasswordDialog
        peerId={tab.peerId}
        wrong={wrong}
        onSubmit={(pw, remember) => {
          setPhase('connecting')
          setStatus('Logging in…')
          void session.submitPassword(pw, remember)
        }}
        onCancel={() => app.close(tab.key)}
      />
    ) : session && phase === 'twoFactor' ? (
      <CodeDialog
        wrong={wrong}
        onSubmit={(code) => {
          setPhase('connecting')
          setStatus('Verifying…')
          session.submit2fa(code)
        }}
        onCancel={() => app.close(tab.key)}
      />
    ) : null

  return { session, phase, status, closedReason, peer, loginUi }
}

export function SessionOverlay(props: { phase: Phase; status: string; closedReason: string; onReconnect: () => void; onClose: () => void; dark?: boolean }) {
  if (props.phase === 'ready') return null
  if (props.phase === 'closed') {
    return (
      <div class="overlay" style={props.dark === false ? { color: 'var(--text)' } : undefined}>
        <div class="box">
          <h2 style={{ marginTop: 0 }}>Disconnected</h2>
          <p>{props.closedReason || 'The session ended.'}</p>
          <div class="row" style={{ justifyContent: 'center' }}>
            <button class="btn primary" onClick={props.onReconnect}>
              Reconnect
            </button>
            <button class="btn" onClick={props.onClose}>
              Close tab
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div class="overlay" style={props.dark === false ? { color: 'var(--text)' } : undefined}>
      <div class="box">
        <div class="spinner" />
        <p>{props.status}</p>
      </div>
    </div>
  )
}
