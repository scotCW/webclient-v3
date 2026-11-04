import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'

export function Dialog(props: { title: string; onClose?: () => void; wide?: boolean; children: ComponentChildren }) {
  useEffect(() => {
    if (!props.onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class={`dialog${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}

/** Password prompt shown when a peer asks for one. */
export function PasswordDialog(props: {
  peerId: string
  wrong: boolean
  onSubmit: (password: string, remember: boolean) => void
  onCancel: () => void
}) {
  return (
    <Dialog title="Password required" onClose={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = e.currentTarget as HTMLFormElement
          const pw = (f.elements.namedItem('pw') as HTMLInputElement).value
          const remember = (f.elements.namedItem('remember') as HTMLInputElement).checked
          if (pw) props.onSubmit(pw, remember)
        }}
      >
        <p class="muted" style={{ marginTop: 0 }}>
          Enter the password for <strong>{props.peerId}</strong>. If the remote side uses “click to accept”, you can also wait for them to
          accept.
        </p>
        {props.wrong && <p class="error-text">Wrong password, try again.</p>}
        <div class="field">
          <label for="pw">Password</label>
          <input id="pw" name="pw" type="password" autoFocus autoComplete="off" />
        </div>
        <label class="check">
          <input type="checkbox" name="remember" /> Remember on this browser
        </label>
        <div class="buttons">
          <button type="button" class="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" class="btn primary">
            Connect
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function CodeDialog(props: { wrong: boolean; onSubmit: (code: string) => void; onCancel: () => void }) {
  return (
    <Dialog title="Two-factor authentication" onClose={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const code = ((e.currentTarget as HTMLFormElement).elements.namedItem('code') as HTMLInputElement).value.trim()
          if (code) props.onSubmit(code)
        }}
      >
        <p class="muted" style={{ marginTop: 0 }}>
          The remote device requires a verification code from its authenticator app.
        </p>
        {props.wrong && <p class="error-text">Wrong code, try again.</p>}
        <div class="field">
          <label for="code">Code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus />
        </div>
        <div class="buttons">
          <button type="button" class="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" class="btn primary">
            Verify
          </button>
        </div>
      </form>
    </Dialog>
  )
}
