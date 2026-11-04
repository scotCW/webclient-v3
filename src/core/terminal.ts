// Remote shell over a terminal session.
import { decompress } from 'fzstd'
import type { Msg } from './proto'
import type { Session } from './session'
import { Emitter, utf8 } from './util'

type Events = {
  opened: [ok: boolean, message: string]
  data: [Uint8Array]
  closed: [exitCode: number]
  error: [string]
}

export class RemoteTerminal extends Emitter<Events> {
  private readonly terminalId = 0
  private unsubscribe: () => void
  opened = false

  constructor(private session: Session) {
    super()
    this.unsubscribe = session.on('terminal', (tr) => this.onResponse(tr))
  }

  open(rows: number, cols: number) {
    this.session.terminalAction({ open: { terminal_id: this.terminalId, rows, cols } })
  }

  write(text: string) {
    this.session.terminalAction({ data: { terminal_id: this.terminalId, data: utf8(text), compressed: false } })
  }

  resize(rows: number, cols: number) {
    if (this.opened) this.session.terminalAction({ resize: { terminal_id: this.terminalId, rows, cols } })
  }

  close() {
    this.session.terminalAction({ close: { terminal_id: this.terminalId } })
  }

  dispose() {
    this.unsubscribe()
  }

  private onResponse(tr: Msg) {
    const r = tr[tr.union]
    if (r && (r.terminal_id ?? 0) !== this.terminalId) return
    switch (tr.union) {
      case 'opened':
        this.opened = !!r.success
        this.emit('opened', !!r.success, r.message ?? '')
        break
      case 'data': {
        let data: Uint8Array = r.data ?? new Uint8Array()
        if (r.compressed && data.length) {
          try {
            data = decompress(data)
          } catch {
            return
          }
        }
        this.emit('data', data)
        break
      }
      case 'closed':
        this.opened = false
        this.emit('closed', r.exit_code ?? 0)
        break
      case 'error':
        this.emit('error', r.message ?? 'Terminal error')
        break
    }
  }
}
