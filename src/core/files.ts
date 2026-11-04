// Remote file browsing and transfers over a file-transfer session.
import { decompress } from 'fzstd'
import { FileType, Msg } from './proto'
import type { Session } from './session'
import { Emitter } from './util'

export interface RemoteEntry {
  name: string
  type: number
  isDir: boolean
  hidden: boolean
  size: number
  modified: number
}

export interface Transfer {
  id: number
  direction: 'download' | 'upload'
  label: string
  totalBytes: number
  doneBytes: number
  fileCount: number
  state: 'running' | 'done' | 'error' | 'cancelled'
  error?: string
}

type Events = {
  dir: [path: string, entries: RemoteEntry[]]
  transfer: [Transfer]
  error: [string]
}

const BLOCK = 128 * 1024

const isDirType = (t: number) => t === FileType.Dir || t === FileType.DirLink || t === FileType.DirDrive

function toEntry(e: Msg): RemoteEntry {
  const type = e.entry_type ?? FileType.Dir
  return {
    name: e.name ?? '',
    type,
    isDir: isDirType(type),
    hidden: !!e.is_hidden,
    size: Number(e.size ?? 0),
    modified: Number(e.modified_time ?? 0),
  }
}

/** Where downloaded files are written. */
interface Sink {
  open(relativePath: string): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>
}

/** Writes into a folder chosen with the File System Access API. */
function directorySink(root: FileSystemDirectoryHandle): Sink {
  return {
    async open(relativePath) {
      const parts = relativePath.split(/[\\/]+/).filter(Boolean)
      let dir = root
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
      const handle = await dir.getFileHandle(parts[parts.length - 1] || 'download', { create: true })
      const writable = await handle.createWritable()
      return {
        write: (data) => writable.write(data as BufferSource),
        close: () => writable.close(),
      }
    },
  }
}

/** Fallback: collect each file in memory and hand it to the browser's downloads. */
const blobSink: Sink = {
  async open(relativePath) {
    const chunks: Uint8Array[] = []
    return {
      write: async (data) => {
        chunks.push(data)
      },
      close: async () => {
        const url = URL.createObjectURL(new Blob(chunks as BlobPart[]))
        const a = document.createElement('a')
        a.href = url
        a.download = relativePath.split(/[\\/]/).pop() || 'download'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 30000)
      },
    }
  },
}

interface DownloadJob {
  kind: 'download'
  transfer: Transfer
  files: RemoteEntry[]
  sink: Sink
  current: { num: number; writer: Awaited<ReturnType<Sink['open']>> } | null
  singleName: string
}

interface UploadJob {
  kind: 'upload'
  transfer: Transfer
  files: { file: File; name: string }[]
  next: number
}

export class FileBrowser extends Emitter<Events> {
  private nextId = 1
  private jobs = new Map<number, DownloadJob | UploadJob>()
  cwd = ''
  separator = '/'
  showHidden = false
  private unsubscribe: () => void

  constructor(private session: Session) {
    super()
    this.unsubscribe = session.on('file', (fr) => this.onResponse(fr))
  }

  dispose() {
    this.unsubscribe()
  }

  setPlatform(platform: string) {
    this.separator = /windows/i.test(platform) ? '\\' : '/'
  }

  join(dir: string, name: string) {
    if (!dir) return name
    return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + this.separator + name
  }

  parent(dir: string) {
    const trimmed = dir.replace(/[\\/]+$/, '')
    const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    if (i < 0) return ''
    if (i === 0) return '/'
    const p = trimmed.slice(0, i)
    return /^[A-Za-z]:$/.test(p) ? p + '\\' : p
  }

  readDir(path: string) {
    this.session.fileAction({ read_dir: { path, include_hidden: this.showHidden } })
  }

  /** Run a create/remove/rename action and wait for its done/error reply. */
  private simple(action: Msg): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const key = Object.keys(action)[0]
      action[key].id = id
      const off = this.session.on('file', (fr) => {
        const r = fr[fr.union]
        if (r?.id !== id) return
        off()
        if (fr.union === 'error') reject(new Error(r.error || 'Failed'))
        else resolve()
      })
      this.session.fileAction(action)
    })
  }

  mkdir(path: string) {
    return this.simple({ create: { path } })
  }

  rename(path: string, newName: string) {
    return this.simple({ rename: { path, new_name: newName } })
  }

  remove(path: string, isDir: boolean) {
    return isDir ? this.simple({ remove_dir: { path, recursive: true } }) : this.simple({ remove_file: { path, file_num: 0 } })
  }

  /** Download a remote file or folder. Prompts for a target folder when the browser supports it. */
  async download(path: string, name: string, isDir: boolean) {
    let sink: Sink = blobSink
    const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (picker) {
      try {
        const root = await picker({ mode: 'readwrite', id: 'webclient-downloads' })
        sink = directorySink(isDir ? await root.getDirectoryHandle(name, { create: true }) : root)
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return
      }
    } else if (isDir) {
      this.emit('error', 'This browser can only download folders file by file; each file will be saved separately.')
    }
    const id = this.nextId++
    const transfer: Transfer = { id, direction: 'download', label: name, totalBytes: 0, doneBytes: 0, fileCount: 0, state: 'running' }
    this.jobs.set(id, { kind: 'download', transfer, files: [], sink, current: null, singleName: name })
    this.emit('transfer', transfer)
    this.session.fileAction({ send: { id, path, include_hidden: this.showHidden, file_num: 0 } })
  }

  /** Upload local files into a remote folder. `relative` names may contain subfolders. */
  upload(remoteDir: string, files: { file: File; name: string }[], label: string) {
    if (!files.length) return
    const id = this.nextId++
    const totalBytes = files.reduce((n, f) => n + f.file.size, 0)
    const transfer: Transfer = { id, direction: 'upload', label, totalBytes, doneBytes: 0, fileCount: files.length, state: 'running' }
    this.jobs.set(id, { kind: 'upload', transfer, files, next: 0 })
    this.emit('transfer', transfer)
    this.session.fileAction({
      receive: {
        id,
        path: remoteDir,
        file_num: 0,
        total_size: totalBytes,
        files: files.map((f) => ({
          entry_type: FileType.File,
          name: f.name,
          size: f.file.size,
          modified_time: Math.floor(f.file.lastModified / 1000),
        })),
      },
    })
    this.sendDigest(id)
  }

  cancel(id: number) {
    const job = this.jobs.get(id)
    if (!job) return
    this.session.fileAction({ cancel: { id } })
    this.finish(job, 'cancelled')
  }

  // --------------------------------------------------------- responses

  private onResponse(fr: Msg) {
    switch (fr.union) {
      case 'dir':
        this.onDir(fr.dir)
        break
      case 'digest':
        this.onDigest(fr.digest)
        break
      case 'block':
        void this.onBlock(fr.block)
        break
      case 'done': {
        const job = this.jobs.get(fr.done.id)
        if (job) void this.completeDownload(job)
        break
      }
      case 'error': {
        const job = this.jobs.get(fr.error.id)
        if (job) {
          job.transfer.error = fr.error.error || 'Transfer failed'
          this.finish(job, 'error')
        } else if (!fr.error.id) {
          this.emit('error', fr.error.error || 'File operation failed')
        }
        break
      }
    }
  }

  private onDir(d: Msg) {
    const job = this.jobs.get(d.id)
    const entries: RemoteEntry[] = (d.entries ?? []).map(toEntry)
    if (job?.kind === 'download' && job.files.length === 0) {
      // The listing of every file in a download job.
      job.files = entries
      job.transfer.fileCount = entries.length
      job.transfer.totalBytes = entries.reduce((n, e) => n + e.size, 0)
      this.emit('transfer', job.transfer)
      if (!entries.length) this.finish(job, 'done')
      return
    }
    if (!job) {
      this.cwd = d.path ?? ''
      this.emit('dir', this.cwd, entries.sort(sortEntries))
    }
  }

  private onDigest(dg: Msg) {
    const job = this.jobs.get(dg.id)
    if (!job) return
    if (job.kind === 'download') {
      // Always fetch the whole file; the browser has no local copy to resume from.
      this.session.fileAction({ send_confirm: { id: dg.id, file_num: dg.file_num ?? 0, offset_blk: 0 } })
    } else {
      // The remote file already exists and differs: overwrite it.
      this.session.fileAction({ send_confirm: { id: dg.id, file_num: dg.file_num ?? 0, offset_blk: 0 } })
      void this.sendFile(job, dg.file_num ?? 0)
    }
  }

  private async onBlock(b: Msg) {
    const job = this.jobs.get(b.id)
    if (!job || job.kind !== 'download') return
    const num: number = b.file_num ?? 0
    let data: Uint8Array = b.data ?? new Uint8Array()
    if (b.compressed && data.length) data = decompress(data)
    try {
      if (job.current && job.current.num !== num) {
        await job.current.writer.close()
        job.current = null
      }
      if (!job.current) {
        const entry = job.files[num]
        const name = entry?.name || job.singleName
        job.current = { num, writer: await job.sink.open(name) }
      }
      if (data.length) {
        await job.current.writer.write(data)
        job.transfer.doneBytes += data.length
        this.emit('transfer', job.transfer)
      } else {
        // An empty block ends the current file.
        await job.current.writer.close()
        job.current = null
      }
    } catch (e) {
      job.transfer.error = e instanceof Error ? e.message : String(e)
      this.session.fileAction({ cancel: { id: job.transfer.id } })
      this.finish(job, 'error')
    }
  }

  private async completeDownload(job: DownloadJob | UploadJob) {
    if (job.kind === 'download' && job.current) {
      try {
        await job.current.writer.close()
      } catch {
        /* already closed */
      }
      job.current = null
    }
    this.finish(job, 'done')
  }

  private sendDigest(id: number) {
    const job = this.jobs.get(id)
    if (!job || job.kind !== 'upload') return
    if (job.next >= job.files.length) {
      this.session.send({ file_response: { done: { id, file_num: job.files.length - 1 } } })
      return
    }
    const f = job.files[job.next]
    // Wait for the peer's confirm (or skip) before sending this file.
    this.awaitConfirm(id, job.next)
    this.session.send({
      file_response: {
        digest: {
          id,
          file_num: job.next,
          last_modified: Math.floor(f.file.lastModified / 1000),
          file_size: f.file.size,
          is_upload: true,
        },
      },
    })
  }

  /** Peers answer an upload digest with a send_confirm file action. */
  private awaitConfirm(id: number, fileNum: number) {
    const off = this.session.onFileAction((fa) => {
      if (fa.union !== 'send_confirm' || fa.send_confirm.id !== id || (fa.send_confirm.file_num ?? 0) !== fileNum) return
      off()
      const job = this.jobs.get(id)
      if (!job || job.kind !== 'upload') return
      if (fa.send_confirm.union === 'skip' && fa.send_confirm.skip) {
        job.transfer.doneBytes += job.files[fileNum].file.size
        job.next = fileNum + 1
        this.emit('transfer', job.transfer)
        this.sendDigest(id)
      } else {
        void this.sendFile(job, fileNum)
      }
    })
  }

  private async sendFile(job: UploadJob, fileNum: number) {
    const f = job.files[fileNum].file
    const id = job.transfer.id
    try {
      if (f.size === 0) {
        this.session.send({ file_response: { block: { id, file_num: fileNum, data: new Uint8Array(), compressed: false } } })
      }
      for (let off = 0; off < f.size; off += BLOCK) {
        if (job.transfer.state !== 'running') return
        const data = new Uint8Array(await f.slice(off, off + BLOCK).arrayBuffer())
        this.session.send({ file_response: { block: { id, file_num: fileNum, data, compressed: false } } })
        job.transfer.doneBytes += data.length
        this.emit('transfer', job.transfer)
        // Yield so the UI and the socket keep up with large files.
        await new Promise((r) => setTimeout(r, 0))
      }
    } catch (e) {
      job.transfer.error = e instanceof Error ? e.message : String(e)
      this.session.fileAction({ cancel: { id } })
      this.finish(job, 'error')
      return
    }
    job.next = fileNum + 1
    this.sendDigest(id)
  }

  private finish(job: DownloadJob | UploadJob, state: Transfer['state']) {
    if (job.transfer.state !== 'running') return
    job.transfer.state = state
    if (state === 'done') job.transfer.doneBytes = job.transfer.totalBytes || job.transfer.doneBytes
    this.jobs.delete(job.transfer.id)
    this.emit('transfer', job.transfer)
    if (job.kind === 'upload' && state === 'done') this.readDir(this.cwd)
  }
}

function sortEntries(a: RemoteEntry, b: RemoteEntry) {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}
