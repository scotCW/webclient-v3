import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { keyEventFor, mouseMask, MouseButton, MouseType } from '../src/core/input'
import { ControlKey, decodeMessage, decodeRendezvous, encodeMessage, encodeRendezvous } from '../src/core/proto'
import { nonceFor } from '../src/core/transport'
import { presetFrom } from '../src/ui/state'

const key = (init: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: '', code: '', ...init }) as KeyboardEvent

describe('wire format', () => {
  it('puts punch_hole_request in RendezvousMessage field 8', () => {
    const bytes = encodeRendezvous({ punch_hole_request: { id: '123456789', licence_key: 'k', conn_type: 1, nat_type: 2 } })
    expect(bytes[0]).toBe((8 << 3) | 2)
    const back = decodeRendezvous(bytes)
    expect(back.union).toBe('punch_hole_request')
    expect(back.punch_hole_request).toMatchObject({ id: '123456789', licence_key: 'k', conn_type: 1, nat_type: 2 })
  })

  it('puts login_request in Message field 7 and keeps bytes intact', () => {
    const password = new Uint8Array([1, 2, 3, 250])
    const bytes = encodeMessage({ login_request: { username: 'peer', password, my_platform: 'Web', file_transfer: { dir: '/tmp' } } })
    expect(bytes[0]).toBe((7 << 3) | 2)
    const back = decodeMessage(bytes)
    expect(back.login_request.union).toBe('file_transfer')
    expect(Array.from(back.login_request.password)).toEqual([1, 2, 3, 250])
  })

  it('decodes a VP9 video frame union', () => {
    const bytes = encodeMessage({ video_frame: { vp9s: { frames: [{ data: new Uint8Array([9]), key: true, pts: 42 }] }, display: 1 } })
    const back = decodeMessage(bytes).video_frame
    expect(back.union).toBe('vp9s')
    expect(back.display).toBe(1)
    expect(back.vp9s.frames[0].pts).toBe(42)
  })

  it('uses the shared ControlKey numbering', () => {
    expect(ControlKey.Return).toBe(27)
    expect(ControlKey.F5).toBe(16)
    expect(ControlKey.CtrlAltDel).toBe(100)
  })
})

describe('session encryption', () => {
  it('encodes the message counter little-endian in the nonce', () => {
    expect(Array.from(nonceFor(1).slice(0, 3))).toEqual([1, 0, 0])
    expect(Array.from(nonceFor(258).slice(0, 3))).toEqual([2, 1, 0])
    expect(nonceFor(1).length).toBe(24)
  })

  it('round-trips with the counter scheme peers use', () => {
    const k = nacl.randomBytes(32)
    const sealed = nacl.secretbox(new Uint8Array([7, 7]), nonceFor(1), k)
    expect(nacl.secretbox.open(sealed, nonceFor(1), k)).toEqual(new Uint8Array([7, 7]))
    expect(nacl.secretbox.open(sealed, nonceFor(2), k)).toBeNull()
  })
})

describe('input', () => {
  it('packs mouse type and buttons', () => {
    expect(mouseMask(MouseType.Down, MouseButton.Left)).toBe(9)
    expect(mouseMask(MouseType.Up, MouseButton.Right)).toBe(18)
    expect(mouseMask(MouseType.Wheel)).toBe(3)
  })

  it('maps special keys to control keys', () => {
    expect(keyEventFor(key({ code: 'Enter', key: 'Enter' }), true)).toMatchObject({ down: true, control_key: ControlKey.Return })
    expect(keyEventFor(key({ code: 'F5', key: 'F5' }), false)).toMatchObject({ down: false, control_key: ControlKey.F5 })
  })

  it('types text as text and shortcuts as base characters', () => {
    expect(keyEventFor(key({ code: 'KeyA', key: 'A', shiftKey: true }), true)).toMatchObject({ press: true, seq: 'A' })
    expect(keyEventFor(key({ code: 'KeyA', key: 'A' }), false)).toBeNull()
    expect(keyEventFor(key({ code: 'KeyC', key: 'c', ctrlKey: true }), true)).toMatchObject({
      down: true,
      chr: 'c'.codePointAt(0),
      modifiers: [ControlKey.Control],
    })
  })
})

describe('share links', () => {
  it('tells salted hashes from plain passwords', () => {
    expect(presetFrom('')).toBeUndefined()
    expect(presetFrom('a'.repeat(43) + '=')).toEqual({ hash: 'a'.repeat(43) + '=' })
    expect(presetFrom('hunter2')).toEqual({ plain: 'hunter2' })
  })
})
