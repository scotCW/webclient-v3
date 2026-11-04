import { useState } from 'preact/hooks'
import { ServerConfig, loadManagedServer, loadServerConfig, loadServerOverrides, saveServerOverrides } from '../core/config'
import { Prefs, loadPrefs, savePrefs } from '../store/prefs'
import { Dialog } from './components/Dialog'

export function applyTheme(theme: Prefs['theme']) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function SettingsDialog(props: { onClose: () => void }) {
  const defaults = loadServerConfig()
  const managed = loadManagedServer()
  const [server, setServer] = useState<Partial<ServerConfig>>(loadServerOverrides())
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs())

  const serverField = (key: keyof ServerConfig, label: string, hint: string) => (
    <div class="field">
      <label for={`srv-${key}`}>{label}</label>
      <input
        id={`srv-${key}`}
        value={server[key] ?? ''}
        placeholder={defaults[key] || hint}
        onInput={(e) => setServer({ ...server, [key]: (e.currentTarget as HTMLInputElement).value.trim() })}
      />
    </div>
  )

  const save = () => {
    saveServerOverrides(server)
    savePrefs(prefs)
    applyTheme(prefs.theme)
    props.onClose()
  }

  const bool = (key: keyof Prefs, label: string) => (
    <label class="check">
      <input type="checkbox" checked={!!prefs[key]} onChange={(e) => setPrefs({ ...prefs, [key]: (e.currentTarget as HTMLInputElement).checked })} />
      {label}
    </label>
  )

  return (
    <Dialog title="Settings" onClose={props.onClose} wide>
      <h3 class="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>
        Server
      </h3>
      {managed ? (
        <>
          <p class="muted" style={{ marginTop: 0 }}>
            Provided by your account server.
          </p>
          <dl class="kv" style={{ marginBottom: 12 }}>
            <dt>ID server</dt>
            <dd>{managed.idServer}</dd>
            <dt>Relay server</dt>
            <dd>{managed.relayServer || 'named by the ID server'}</dd>
            <dt>Key</dt>
            <dd>{managed.key ? 'configured' : 'none'}</dd>
            <dt>API server</dt>
            <dd>{defaults.apiServer}</dd>
          </dl>
        </>
      ) : (
        <>
          <p class="muted" style={{ marginTop: 0 }}>
            Leave a field empty to use the value provided by this site.
          </p>
          {serverField('idServer', 'ID server', 'host or host:port')}
          {serverField('relayServer', 'Relay server', 'optional, the ID server names one')}
          {serverField('key', 'Key', 'server public key (base64)')}
          {serverField('apiServer', 'API server', 'https://…')}
        </>
      )}

      <h3 class="muted" style={{ fontSize: 12, textTransform: 'uppercase', marginTop: 18 }}>
        Defaults for new sessions
      </h3>
      <div class="field">
        <label for="my-name">Name shown to the remote side</label>
        <input id="my-name" value={prefs.myName} onInput={(e) => setPrefs({ ...prefs, myName: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div class="field" style={{ flex: 1 }}>
          <label for="quality">Image quality</label>
          <select id="quality" value={prefs.imageQuality} onChange={(e) => setPrefs({ ...prefs, imageQuality: (e.currentTarget as HTMLSelectElement).value as Prefs['imageQuality'] })}>
            <option value="best">Best</option>
            <option value="balanced">Balanced</option>
            <option value="low">Optimize for speed</option>
          </select>
        </div>
        <div class="field" style={{ flex: 1 }}>
          <label for="codec">Preferred codec</label>
          <select id="codec" value={prefs.codec} onChange={(e) => setPrefs({ ...prefs, codec: (e.currentTarget as HTMLSelectElement).value as Prefs['codec'] })}>
            <option value="auto">Auto</option>
            <option value="vp9">VP9</option>
            <option value="av1">AV1</option>
            <option value="h264">H.264</option>
            <option value="h265">H.265</option>
            <option value="vp8">VP8</option>
          </select>
        </div>
        <div class="field" style={{ flex: 1 }}>
          <label for="theme">Theme</label>
          <select id="theme" value={prefs.theme} onChange={(e) => setPrefs({ ...prefs, theme: (e.currentTarget as HTMLSelectElement).value as Prefs['theme'] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>
      {bool('disableAudio', 'Mute audio')}
      {bool('disableClipboard', 'Disable clipboard sync')}
      {bool('showRemoteCursor', 'Show remote cursor')}
      {bool('viewOnly', 'View only (no keyboard or mouse)')}
      {bool('lockAfterSessionEnd', 'Lock the remote screen when the session ends')}

      <div class="buttons">
        <button class="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button class="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  )
}
