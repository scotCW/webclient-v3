// A WebSocket carrying one protobuf message per binary frame, with optional
// secretbox encryption once the session key has been agreed.
import nacl from 'tweetnacl'

export class TransportClosed extends Error {
  constructor(reason = 'Connection closed') {
    super(reason)
  }
}

export class Transport {
  private ws: WebSocket
  private queue: Uint8Array[] = []
  private waiters: { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }[] = []
  private closedError: Error | null = null
  private key: Uint8Array | null = null
  private sendSeq = 0
  private recvSeq = 0
  /** Called for every message when set, instead of queueing (used once a session is running). */
  onMessage: ((bytes: Uint8Array) => void) | null = null
  onClose: ((err: Error) => void) | null = null

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (ev) => this.handleIncoming(new Uint8Array(ev.data as ArrayBuffer))
    ws.onclose = (ev) => this.fail(new TransportClosed(ev.reason || 'Connection closed'))
    ws.onerror = () => this.fail(new TransportClosed('Connection error'))
  }

  static open(url: string, timeoutMs = 15000): Promise<Transport> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error(`Timed out connecting to ${url}`))
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve(new Transport(ws))
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`Cannot connect to ${url}`))
      }
    })
  }

  /** Switch to encrypted mode with the agreed symmetric key. */
  setKey(key: Uint8Array) {
    this.key = key
    this.sendSeq = 0
    this.recvSeq = 0
  }

  get encrypted() {
    return this.key !== null
  }

  send(bytes: Uint8Array) {
    if (this.closedError) throw this.closedError
    let out = bytes
    if (this.key) {
      this.sendSeq += 1
      out = nacl.secretbox(bytes, nonceFor(this.sendSeq), this.key)
    }
    this.ws.send(out)
  }

  /** Wait for the next message (only valid while onMessage is not set). */
  recv(timeoutMs = 30000): Promise<Uint8Array> {
    const next = this.queue.shift()
    if (next) return Promise.resolve(next)
    if (this.closedError) return Promise.reject(this.closedError)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        reject(new Error('Timed out waiting for the remote side'))
      }, timeoutMs)
      const waiter = {
        resolve: (b: Uint8Array) => {
          clearTimeout(timer)
          resolve(b)
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
      }
      this.waiters.push(waiter)
    })
  }

  close() {
    this.ws.onclose = null
    this.ws.close()
    this.fail(new TransportClosed('Closed'))
  }

  private handleIncoming(raw: Uint8Array) {
    let bytes = raw
    // The peers never encrypt messages of one byte or less.
    if (this.key && raw.length > 1) {
      this.recvSeq += 1
      const opened = nacl.secretbox.open(raw, nonceFor(this.recvSeq), this.key)
      if (!opened) {
        this.fail(new Error('Decryption failed'))
        this.ws.close()
        return
      }
      bytes = opened
    }
    if (this.onMessage) {
      this.onMessage(bytes)
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(bytes)
    else this.queue.push(bytes)
  }

  private fail(err: Error) {
    if (this.closedError) return
    this.closedError = err
    for (const w of this.waiters) w.reject(err)
    this.waiters = []
    this.onClose?.(err)
  }
}

/** 24-byte nonce: the message counter as little-endian u64, then zeros. */
function nonceFor(seq: number): Uint8Array {
  const nonce = new Uint8Array(nacl.secretbox.nonceLength)
  let n = seq
  for (let i = 0; i < 8 && n > 0; i++) {
    nonce[i] = n & 0xff
    n = Math.floor(n / 256)
  }
  return nonce
}
