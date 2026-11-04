import { useEffect, useRef, useState } from 'preact/hooks'
import { ApiError, login, loginOptions, oidcPoll, oidcStart } from '../api/client'
import { Dialog } from './components/Dialog'

export function AccountDialog(props: { onClose: () => void; onSignedIn: () => void }) {
  const [providers, setProviders] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const polling = useRef(false)

  useEffect(() => {
    void loginOptions().then((ops) =>
      setProviders(ops.filter((o) => o.startsWith('oidc/')).map((o) => o.slice(5))),
    )
    return () => {
      polling.current = false
    }
  }, [])

  const submit = async (e: Event) => {
    e.preventDefault()
    const f = e.currentTarget as HTMLFormElement
    const username = (f.elements.namedItem('username') as HTMLInputElement).value.trim()
    const password = (f.elements.namedItem('password') as HTMLInputElement).value
    if (!username || !password) return
    setBusy(true)
    setError('')
    try {
      await login(username, password)
      props.onSignedIn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const signInWith = async (op: string) => {
    setError('')
    try {
      const { url, code } = await oidcStart(op)
      const popup = window.open(url, '_blank', 'popup,width=520,height=680')
      polling.current = true
      setBusy(true)
      const started = Date.now()
      while (polling.current && Date.now() - started < 5 * 60_000) {
        await new Promise((r) => setTimeout(r, 1500))
        const user = await oidcPoll(code)
        if (user) {
          popup?.close()
          props.onSignedIn()
          return
        }
      }
      if (polling.current) setError('Sign-in timed out')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Sign in" onClose={props.onClose}>
      <p class="muted" style={{ marginTop: 0 }}>
        Sign in to your account on this server to see your address book and devices.
      </p>
      <form onSubmit={submit}>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" autoComplete="username" autoFocus />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" />
        </div>
        {error && <p class="error-text">{error}</p>}
        <div class="buttons">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={busy}>
            Sign in
          </button>
        </div>
      </form>
      {providers.length > 0 && (
        <>
          <p class="muted" style={{ textAlign: 'center', margin: '16px 0 8px' }}>
            or continue with
          </p>
          <div class="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            {providers.map((p) => (
              <button key={p} class="btn" disabled={busy} onClick={() => void signInWith(p)}>
                {p}
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  )
}
