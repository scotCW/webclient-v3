// Hardware-accelerated video decoding with WebCodecs.
import type { Msg } from './proto'

export type CodecName = 'vp9' | 'vp8' | 'av1' | 'h264' | 'h265'

const CODEC_STRINGS: Record<CodecName, string[]> = {
  vp9: ['vp09.00.10.08', 'vp09.00.31.08'],
  vp8: ['vp8'],
  av1: ['av01.0.08M.08', 'av01.0.05M.08'],
  h264: ['avc1.640033', 'avc1.42E033', 'avc1.42E01E'],
  h265: ['hev1.1.6.L153.B0', 'hvc1.1.6.L123.B0'],
}

const UNION_TO_CODEC: Record<string, CodecName> = {
  vp9s: 'vp9',
  vp8s: 'vp8',
  av1s: 'av1',
  h264s: 'h264',
  h265s: 'h265',
}

let supportCache: Promise<Record<CodecName, string | null>> | null = null

/** Which codecs this browser can decode, with the codec string that worked. */
export function probeCodecs(): Promise<Record<CodecName, string | null>> {
  supportCache ??= (async () => {
    const result = { vp9: null, vp8: null, av1: null, h264: null, h265: null } as Record<CodecName, string | null>
    if (typeof VideoDecoder === 'undefined') return result
    for (const name of Object.keys(CODEC_STRINGS) as CodecName[]) {
      for (const codec of CODEC_STRINGS[name]) {
        try {
          const r = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true })
          if (r.supported) {
            result[name] = codec
            break
          }
        } catch {
          /* unsupported */
        }
      }
    }
    return result
  })()
  return supportCache
}

export function hasWebCodecs() {
  return typeof VideoDecoder !== 'undefined'
}

/** Decodes one display's video stream and hands decoded frames to `onFrame`. */
export class VideoStream {
  private decoder: VideoDecoder | null = null
  private codec: CodecName | null = null
  private waitingForKey = true
  /** codec currently in use, for the UI */
  current: CodecName | null = null
  framesDecoded = 0

  constructor(
    private onFrame: (frame: VideoFrame) => void,
    private onNeedKeyFrame: () => void,
  ) {}

  async push(videoFrame: Msg) {
    const codec = UNION_TO_CODEC[videoFrame.union as string]
    if (!codec) return
    const frames: Msg[] = videoFrame[videoFrame.union].frames ?? []
    if (codec !== this.codec || !this.decoder || this.decoder.state === 'closed') {
      await this.configure(codec)
    }
    const decoder = this.decoder
    if (!decoder) return
    for (const f of frames) {
      const key = !!f.key
      if (this.waitingForKey && !key) continue
      this.waitingForKey = false
      // Drop frames rather than build up latency when the decoder falls behind.
      if (!key && decoder.decodeQueueSize > 8) continue
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: key ? 'key' : 'delta',
            timestamp: Number(f.pts ?? 0) * 1000,
            data: f.data ?? new Uint8Array(),
          }),
        )
      } catch {
        this.reset()
        return
      }
    }
  }

  private async configure(codec: CodecName) {
    this.close()
    const support = await probeCodecs()
    const codecString = support[codec]
    this.codec = codec
    this.current = codec
    if (!codecString) {
      this.decoder = null
      return
    }
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.framesDecoded++
        this.onFrame(frame)
      },
      error: () => this.reset(),
    })
    this.decoder.configure({ codec: codecString, optimizeForLatency: true, hardwareAcceleration: 'no-preference' })
    this.waitingForKey = true
  }

  /** Throw the decoder away and ask the peer for a key frame. */
  reset() {
    this.close()
    this.codec = null
    this.waitingForKey = true
    this.onNeedKeyFrame()
  }

  close() {
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close()
      } catch {
        /* already closed */
      }
    }
    this.decoder = null
  }
}
