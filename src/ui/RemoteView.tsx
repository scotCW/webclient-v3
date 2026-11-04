import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Expand,
  Keyboard,
  Lock,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Shrink,
  Volume2,
  VolumeX,
  X,
} from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { MouseType, buttonBit, keyEventFor, modifiersOf } from '../core/input'
import type { DisplayInfo } from '../core/session'
import { Prefs, loadPrefs } from '../store/prefs'
import { SessionTab, useApp } from './state'
import { SessionOverlay, useSession } from './useSession'

interface Toast {
  id: number
  text: string
}

export function RemoteView(props: { tab: SessionTab; active: boolean }) {
  const app = useApp()
  const [attempt, setAttempt] = useState(0)
  const { session, phase, status, closedReason, peer, loginUi } = useSession(props.tab, attempt)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const prefs = useRef<Prefs>(loadPrefs())
  const [scale, setScale] = useState<Prefs['scale']>(prefs.current.scale)
  const [quality, setQuality] = useState<Prefs['imageQuality']>(prefs.current.imageQuality)
  const [codec, setCodec] = useState<Prefs['codec']>(prefs.current.codec)
  const [muted, setMuted] = useState(prefs.current.disableAudio)
  const [viewOnly, setViewOnly] = useState(prefs.current.viewOnly)
  const [showCursor, setShowCursor] = useState(prefs.current.showRemoteCursor)
  const [privacy, setPrivacy] = useState(false)
  const [display, setDisplay] = useState(0)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [cursor, setCursor] = useState('default')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [chat, setChat] = useState<{ me: boolean; text: string }[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [codecLabel, setCodecLabel] = useState('')
  const [fps, setFps] = useState(0)
  const wheelAcc = useRef({ x: 0, y: 0 })
  const buttons = useRef(0)

  const toast = (text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }

  // Session events specific to the remote view.
  useEffect(() => {
    if (!session) return
    let frames = 0
    const timer = setInterval(() => {
      setFps(frames)
      frames = 0
      setCodecLabel(session.codecInUse() ?? '')
    }, 1000)
    const offs = [
      session.on('frame', (idx, frame) => {
        const canvas = canvasRef.current
        if (!canvas || idx !== session.currentDisplay) {
          frame.close()
          return
        }
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
        }
        canvas.getContext('2d')?.drawImage(frame, 0, 0)
        frame.close()
        frames++
      }),
      session.on('cursor', setCursor),
      session.on('clipboard', (text) => {
        if (prefs.current.disableClipboard) return
        navigator.clipboard?.writeText(text).then(
          () => undefined,
          () => toast('Remote clipboard updated (click the page to allow clipboard access)'),
        )
      }),
      session.on('chat', (text) => {
        setChat((c) => [...c, { me: false, text }])
        setChatOpen(true)
      }),
      session.on('msgbox', (type, title, text) => {
        if (type === 'input-password') return
        toast([title, text].filter(Boolean).join(': ') || type)
      }),
      session.on('notice', toast),
      session.on('permission', (name, enabled) => toast(`Remote ${enabled ? 'allowed' : 'blocked'} ${name}`)),
      session.on('display', (idx, info) => {
        setDisplays((d) => {
          const copy = [...d]
          copy[idx] = info
          return copy
        })
        setDisplay(idx)
      }),
    ]
    return () => {
      clearInterval(timer)
      offs.forEach((off) => off())
    }
  }, [session])

  useEffect(() => {
    if (!peer) return
    setDisplays(peer.displays)
    setDisplay(peer.currentDisplay)
  }, [peer])

  useEffect(() => {
    if (phase === 'ready') {
      session?.resumeAudio()
      screenRef.current?.focus()
    }
  }, [phase])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ------------------------------------------------------------- input

  const remotePoint = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const info = displays[display]
    const w = info?.width || canvas.width
    const h = info?.height || canvas.height
    const x = ((e.clientX - rect.left) / rect.width) * w
    const y = ((e.clientY - rect.top) / rect.height) * h
    if (x < 0 || y < 0 || x > w || y > h) return null
    return { x: (info?.x ?? 0) + x, y: (info?.y ?? 0) + y }
  }

  const canInput = () => session && phase === 'ready' && !viewOnly

  const onPointerMove = (e: PointerEvent) => {
    if (!canInput()) return
    const p = remotePoint(e)
    if (p) session!.sendMouse(MouseType.Move, buttons.current, p.x, p.y, modifiersOf(e))
  }

  const onPointerDown = (e: PointerEvent) => {
    screenRef.current?.focus()
    session?.resumeAudio()
    if (!canInput()) return
    const p = remotePoint(e)
    if (!p) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const bit = buttonBit(e.button)
    buttons.current |= bit
    session!.sendMouse(MouseType.Down, bit, p.x, p.y, modifiersOf(e))
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!canInput()) return
    const p = remotePoint(e) ?? { x: 0, y: 0 }
    const bit = buttonBit(e.button)
    buttons.current &= ~bit
    session!.sendMouse(MouseType.Up, bit, p.x, p.y, modifiersOf(e))
  }

  const onWheel = (e: WheelEvent) => {
    if (!canInput()) return
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1
    wheelAcc.current.x += e.deltaX * unit
    wheelAcc.current.y += e.deltaY * unit
    const step = 100
    const ticks = (v: number) => (Math.abs(v) >= step ? Math.trunc(v / step) : 0)
    const tx = ticks(wheelAcc.current.x)
    const ty = ticks(wheelAcc.current.y)
    if (tx || ty) {
      wheelAcc.current.x -= tx * step
      wheelAcc.current.y -= ty * step
      // Scrolling down in the browser scrolls the remote page down: negative wheel steps.
      session!.sendWheel(-tx, -ty, modifiersOf(e))
    }
  }

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (!canInput()) return
    // Keep a few browser shortcuts working locally only with the toolbar's help.
    const ke = keyEventFor(e, down)
    if (!ke) return
    e.preventDefault()
    e.stopPropagation()
    if (down && (e.ctrlKey || e.metaKey) && e.code === 'KeyV' && !prefs.current.disableClipboard) {
      // Push the local clipboard first so the remote paste uses it.
      void navigator.clipboard?.readText().then(
        (text) => {
          if (text) session!.sendClipboard(text)
          session!.sendKey(ke)
        },
        () => session!.sendKey(ke),
      )
      return
    }
    session!.sendKey(ke)
  }

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        session?.sendClipboard(text)
        toast('Clipboard sent to the remote side')
      }
    } catch {
      toast('The browser blocked clipboard access')
    }
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void viewRef.current?.requestFullscreen().catch(() => toast('Full screen is not available'))
  }

  const ready = phase === 'ready'
  const isWindows = /windows/i.test(peer?.platform ?? '')
  const info = displays[display]
  const resolutions = info?.resolutions ?? []

  return (
    <div ref={viewRef} class={`view remote${props.active ? ' active' : ''}`}>
      <div class={`toolbar${collapsed ? ' collapsed' : ''}`}>
        {collapsed ? (
          <button title="Show toolbar" onClick={() => setCollapsed(false)}>
            <ChevronDown size={16} />
          </button>
        ) : (
          <>
            <span class="label">{peer?.hostname || props.tab.peerId}</span>
            {displays.length > 1 && (
              <select
                title="Display"
                value={display}
                onChange={(e) => {
                  const d = Number((e.currentTarget as HTMLSelectElement).value)
                  setDisplay(d)
                  session?.switchDisplay(d)
                }}
              >
                {displays.map((d, i) => (
                  <option key={i} value={i}>
                    Display {i + 1}
                    {d.name ? ` (${d.name})` : ''}
                  </option>
                ))}
              </select>
            )}
            <span class="sep" />
            <button title={scale === 'fit' ? 'Original size' : 'Fit to window'} onClick={() => setScale(scale === 'fit' ? 'original' : 'fit')} disabled={!ready}>
              {scale === 'fit' ? <Expand size={16} /> : <Shrink size={16} />}
            </button>
            <select
              title="Image quality"
              value={quality}
              disabled={!ready}
              onChange={(e) => {
                const q = (e.currentTarget as HTMLSelectElement).value as Prefs['imageQuality']
                setQuality(q)
                session?.setImageQuality(q)
              }}
            >
              <option value="best">Best quality</option>
              <option value="balanced">Balanced</option>
              <option value="low">Speed</option>
            </select>
            <select
              title="Codec"
              value={codec}
              disabled={!ready}
              onChange={(e) => {
                const c = (e.currentTarget as HTMLSelectElement).value as Prefs['codec']
                setCodec(c)
                void session?.setCodec(c)
              }}
            >
              <option value="auto">Auto{codecLabel ? ` (${codecLabel.toUpperCase()})` : ''}</option>
              <option value="vp9">VP9</option>
              <option value="av1">AV1</option>
              <option value="h264">H.264</option>
              <option value="h265">H.265</option>
              <option value="vp8">VP8</option>
            </select>
            <span class="sep" />
            <button title="Send Ctrl+Alt+Del" onClick={() => session?.ctrlAltDel()} disabled={!ready || viewOnly}>
              <Keyboard size={16} />
            </button>
            <button title="Lock remote screen" onClick={() => session?.lockScreen()} disabled={!ready || viewOnly}>
              <Lock size={16} />
            </button>
            <button title="Send local clipboard" onClick={() => void pasteClipboard()} disabled={!ready}>
              <ClipboardPaste size={16} />
            </button>
            <button
              title={muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                setMuted(!muted)
                session?.setOption('disable_audio', !muted)
              }}
              disabled={!ready}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <button title="Chat" class={chatOpen ? 'on' : ''} onClick={() => setChatOpen(!chatOpen)} disabled={!ready}>
              <MessageSquare size={16} />
            </button>
            <button title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
              {fullscreen ? <Shrink size={16} /> : <Expand size={16} />}
            </button>
            <div style={{ position: 'relative' }}>
              <button title="More" class={menuOpen ? 'on' : ''} onClick={() => setMenuOpen(!menuOpen)}>
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div class="menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button
                    onClick={() => {
                      session?.refreshVideo()
                      setMenuOpen(false)
                    }}
                  >
                    <RefreshCw size={16} /> Refresh video
                  </button>
                  <button
                    onClick={() => {
                      setViewOnly(!viewOnly)
                      session?.setOption('disable_keyboard', !viewOnly)
                    }}
                  >
                    {viewOnly ? '✓ ' : ''}View only
                  </button>
                  <button
                    onClick={() => {
                      setShowCursor(!showCursor)
                      session?.setOption('show_remote_cursor', !showCursor)
                    }}
                  >
                    {showCursor ? '✓ ' : ''}Show remote cursor
                  </button>
                  {peer?.features.privacyMode && (
                    <button
                      onClick={() => {
                        setPrivacy(!privacy)
                        session?.togglePrivacyMode(!privacy)
                      }}
                    >
                      {privacy ? '✓ ' : ''}Privacy mode
                    </button>
                  )}
                  <div class="menu-label">FPS limit</div>
                  {[15, 30, 60].map((n) => (
                    <button key={n} onClick={() => session?.setCustomFps(n)}>
                      {n} fps
                    </button>
                  ))}
                  {resolutions.length > 0 && (
                    <>
                      <div class="menu-label">Resolution</div>
                      {resolutions.slice(0, 8).map((r) => (
                        <button key={`${r.width}x${r.height}`} onClick={() => session?.changeResolution(r.width, r.height)}>
                          {r.width} × {r.height}
                        </button>
                      ))}
                    </>
                  )}
                  {peer && peer.windowsSessions.length > 1 && (
                    <>
                      <div class="menu-label">Windows session</div>
                      {peer.windowsSessions.map((s) => (
                        <button key={s.sid} onClick={() => session?.selectWindowsSession(s.sid)}>
                          {s.name || `Session ${s.sid}`}
                        </button>
                      ))}
                    </>
                  )}
                  <div class="menu-label">Remote device</div>
                  {isWindows && <button onClick={() => session?.elevate()}>Request elevation</button>}
                  <button
                    onClick={() => {
                      if (confirm('Restart the remote device?')) session?.restartRemote()
                    }}
                  >
                    Restart remote device
                  </button>
                  <div class="menu-label">
                    {codecLabel ? `${codecLabel.toUpperCase()} · ` : ''}
                    {fps} fps · {session?.secure ? 'encrypted' : 'not encrypted'}
                  </div>
                </div>
              )}
            </div>
            <button title="Hide toolbar" onClick={() => setCollapsed(true)}>
              <ChevronUp size={16} />
            </button>
            <button title="Disconnect" onClick={() => app.close(props.tab.key)}>
              <X size={16} />
            </button>
          </>
        )}
      </div>

      <div
        ref={screenRef}
        class={`screen${scale === 'fit' ? ' fit' : ''}`}
        tabIndex={0}
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={0}
          height={0}
          style={{ cursor: ready && !viewOnly ? cursor : 'default', visibility: ready ? 'visible' : 'hidden' }}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        />
        <SessionOverlay
          phase={phase}
          status={status}
          closedReason={closedReason}
          onReconnect={() => setAttempt((a) => a + 1)}
          onClose={() => app.close(props.tab.key)}
        />
      </div>

      {chatOpen && ready && (
        <div class="chat">
          <div class="row" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <strong>Chat</strong>
            <div class="spacer" />
            <button class="btn icon" style={{ border: 'none' }} onClick={() => setChatOpen(false)} title="Close chat">
              <X size={14} />
            </button>
          </div>
          <div class="log">
            {chat.map((m, i) => (
              <div key={i} class={`msg${m.me ? ' me' : ''}`}>
                {m.text}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const input = (e.currentTarget as HTMLFormElement).elements.namedItem('msg') as HTMLInputElement
              const text = input.value.trim()
              if (!text) return
              session?.sendChat(text)
              setChat((c) => [...c, { me: true, text }])
              input.value = ''
            }}
          >
            <input name="msg" placeholder="Message" autoComplete="off" onKeyDown={(e) => e.stopPropagation()} />
            <button class="btn primary small" type="submit">
              Send
            </button>
          </form>
        </div>
      )}

      <div class="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} class="toast">
            {t.text}
          </div>
        ))}
      </div>
      {props.active && loginUi}
    </div>
  )
}
