// Opus audio playback with WebCodecs.

export class AudioPlayer {
  private ctx: AudioContext | null = null
  private decoder: AudioDecoder | null = null
  private playhead = 0
  private sampleRate = 48000
  private channels = 2
  muted = false

  static supported() {
    return typeof AudioDecoder !== 'undefined'
  }

  setFormat(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate || 48000
    this.channels = channels || 2
    this.closeDecoder()
    if (!AudioPlayer.supported()) return
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' })
    this.decoder = new AudioDecoder({
      output: (data) => this.play(data),
      error: () => this.closeDecoder(),
    })
    this.decoder.configure({ codec: 'opus', sampleRate: this.sampleRate, numberOfChannels: this.channels })
  }

  push(data: Uint8Array) {
    if (!this.decoder || this.decoder.state !== 'configured' || this.muted) return
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: 0, data }))
    } catch {
      /* skip a broken packet */
    }
  }

  /** Browsers start audio contexts suspended until a user gesture. */
  resume() {
    void this.ctx?.resume()
  }

  private play(data: AudioData) {
    const ctx = this.ctx
    if (!ctx || this.muted) {
      data.close()
      return
    }
    const frames = data.numberOfFrames
    const buffer = ctx.createBuffer(data.numberOfChannels, frames, data.sampleRate)
    for (let ch = 0; ch < data.numberOfChannels; ch++) {
      const plane = new Float32Array(frames)
      data.copyTo(plane, { planeIndex: ch, format: 'f32-planar' })
      buffer.copyToChannel(plane, ch)
    }
    data.close()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const now = ctx.currentTime
    // Keep a small jitter buffer; resynchronise if we drift too far behind or ahead.
    if (this.playhead < now + 0.02 || this.playhead > now + 0.3) this.playhead = now + 0.05
    src.start(this.playhead)
    this.playhead += buffer.duration
  }

  private closeDecoder() {
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close()
      } catch {
        /* already closed */
      }
    }
    this.decoder = null
  }

  close() {
    this.closeDecoder()
    void this.ctx?.close()
    this.ctx = null
  }
}
