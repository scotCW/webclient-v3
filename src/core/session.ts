// One connection to a peer: login, then the running session.
import { decompress } from 'fzstd'
import { AudioPlayer } from './audio'
import { CLIENT_VERSION, ServerConfig } from './config'
import { ConnectError, connectToPeer } from './connect'
import { cursorFromData } from './cursor'
import { MouseType, controlKeyEvent, mouseMask } from './input'
import { BoolOption, ClipboardFormat, ConnType, ImageQuality, Msg, PreferCodec, decodeMessage, encodeMessage } from './proto'
import type { Transport } from './transport'
import { Emitter, fromBase64, fromUtf8, sha256, toBase64, utf8 } from './util'
import { CodecName, VideoStream, probeCodecs } from './video'
import { Prefs, myId, savedPassword, setSavedPassword } from '../store/prefs'

export type SessionKind = 'remote' | 'file' | 'terminal'

export interface DisplayInfo {
  x: number
  y: number
  width: number
  height: number
  name: string
  cursorEmbedded: boolean
  scale: number
  resolutions: { width: number; height: number }[]
  originalResolution?: { width: number; height: number }
}

export interface PeerSummary {
  username: string
  hostname: string
  platform: string
  version: string
  displays: DisplayInfo[]
  currentDisplay: number
  sasEnabled: boolean
  features: { privacyMode: boolean; terminal: boolean }
  encoding: Record<string, boolean>
  windowsSessions: { sid: number; name: string }[]
}

type Events = {
  status: [string]
  password: [wrong: boolean]
  twoFactor: [wrong: boolean]
  ready: [PeerSummary]
  peerInfo: [PeerSummary]
  display: [number, DisplayInfo]
  frame: [number, VideoFrame]
  cursor: [string]
  clipboard: [string]
  chat: [string]
  msgbox: [type: string, title: string, text: string]
  permission: [name: string, enabled: boolean]
  notice: [string]
  file: [Msg]
  fileAction: [Msg]
  terminal: [Msg]
  closed: [string]
}

const PERMISSION_NAMES: Record<number, string> = {
  0: 'keyboard',
  2: 'clipboard',
  3: 'audio',
  4: 'file',
  5: 'restart',
  6: 'recording',
  7: 'blockInput',
  8: 'privacyMode',
}

const QUALITY: Record<string, number> = { best: ImageQuality.Best, balanced: ImageQuality.Balanced, low: ImageQuality.Low }
const PREFER: Record<string, number> = {
  auto: PreferCodec.Auto,
  vp9: PreferCodec.VP9,
  vp8: PreferCodec.VP8,
  av1: PreferCodec.AV1,
  h264: PreferCodec.H264,
  h265: PreferCodec.H265,
}

const yesNo = (on: boolean) => (on ? BoolOption.Yes : BoolOption.No)

export class Session extends Emitter<Events> {
  private transport: Transport | null = null
  private salt = ''
  private challenge = ''
  /** salted password hash being tried, and whether to remember it on success */
  private pending: { hash: Uint8Array; remember: boolean; fromStore: boolean } | null = null
  private loggedIn = false
  private closed = false
  private streams = new Map<number, VideoStream>()
  private cursors = new Map<number, string>()
  private audio = new AudioPlayer()
  peer: PeerSummary | null = null
  currentDisplay = 0
  secure = false
  permissions: Record<string, boolean> = { keyboard: true, clipboard: true, audio: true, file: true, restart: true }

  constructor(
    readonly peerId: string,
    readonly kind: SessionKind,
    private server: ServerConfig,
    private token: string,
    private prefs: Prefs,
    /** password from a share link or the address book: a base64 salted hash, or plain text */
    private preset: { hash?: string; plain?: string } | null = null,
  ) {
    super()
    this.audio.muted = prefs.disableAudio
  }

  async start() {
    const connType = this.kind === 'file' ? ConnType.FILE_TRANSFER : this.kind === 'terminal' ? ConnType.TERMINAL : ConnType.DEFAULT
    try {
      const link = await connectToPeer(this.server, this.peerId, connType, this.token, (s) => this.emit('status', s))
      if (this.closed) {
        link.transport.close()
        return
      }
      this.transport = link.transport
      this.secure = link.secure
      this.transport.onClose = (err) => this.finish(this.loggedIn ? 'Connection closed' : err.message)
      this.transport.onMessage = (bytes) => this.handle(bytes)
      this.emit('status', 'Waiting for the remote side…')
    } catch (e) {
      this.finish(e instanceof ConnectError || e instanceof Error ? e.message : String(e))
    }
  }

  // ------------------------------------------------------------- login

  async submitPassword(password: string, remember: boolean) {
    const hash = await sha256(utf8(password), utf8(this.salt))
    this.pending = { hash, remember, fromStore: false }
    await this.sendLogin(hash)
  }

  submit2fa(code: string) {
    this.send({ auth_2fa: { code } })
  }

  private async onHash(h: Msg) {
    this.salt = h.salt ?? ''
    this.challenge = h.challenge ?? ''
    const stored = savedPassword(this.peerId) ?? this.preset?.hash ?? null
    if (stored) {
      const hash = fromBase64(stored)
      this.pending = { hash, remember: false, fromStore: true }
      await this.sendLogin(hash)
      return
    }
    if (this.preset?.plain) {
      const hash = await sha256(utf8(this.preset.plain), utf8(this.salt))
      this.pending = { hash, remember: false, fromStore: false }
      this.preset = null
      await this.sendLogin(hash)
      return
    }
    // No password yet: log in empty so a "click to accept" peer can approve,
    // and ask the user in the meantime.
    this.emit('password', false)
    await this.sendLogin(null)
  }

  private async sendLogin(hash: Uint8Array | null) {
    const password = hash ? await sha256(hash, utf8(this.challenge)) : new Uint8Array()
    const login: Msg = {
      username: this.peerId,
      password,
      my_id: myId(),
      my_name: this.prefs.myName || 'Web client',
      option: await this.optionMessage(),
      video_ack_required: false,
      session_id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      version: CLIENT_VERSION,
      my_platform: 'Web',
    }
    if (this.kind === 'file') login.file_transfer = { dir: '', show_hidden: false }
    if (this.kind === 'terminal') login.terminal = { service_id: '' }
    this.send({ login_request: login })
  }

  private onLoginResponse(lr: Msg) {
    if (lr.union === 'error') {
      const err: string = lr.error
      if (err === 'Wrong Password') {
        if (this.pending?.fromStore) setSavedPassword(this.peerId, null)
        this.pending = null
        this.emit('password', true)
      } else if (err === 'Empty Password') {
        this.emit('password', false)
      } else if (err === '2FA Required') {
        this.emit('twoFactor', false)
      } else if (err === 'Wrong 2FA Code') {
        this.emit('twoFactor', true)
      } else {
        this.finish(err)
      }
      return
    }
    if (lr.union === 'peer_info') {
      this.loggedIn = true
      if (this.pending?.remember) setSavedPassword(this.peerId, toBase64(this.pending.hash))
      this.pending = null
      this.peer = summarize(lr.peer_info)
      this.currentDisplay = this.peer.currentDisplay
      this.emit('ready', this.peer)
    }
  }

  private async optionMessage(): Promise<Msg> {
    const support = await probeCodecs()
    const ability = (c: CodecName) => (support[c] ? 1 : 0)
    return {
      image_quality: QUALITY[this.prefs.imageQuality] ?? ImageQuality.Balanced,
      show_remote_cursor: yesNo(this.prefs.showRemoteCursor),
      disable_audio: yesNo(this.prefs.disableAudio),
      disable_clipboard: yesNo(this.prefs.disableClipboard),
      disable_keyboard: yesNo(this.prefs.viewOnly),
      lock_after_session_end: yesNo(this.prefs.lockAfterSessionEnd),
      supported_decoding: {
        ability_vp9: ability('vp9'),
        ability_vp8: ability('vp8'),
        ability_av1: ability('av1'),
        ability_h264: ability('h264'),
        ability_h265: ability('h265'),
        prefer: PREFER[this.prefs.codec] ?? PreferCodec.Auto,
      },
    }
  }

  // ----------------------------------------------------------- incoming

  private handle(bytes: Uint8Array) {
    let msg: Msg
    try {
      msg = decodeMessage(bytes)
    } catch {
      return
    }
    switch (msg.union) {
      case 'hash':
        void this.onHash(msg.hash)
        break
      case 'login_response':
        this.onLoginResponse(msg.login_response)
        break
      case 'test_delay':
        if (!msg.test_delay.from_client) this.send({ test_delay: msg.test_delay })
        break
      case 'video_frame':
        void this.stream(msg.video_frame.display ?? 0).push(msg.video_frame)
        break
      case 'audio_frame':
        this.audio.push(msg.audio_frame.data ?? new Uint8Array())
        break
      case 'cursor_data': {
        const shape = cursorFromData(msg.cursor_data)
        if (shape) {
          this.cursors.set(Number(msg.cursor_data.id ?? 0), shape.css)
          this.emit('cursor', shape.css)
        }
        break
      }
      case 'cursor_id': {
        const css = this.cursors.get(Number(msg.cursor_id))
        if (css) this.emit('cursor', css)
        break
      }
      case 'clipboard':
        this.onClipboard(msg.clipboard)
        break
      case 'multi_clipboards':
        for (const c of msg.multi_clipboards.clipboards ?? []) this.onClipboard(c)
        break
      case 'misc':
        this.onMisc(msg.misc)
        break
      case 'message_box': {
        const mb = msg.message_box
        this.emit('msgbox', mb.msgtype ?? 'info', mb.title ?? '', mb.text ?? '')
        break
      }
      case 'peer_info':
        this.peer = summarize(msg.peer_info)
        this.emit('peerInfo', this.peer)
        break
      case 'file_response':
        this.emit('file', msg.file_response)
        break
      case 'file_action':
        this.emit('fileAction', msg.file_action)
        break
      case 'terminal_response':
        this.emit('terminal', msg.terminal_response)
        break
    }
  }

  private onClipboard(cb: Msg) {
    if ((cb.format ?? ClipboardFormat.Text) !== ClipboardFormat.Text) return
    let content: Uint8Array = cb.content ?? new Uint8Array()
    if (cb.compress) {
      try {
        content = decompress(content)
      } catch {
        return
      }
    }
    this.emit('clipboard', fromUtf8(content))
  }

  private onMisc(misc: Msg) {
    switch (misc.union) {
      case 'audio_format':
        this.audio.setFormat(misc.audio_format.sample_rate, misc.audio_format.channels)
        break
      case 'switch_display': {
        const sd = misc.switch_display
        const idx = sd.display ?? 0
        const info: DisplayInfo = {
          ...(this.peer?.displays[idx] ?? emptyDisplay()),
          x: sd.x ?? 0,
          y: sd.y ?? 0,
          width: sd.width ?? 0,
          height: sd.height ?? 0,
          cursorEmbedded: !!sd.cursor_embedded,
          resolutions: (sd.resolutions?.resolutions ?? []).map(res),
          originalResolution: sd.original_resolution ? res(sd.original_resolution) : undefined,
        }
        if (this.peer) this.peer.displays[idx] = info
        this.currentDisplay = idx
        this.emit('display', idx, info)
        break
      }
      case 'chat_message':
        this.emit('chat', misc.chat_message.text ?? '')
        break
      case 'permission_info': {
        const name = PERMISSION_NAMES[misc.permission_info.permission ?? 0] ?? 'unknown'
        this.permissions[name] = !!misc.permission_info.enabled
        this.emit('permission', name, !!misc.permission_info.enabled)
        break
      }
      case 'close_reason':
        this.finish(misc.close_reason || 'Closed by the remote side')
        break
      case 'back_notification': {
        const bn = misc.back_notification
        this.emit('notice', bn.details || (bn.union === 'privacy_mode_state' ? 'Privacy mode changed' : 'Input blocking changed'))
        break
      }
      case 'uac':
        if (misc.uac) this.emit('notice', 'The remote side is showing an administrator (UAC) prompt')
        break
      case 'elevation_response':
        if (misc.elevation_response) this.emit('msgbox', 'error', 'Elevation failed', misc.elevation_response)
        break
    }
  }

  private stream(display: number): VideoStream {
    let s = this.streams.get(display)
    if (!s) {
      s = new VideoStream(
        (frame) => this.emit('frame', display, frame),
        () => this.refreshVideo(display),
      )
      this.streams.set(display, s)
    }
    return s
  }

  codecInUse(): CodecName | null {
    return this.streams.get(this.currentDisplay)?.current ?? null
  }

  // ------------------------------------------------------------ outgoing

  send(msg: Msg) {
    if (!this.transport || this.closed) return
    try {
      this.transport.send(encodeMessage(msg))
    } catch {
      /* closed underneath us */
    }
  }

  private misc(misc: Msg) {
    this.send({ misc })
  }

  sendMouse(type: number, buttons: number, x: number, y: number, modifiers: number[] = []) {
    this.send({ mouse_event: { mask: mouseMask(type, buttons), x: Math.round(x), y: Math.round(y), modifiers } })
  }

  sendWheel(dx: number, dy: number, modifiers: number[] = []) {
    this.send({ mouse_event: { mask: mouseMask(MouseType.Wheel), x: Math.round(dx), y: Math.round(dy), modifiers } })
  }

  sendKey(keyEvent: Msg) {
    this.send({ key_event: keyEvent })
  }

  ctrlAltDel() {
    this.sendKey(controlKeyEvent('CtrlAltDel'))
  }

  lockScreen() {
    this.sendKey(controlKeyEvent('LockScreen'))
  }

  refreshVideo(display = this.currentDisplay) {
    this.misc({ refresh_video_display: display })
    this.misc({ refresh_video: true })
  }

  switchDisplay(display: number) {
    this.misc({ capture_displays: { set: [display] } })
    this.misc({ switch_display: { display } })
    this.currentDisplay = display
  }

  setImageQuality(q: Prefs['imageQuality']) {
    this.prefs.imageQuality = q
    this.misc({ option: { image_quality: QUALITY[q] } })
  }

  setCustomFps(fps: number) {
    this.misc({ option: { custom_fps: fps } })
  }

  async setCodec(codec: Prefs['codec']) {
    this.prefs.codec = codec
    const opt = await this.optionMessage()
    this.misc({ option: { supported_decoding: opt.supported_decoding } })
  }

  setOption(name: 'show_remote_cursor' | 'disable_audio' | 'disable_clipboard' | 'disable_keyboard' | 'lock_after_session_end' | 'privacy_mode' | 'block_input', on: boolean) {
    if (name === 'disable_audio') this.audio.muted = on
    this.misc({ option: { [name]: yesNo(on) } })
  }

  sendClipboard(text: string) {
    this.send({ clipboard: { compress: false, content: utf8(text), format: ClipboardFormat.Text } })
  }

  sendChat(text: string) {
    this.misc({ chat_message: { text } })
  }

  changeResolution(width: number, height: number) {
    this.misc({ change_display_resolution: { display: this.currentDisplay, resolution: { width, height } } })
  }

  restartRemote() {
    this.misc({ restart_remote_device: true })
  }

  elevate() {
    this.misc({ elevation_request: { direct: true } })
  }

  togglePrivacyMode(on: boolean) {
    this.misc({ toggle_privacy_mode: { impl_key: '', on } })
  }

  toggleVirtualDisplay(display: number, on: boolean) {
    this.misc({ toggle_virtual_display: { display, on } })
  }

  selectWindowsSession(sid: number) {
    this.misc({ selected_sid: sid })
  }

  onFileAction(fn: (fa: Msg) => void) {
    return this.on('fileAction', fn)
  }

  fileAction(action: Msg) {
    this.send({ file_action: action })
  }

  terminalAction(action: Msg) {
    this.send({ terminal_action: action })
  }

  resumeAudio() {
    this.audio.resume()
  }

  close() {
    this.finish('')
  }

  private finish(reason: string) {
    if (this.closed) return
    this.closed = true
    for (const s of this.streams.values()) s.close()
    this.streams.clear()
    this.audio.close()
    const t = this.transport
    this.transport = null
    if (t) {
      t.onClose = null
      t.onMessage = null
      t.close()
    }
    this.emit('closed', reason)
  }

  get isClosed() {
    return this.closed
  }
}

function res(r: Msg) {
  return { width: r.width ?? 0, height: r.height ?? 0 }
}

function emptyDisplay(): DisplayInfo {
  return { x: 0, y: 0, width: 0, height: 0, name: '', cursorEmbedded: false, scale: 1, resolutions: [] }
}

function summarize(pi: Msg): PeerSummary {
  const resolutions = (pi.resolutions?.resolutions ?? []).map(res)
  return {
    username: pi.username ?? '',
    hostname: pi.hostname ?? '',
    platform: pi.platform ?? '',
    version: pi.version ?? '',
    displays: (pi.displays ?? []).map((d: Msg) => ({
      x: d.x ?? 0,
      y: d.y ?? 0,
      width: d.width ?? 0,
      height: d.height ?? 0,
      name: d.name ?? '',
      cursorEmbedded: !!d.cursor_embedded,
      scale: d.scale ?? 1,
      resolutions,
      originalResolution: d.original_resolution ? res(d.original_resolution) : undefined,
    })),
    currentDisplay: pi.current_display ?? 0,
    sasEnabled: !!pi.sas_enabled,
    features: { privacyMode: !!pi.features?.privacy_mode, terminal: !!pi.features?.terminal },
    encoding: {
      h264: !!pi.encoding?.h264,
      h265: !!pi.encoding?.h265,
      vp8: !!pi.encoding?.vp8,
      av1: !!pi.encoding?.av1,
      vp9: true,
    },
    windowsSessions: (pi.windows_sessions?.sessions ?? []).map((s: Msg) => ({ sid: s.sid ?? 0, name: s.name ?? '' })),
  }
}
