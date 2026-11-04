import { BookPlus, FolderOpen, LogIn, LogOut, Monitor, MoreHorizontal, Settings as SettingsIcon, SquareTerminal, Star, Trash2 } from 'lucide-preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  AbPeer,
  ApiUser,
  accessToken,
  accessibleDevices,
  addPeerToAddressBook,
  addressBookPeers,
  currentUser,
  logout,
  personalAddressBook,
  sharedAddressBooks,
  storedUser,
} from '../api/client'
import { loadServerConfig } from '../core/config'
import { hasWebCodecs } from '../core/video'
import { PeerRecord, favorites, forgetPeer, recentPeers, savedPassword, setFavorite } from '../store/prefs'
import { cleanPeerId, useApp } from './state'

type ListTab = 'recent' | 'favorites' | 'ab' | 'devices'

interface PeerCardData {
  id: string
  name: string
  sub: string
  platform?: string
  hostname?: string
  username?: string
  alias?: string
  hash?: string
}

export function Home(props: { revision: number }) {
  const app = useApp()
  const [peerId, setPeerId] = useState('')
  const [tab, setTab] = useState<ListTab>(() => (localStorage.getItem('v3:home-tab') as ListTab) || 'recent')
  const [user, setUser] = useState<ApiUser | null>(storedUser())
  const [abPeers, setAbPeers] = useState<AbPeer[] | null>(null)
  const [abBooks, setAbBooks] = useState<{ guid: string; name: string }[]>([])
  const [abGuid, setAbGuid] = useState('')
  const [devices, setDevices] = useState<PeerCardData[] | null>(null)
  const [listError, setListError] = useState('')
  const [, setTick] = useState(0)
  const server = loadServerConfig()

  useEffect(() => {
    try {
      localStorage.setItem('v3:home-tab', tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  // Refresh the signed-in user when the dialog signs in or on load.
  useEffect(() => {
    setUser(storedUser())
    if (accessToken()) void currentUser().then(setUser).catch(() => setUser(storedUser()))
  }, [props.revision])

  useEffect(() => {
    setListError('')
    if (!user) {
      setAbPeers(null)
      setDevices(null)
      return
    }
    if (tab === 'ab') {
      void (async () => {
        try {
          const personal = await personalAddressBook()
          const shared = await sharedAddressBooks().catch(() => [])
          const books = [{ guid: personal, name: 'My address book' }, ...shared.map((s) => ({ guid: s.guid, name: s.name }))]
          setAbBooks(books)
          setAbGuid((g) => (g && books.some((b) => b.guid === g) ? g : personal))
        } catch (e) {
          setListError(e instanceof Error ? e.message : String(e))
          setAbPeers([])
        }
      })()
    }
    if (tab === 'devices') {
      void accessibleDevices()
        .then((list) =>
          setDevices(
            list.map((d) => ({
              id: d.id,
              name: d.info?.device_name || d.id,
              sub: [d.id, d.info?.username, d.info?.os, d.device_group_name].filter(Boolean).join(' · '),
              platform: d.info?.os,
            })),
          ),
        )
        .catch((e: Error) => {
          setListError(e.message)
          setDevices([])
        })
    }
  }, [tab, user, props.revision])

  useEffect(() => {
    if (tab !== 'ab' || !user || !abGuid) return
    setAbPeers(null)
    void addressBookPeers(abGuid)
      .then(setAbPeers)
      .catch((e: Error) => {
        setListError(e.message)
        setAbPeers([])
      })
  }, [tab, user, abGuid, props.revision])

  const recent = recentPeers()
  const favs = favorites()

  const cards: PeerCardData[] | null = useMemo(() => {
    const fromRecord = (r: PeerRecord): PeerCardData => ({
      id: r.id,
      name: r.alias || r.hostname || r.id,
      sub: [r.alias || r.hostname ? r.id : '', r.username, r.platform].filter(Boolean).join(' · '),
      platform: r.platform,
      hostname: r.hostname,
      username: r.username,
      alias: r.alias,
    })
    if (tab === 'recent') return recent.map(fromRecord)
    if (tab === 'favorites') return favs.map((id) => fromRecord(recent.find((r) => r.id === id) ?? { id }))
    if (tab === 'ab')
      return abPeers?.map((p) => ({
        id: p.id,
        name: p.alias || p.hostname || p.id,
        sub: [p.alias || p.hostname ? p.id : '', p.username, p.platform].filter(Boolean).join(' · '),
        platform: p.platform,
        hash: p.hash || undefined,
      })) ?? null
    return devices
  }, [tab, recent, favs, abPeers, devices])

  const connect = (kind: 'remote' | 'file' | 'terminal', id = peerId, hash?: string) => {
    const clean = cleanPeerId(id)
    if (!clean) return
    app.open(kind, clean, { preset: hash ? { hash } : undefined })
  }

  return (
    <div class="home">
      <aside class="side">
        <section class="card">
          <h2>This browser</h2>
          <dl class="kv">
            <dt>ID server</dt>
            <dd title={server.idServer}>
              <span class={`dot ${server.idServer ? 'ok' : 'bad'}`} />
              {server.idServer || 'not configured'}
            </dd>
            <dt>Key</dt>
            <dd>{server.key ? 'configured' : 'none'}</dd>
            <dt>Video</dt>
            <dd>{hasWebCodecs() ? 'hardware decoding' : <span class="error-text">not supported by this browser</span>}</dd>
          </dl>
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn" onClick={app.openSettings}>
              <SettingsIcon size={16} /> Settings
            </button>
          </div>
        </section>

        <section class="card">
          <h2>Account</h2>
          {user ? (
            <>
              <p style={{ margin: '0 0 12px' }}>
                Signed in as <strong>{user.name}</strong>
              </p>
              <button
                class="btn"
                onClick={async () => {
                  await logout().catch(() => undefined)
                  setUser(null)
                  app.refreshHome()
                }}
              >
                <LogOut size={16} /> Sign out
              </button>
            </>
          ) : (
            <>
              <p class="muted" style={{ margin: '0 0 12px' }}>
                Sign in to see your address book and devices.
              </p>
              <button class="btn" onClick={app.openAccount}>
                <LogIn size={16} /> Sign in
              </button>
            </>
          )}
        </section>
      </aside>

      <main class="main">
        <section class="card">
          <h2>Control remote desktop</h2>
          <form
            class="connect-row"
            onSubmit={(e) => {
              e.preventDefault()
              connect('remote')
            }}
          >
            <input
              placeholder="Remote ID"
              value={peerId}
              autoFocus
              onInput={(e) => setPeerId((e.currentTarget as HTMLInputElement).value)}
              aria-label="Remote ID"
            />
            <button class="btn primary" type="submit" disabled={!cleanPeerId(peerId)}>
              <Monitor size={16} /> Connect
            </button>
            <button class="btn" type="button" disabled={!cleanPeerId(peerId)} onClick={() => connect('file')}>
              <FolderOpen size={16} /> Files
            </button>
            <button class="btn" type="button" disabled={!cleanPeerId(peerId)} onClick={() => connect('terminal')}>
              <SquareTerminal size={16} /> Terminal
            </button>
          </form>
        </section>

        <section class="card" style={{ flex: 1 }}>
          <div class="row">
            <div class="segmented" role="tablist">
              {(['recent', 'favorites', 'ab', 'devices'] as ListTab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} class={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {{ recent: 'Recent', favorites: 'Favorites', ab: 'Address book', devices: 'Devices' }[t]}
                </button>
              ))}
            </div>
            <div class="spacer" />
            {tab === 'ab' && abBooks.length > 1 && (
              <select value={abGuid} onChange={(e) => setAbGuid((e.currentTarget as HTMLSelectElement).value)} style={{ marginBottom: 12 }}>
                {abBooks.map((b) => (
                  <option key={b.guid} value={b.guid}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {listError && <p class="error-text">{listError}</p>}
          {(tab === 'ab' || tab === 'devices') && !user ? (
            <div class="empty">
              <p>Sign in to see this list.</p>
              <button class="btn" onClick={app.openAccount}>
                <LogIn size={16} /> Sign in
              </button>
            </div>
          ) : cards === null ? (
            <div class="empty">Loading…</div>
          ) : cards.length === 0 ? (
            <div class="empty">{tab === 'recent' ? 'Devices you connect to will appear here.' : 'Nothing here yet.'}</div>
          ) : (
            <div class="peer-grid">
              {cards.map((c) => (
                <PeerCard
                  key={c.id}
                  peer={c}
                  favorite={favs.includes(c.id)}
                  removable={tab === 'recent'}
                  onAddToAddressBook={
                    user && (tab === 'recent' || tab === 'favorites')
                      ? async () => {
                          try {
                            const guid = await personalAddressBook()
                            await addPeerToAddressBook(guid, {
                              id: c.id,
                              alias: c.alias,
                              hostname: c.hostname,
                              username: c.username,
                              platform: c.platform,
                              hash: savedPassword(c.id) ?? undefined,
                              tags: [],
                            })
                            setListError('')
                            setTab('ab')
                          } catch (e) {
                            setListError(e instanceof Error ? e.message : String(e))
                          }
                        }
                      : undefined
                  }
                  onConnect={(kind) => connect(kind, c.id, c.hash)}
                  onToggleFavorite={() => {
                    setFavorite(c.id, !favs.includes(c.id))
                    setTick((t) => t + 1)
                  }}
                  onRemove={() => {
                    forgetPeer(c.id)
                    setTick((t) => t + 1)
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function PeerCard(props: {
  peer: PeerCardData
  favorite: boolean
  removable: boolean
  onAddToAddressBook?: () => void
  onConnect: (kind: 'remote' | 'file' | 'terminal') => void
  onToggleFavorite: () => void
  onRemove: () => void
}) {
  const [menu, setMenu] = useState(false)
  const stop = (e: Event) => e.stopPropagation()
  return (
    <div class="peer" onClick={() => props.onConnect('remote')} title={`Connect to ${props.peer.id}`}>
      <div class="avatar">
        <Monitor size={20} />
      </div>
      <div class="info">
        <div class="name">{props.peer.name}</div>
        <div class="sub">{props.peer.sub || props.peer.id}</div>
      </div>
      <div class="actions" onClick={stop}>
        <button class={props.favorite ? 'on' : ''} title={props.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={props.onToggleFavorite}>
          <Star size={16} fill={props.favorite ? 'currentColor' : 'none'} />
        </button>
        <button title="More" onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      {menu && (
        <div class="menu" style={{ top: 44, right: 6, background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border)' }} onClick={stop} onMouseLeave={() => setMenu(false)}>
          <button class="btn" style={{ border: 'none' }} onClick={() => props.onConnect('remote')}>
            <Monitor size={16} /> Connect
          </button>
          <button class="btn" style={{ border: 'none' }} onClick={() => props.onConnect('file')}>
            <FolderOpen size={16} /> Transfer files
          </button>
          <button class="btn" style={{ border: 'none' }} onClick={() => props.onConnect('terminal')}>
            <SquareTerminal size={16} /> Terminal
          </button>
          {props.onAddToAddressBook && (
            <button
              class="btn"
              style={{ border: 'none' }}
              onClick={() => {
                setMenu(false)
                props.onAddToAddressBook?.()
              }}
            >
              <BookPlus size={16} /> Add to address book
            </button>
          )}
          {props.removable && (
            <button class="btn danger" style={{ border: 'none' }} onClick={props.onRemove}>
              <Trash2 size={16} /> Remove from recent
            </button>
          )}
        </div>
      )}
    </div>
  )
}
