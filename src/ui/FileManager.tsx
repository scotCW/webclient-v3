import { ArrowUp, Download, File as FileIcon, Folder, FolderPlus, HardDrive, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { FileBrowser, RemoteEntry, Transfer } from '../core/files'
import { FileType } from '../core/proto'
import { formatBytes } from '../core/util'
import { SessionTab, useApp } from './state'
import { SessionOverlay, useSession } from './useSession'

/** Collect files (with relative paths) from a drop, including folders. */
async function filesFromDrop(dt: DataTransfer): Promise<{ file: File; name: string }[]> {
  const out: { file: File; name: string }[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, name: prefix + entry.name })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e)
  if (entries.length) {
    for (const e of entries) await walk(e, '')
  } else {
    for (const f of Array.from(dt.files)) out.push({ file: f, name: f.name })
  }
  return out
}

export function FileManager(props: { tab: SessionTab; active: boolean }) {
  const app = useApp()
  const [attempt, setAttempt] = useState(0)
  const { session, phase, status, closedReason, peer, loginUi } = useSession(props.tab, attempt)
  const browser = useRef<FileBrowser | null>(null)
  const [path, setPath] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [dragover, setDragover] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!session) return
    const fb = new FileBrowser(session)
    browser.current = fb
    const offs = [
      fb.on('dir', (p, list) => {
        setPath(p)
        setPathInput(p)
        setEntries(list)
        setSelected(null)
        setError('')
      }),
      fb.on('transfer', (t) => setTransfers((all) => [{ ...t }, ...all.filter((x) => x.id !== t.id)].slice(0, 50))),
      fb.on('error', setError),
    ]
    return () => {
      offs.forEach((off) => off())
      fb.dispose()
      browser.current = null
    }
  }, [session])

  useEffect(() => {
    if (peer) browser.current?.setPlatform(peer.platform)
  }, [peer])

  const fb = () => browser.current
  const open = (p: string) => fb()?.readDir(p)
  const full = (name: string) => fb()?.join(path, name) ?? name

  const run = async (label: string, action: () => Promise<void> | undefined) => {
    try {
      await action()
      open(path)
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const sel = entries.find((e) => e.name === selected) ?? null

  const upload = (files: { file: File; name: string }[]) => {
    if (!files.length) return
    const label = files.length === 1 ? files[0].name : `${files.length} files`
    fb()?.upload(path, files, label)
  }

  return (
    <div class={`view files${props.active ? ' active' : ''}`}>
      <div class="pathbar">
        <button class="btn icon" title="Up" disabled={!path || phase !== 'ready'} onClick={() => open(fb()?.parent(path) ?? '')}>
          <ArrowUp size={16} />
        </button>
        <button class="btn icon" title="Refresh" disabled={phase !== 'ready'} onClick={() => open(path)}>
          <RefreshCw size={16} />
        </button>
        <form
          style={{ display: 'contents' }}
          onSubmit={(e) => {
            e.preventDefault()
            open(pathInput)
          }}
        >
          <input value={pathInput} onInput={(e) => setPathInput((e.currentTarget as HTMLInputElement).value)} aria-label="Remote path" disabled={phase !== 'ready'} />
        </form>
        <label class="check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => {
              const on = (e.currentTarget as HTMLInputElement).checked
              setShowHidden(on)
              if (fb()) fb()!.showHidden = on
              open(path)
            }}
          />
          Hidden
        </label>
        <button
          class="btn"
          disabled={phase !== 'ready'}
          onClick={() => {
            const name = prompt('New folder name')
            if (name) void run('New folder', () => fb()?.mkdir(full(name)))
          }}
        >
          <FolderPlus size={16} /> New folder
        </button>
        <button class="btn" disabled={phase !== 'ready'} onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> Upload files
        </button>
        <button class="btn" disabled={phase !== 'ready'} onClick={() => dirInput.current?.click()}>
          <Upload size={16} /> Upload folder
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement
            upload(Array.from(input.files ?? []).map((file) => ({ file, name: file.name })))
            input.value = ''
          }}
        />
        <input
          ref={dirInput}
          type="file"
          hidden
          // @ts-expect-error non-standard but widely supported attribute
          webkitdirectory=""
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement
            upload(Array.from(input.files ?? []).map((file) => ({ file, name: file.webkitRelativePath || file.name })))
            input.value = ''
          }}
        />
        <button class="btn" title="Close" onClick={() => app.close(props.tab.key)}>
          <X size={16} />
        </button>
      </div>

      {error && <div class="error-text">{error}</div>}

      <div
        class={`file-table${dragover ? ' dragover' : ''}`}
        onDragOver={(e) => {
          if (phase !== 'ready') return
          e.preventDefault()
          setDragover(true)
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragover(false)
          if (phase === 'ready' && e.dataTransfer) void filesFromDrop(e.dataTransfer).then(upload)
        }}
        style={{ position: 'relative' }}
      >
        {phase === 'ready' ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.name}
                  class={selected === e.name ? 'selected' : ''}
                  onClick={() => setSelected(e.name)}
                  onDblClick={() => (e.isDir ? open(full(e.name)) : void fb()?.download(full(e.name), e.name, false))}
                >
                  <td>
                    <span class="name-cell">
                      {e.type === FileType.DirDrive ? <HardDrive size={16} /> : e.isDir ? <Folder size={16} /> : <FileIcon size={16} />}
                      {e.name}
                    </span>
                  </td>
                  <td class="muted">{e.isDir ? '' : formatBytes(e.size)}</td>
                  <td class="muted">{e.modified ? new Date(e.modified * 1000).toLocaleString() : ''}</td>
                  <td>
                    {selected === e.name && (
                      <span class="row" style={{ gap: 4 }}>
                        <button class="btn small" title="Download" onClick={() => void fb()?.download(full(e.name), e.name, e.isDir)}>
                          <Download size={14} />
                        </button>
                        <button
                          class="btn small"
                          title="Rename"
                          onClick={() => {
                            const name = prompt('Rename to', e.name)
                            if (name && name !== e.name) void run('Rename', () => fb()?.rename(full(e.name), name))
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          class="btn small danger"
                          title="Delete"
                          onClick={() => {
                            if (confirm(`Delete ${e.name}${e.isDir ? ' and everything in it' : ''}?`)) void run('Delete', () => fb()?.remove(full(e.name), e.isDir))
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} class="empty">
                    {path ? 'This folder is empty. Drop files here to upload them.' : 'Loading…'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <SessionOverlay
            phase={phase}
            status={status}
            closedReason={closedReason}
            dark={false}
            onReconnect={() => setAttempt((a) => a + 1)}
            onClose={() => app.close(props.tab.key)}
          />
        )}
      </div>

      {sel && <div class="muted" style={{ fontSize: 12 }}>{full(sel.name)}</div>}

      {transfers.length > 0 && (
        <div class="transfers">
          {transfers.map((t) => {
            const pct = t.totalBytes ? Math.min(100, (t.doneBytes / t.totalBytes) * 100) : t.state === 'done' ? 100 : 0
            return (
              <div key={t.id} class="transfer">
                {t.direction === 'download' ? <Download size={14} /> : <Upload size={14} />}
                <div>
                  <div>
                    {t.label}
                    {t.fileCount > 1 ? ` (${t.fileCount} files)` : ''}
                  </div>
                  <div class={`progress${t.state === 'error' ? ' error' : ''}`}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span class="muted">
                  {t.state === 'running'
                    ? `${formatBytes(t.doneBytes)}${t.totalBytes ? ` / ${formatBytes(t.totalBytes)}` : ''}`
                    : t.state === 'error'
                      ? t.error || 'failed'
                      : t.state}
                </span>
                {t.state === 'running' ? (
                  <button class="btn small" onClick={() => fb()?.cancel(t.id)}>
                    Cancel
                  </button>
                ) : (
                  <span />
                )}
              </div>
            )
          })}
        </div>
      )}
      {props.active && loginUi}
    </div>
  )
}
