// Remote cursor shapes, applied as CSS cursors on the session canvas.
import { decompress } from 'fzstd'
import type { Msg } from './proto'

export interface CursorShape {
  css: string
}

/** Convert CursorData (zstd-compressed RGBA) into a CSS cursor value. */
export function cursorFromData(cd: Msg): CursorShape | null {
  const width = cd.width ?? 0
  const height = cd.height ?? 0
  if (!width || !height || !cd.colors?.length) return { css: 'none' }
  let rgba: Uint8Array
  try {
    rgba = decompress(cd.colors)
  } catch {
    rgba = cd.colors
  }
  if (rgba.length < width * height * 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const pixels = new Uint8ClampedArray(width * height * 4)
  pixels.set(rgba.subarray(0, width * height * 4))
  const img = new ImageData(pixels, width, height)
  ctx.putImageData(img, 0, 0)
  const hx = Math.max(0, Math.min(width - 1, cd.hotx ?? 0))
  const hy = Math.max(0, Math.min(height - 1, cd.hoty ?? 0))
  return { css: `url(${canvas.toDataURL('image/png')}) ${hx} ${hy}, default` }
}
