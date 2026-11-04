import { useEffect, useRef, useState } from 'preact/hooks'
import { ApiError, ApiUser, login, loginOptions, oidcPoll, oidcStart } from '../api/client'

/** Username/password and OIDC sign-in against the account server. */
export function SignInForm(props: { onSignedIn: (user: ApiUser) => void; onCancel?: () => void }) {
  const [providers, setProviders] = useState<string[]>([])
  const [passwordLogin, setPasswordLogin] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const polling = useRef(false)

  useEffect(() => {
    void loginOptions().then((ops) => {
      setProviders(ops.filter((o) => o.startsWith('oidc/')).map((o) => o.slice(5)))
    })
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
      props.onSignedIn(await login(username, password))
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Sign-in failed'
      // The server refuses password logins when only single sign-on is allowed.
      if (/password login/i.test(msg)) setPasswordLogin(false)
      setError(msg)
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
          props.onSignedIn(user)
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
    <>
      {passwordLogin && (
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
            {props.onCancel && (
              <button type="button" class="btn" onClick={props.onCancel}>
                Cancel
              </button>
            )}
            <button type="submit" class="btn primary" disabled={busy}>
              Sign in
            </button>
          </div>
        </form>
      )}
      {!passwordLogin && error && <p class="error-text">{error}</p>}
      {providers.length > 0 && (
        <>
          <p class="muted" style={{ textAlign: 'center', margin: '16px 0 8px' }}>
            {passwordLogin ? 'or continue with' : 'Continue with'}
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
    </>
  )
}

/** Shown instead of the app until the visitor signs in. */
export function SignInPage(props: { onSignedIn: (user: ApiUser) => void; notice?: string }) {
  return (
    <div class="signin-page">
      <div class="card signin-card">
        <div class="row" style={{ gap: 10, marginBottom: 6 }}>
          <img src="./favicon.svg" width={32} height={32} alt="" />
          <h2 style={{ margin: 0 }}>Remote Desktop Web Client</h2>
        </div>
        <p class="muted" style={{ marginTop: 6 }}>
          Sign in with your account on this server to continue.
        </p>
        {props.notice && <p class="error-text">{props.notice}</p>}
        <SignInForm onSignedIn={props.onSignedIn} />
      </div>
    </div>
  )
}
