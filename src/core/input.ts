// Translating browser input into protocol input events.
import { ControlKey, KeyboardMode, Msg } from './proto'

export const MouseType = { Move: 0, Down: 1, Up: 2, Wheel: 3, Trackpad: 4 } as const
export const MouseButton = { Left: 0x01, Right: 0x02, Wheel: 0x04, Back: 0x08, Forward: 0x10 } as const

/** DOM MouseEvent.button -> protocol button bit */
export function buttonBit(domButton: number): number {
  switch (domButton) {
    case 0:
      return MouseButton.Left
    case 1:
      return MouseButton.Wheel
    case 2:
      return MouseButton.Right
    case 3:
      return MouseButton.Back
    case 4:
      return MouseButton.Forward
    default:
      return 0
  }
}

export function mouseMask(type: number, buttons = 0) {
  return type | (buttons << 3)
}

export function modifiersOf(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): number[] {
  const m: number[] = []
  if (e.ctrlKey) m.push(ControlKey.Control)
  if (e.shiftKey) m.push(ControlKey.Shift)
  if (e.altKey) m.push(ControlKey.Alt)
  if (e.metaKey) m.push(ControlKey.Meta)
  return m
}

// KeyboardEvent.code -> ControlKey name. Physical codes keep numpad and
// left/right keys distinct regardless of the local layout.
const CODE_TO_CONTROL: Record<string, string> = {
  AltLeft: 'Alt',
  AltRight: 'RAlt',
  Backspace: 'Backspace',
  CapsLock: 'CapsLock',
  ControlLeft: 'Control',
  ControlRight: 'RControl',
  Delete: 'Delete',
  ArrowDown: 'DownArrow',
  ArrowUp: 'UpArrow',
  ArrowLeft: 'LeftArrow',
  ArrowRight: 'RightArrow',
  End: 'End',
  Home: 'Home',
  Escape: 'Escape',
  MetaLeft: 'Meta',
  MetaRight: 'RWin',
  OSLeft: 'Meta',
  OSRight: 'RWin',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Enter: 'Return',
  NumpadEnter: 'NumpadEnter',
  ShiftLeft: 'Shift',
  ShiftRight: 'RShift',
  Space: 'Space',
  Tab: 'Tab',
  Insert: 'Insert',
  Pause: 'Pause',
  PrintScreen: 'Snapshot',
  ScrollLock: 'Scroll',
  NumLock: 'NumLock',
  ContextMenu: 'Apps',
  NumpadMultiply: 'Multiply',
  NumpadAdd: 'Add',
  NumpadSubtract: 'Subtract',
  NumpadDecimal: 'Decimal',
  NumpadDivide: 'Divide',
  NumpadEqual: 'Equals',
  AudioVolumeMute: 'VolumeMute',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
}
for (let i = 0; i <= 9; i++) CODE_TO_CONTROL[`Numpad${i}`] = `Numpad${i}`
for (let i = 1; i <= 12; i++) CODE_TO_CONTROL[`F${i}`] = `F${i}`

const MODIFIER_CODES = new Set(['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'])

/**
 * Build the key event for a browser keydown/keyup, or null to ignore it.
 *
 * Special keys go as control keys. Printable keys typed without Ctrl/Alt/Meta
 * go as text (so the remote side produces exactly the character typed, in any
 * layout); with those modifiers held they go as the base character so remote
 * shortcuts such as Ctrl+C work.
 */
export function keyEventFor(e: KeyboardEvent, down: boolean): Msg | null {
  const control = CODE_TO_CONTROL[e.code]
  const modifiers = MODIFIER_CODES.has(e.code) ? [] : modifiersOf(e)
  if (control) {
    return { down, control_key: ControlKey[control], modifiers, mode: KeyboardMode.Legacy }
  }
  if (e.key.length !== 1 && !/^Key[A-Z]$|^Digit\d$/.test(e.code)) return null
  const shortcut = e.ctrlKey || e.altKey || e.metaKey
  if (!shortcut) {
    if (!down) return null
    return { press: true, seq: e.key, mode: KeyboardMode.Legacy }
  }
  let ch = e.key.length === 1 ? e.key.toLowerCase() : ''
  const m = /^Key([A-Z])$|^Digit(\d)$/.exec(e.code)
  if (m) ch = (m[1] ?? m[2]).toLowerCase()
  if (!ch) return null
  return { down, chr: ch.codePointAt(0), modifiers, mode: KeyboardMode.Legacy }
}

export function controlKeyEvent(name: string, modifiers: number[] = []): Msg {
  return { press: true, control_key: ControlKey[name], modifiers, mode: KeyboardMode.Legacy }
}
