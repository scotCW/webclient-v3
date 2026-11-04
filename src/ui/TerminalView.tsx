import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'preact/hooks'
import { RemoteTerminal } from '../core/terminal'
import { SessionTab, useApp } from './state'
import { SessionOverlay, useSession } from './useSession'

export function TerminalView(props: { tab: SessionTab; active: boolean }) {
  const app = useApp()
  const [attempt, setAttempt] = useState(0)
  const { session, phase, status, closedReason, loginUi } = useSession(props.tab, attempt)
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session || phase !== 'ready' || !host.current) return
    const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', convertEol: false })
    const fitAddon = new FitAddon()
    fit.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(host.current)
    fitAddon.fit()
    const remote = new RemoteTerminal(session)
    const offs = [
      remote.on('data', (d) => term.write(d)),
      remote.on('opened', (ok, msg) => {
        if (!ok) setError(msg || 'The remote side could not open a terminal')
        else remote.resize(term.rows, term.cols)
      }),
      remote.on('closed', (code) => term.write(`\r\n[process exited with code ${code}]\r\n`)),
      remote.on('error', setError),
    ]
    const onData = term.onData((d) => remote.write(d))
    const onResize = term.onResize(({ rows, cols }) => remote.resize(rows, cols))
    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(host.current)
    remote.open(term.rows, term.cols)
    term.focus()
    return () => {
      ro.disconnect()
      onData.dispose()
      onResize.dispose()
      offs.forEach((off) => off())
      remote.dispose()
      term.dispose()
      fit.current = null
    }
  }, [session, phase])

  useEffect(() => {
    if (props.active) setTimeout(() => fit.current?.fit(), 0)
  }, [props.active])

  return (
    <div class={`view terminal-view${props.active ? ' active' : ''}`}>
      {error && <div class="error-text" style={{ padding: 8, background: 'var(--panel)' }}>{error}</div>}
      <div ref={host} class="term" />
      <SessionOverlay phase={phase} status={status} closedReason={closedReason} onReconnect={() => setAttempt((a) => a + 1)} onClose={() => app.close(props.tab.key)} />
      {props.active && loginUi}
    </div>
  )
}
