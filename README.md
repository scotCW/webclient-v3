# webclient-v3

A browser client for self-hosted servers compatible with
[RustDesk](https://rustdesk.com) (hbbs/hbbr), designed to be served by
[rustdesk-api](https://github.com/scotCW/rustdesk-api).

It is written from scratch and released into the public domain under the
[Unlicense](LICENSE). It contains no code from RustDesk or from other web
clients; the protocol schema in `src/proto` declares only the messages this
client uses, matching the servers' field numbers so the two interoperate.
Bundled third-party packages keep their own (permissive) licences, listed in
`THIRD-PARTY-LICENSES.txt` next to each build.

This project is not affiliated with or endorsed by RustDesk. "RustDesk" is used
only to describe what the client is compatible with.

## Features

- Sign-in required (password or OIDC through the account API); server settings
  come from the API after sign-in. Share links open a single device without an
  account.
- End-to-end encrypted sessions through the relay over WebSocket (wss via a
  reverse proxy at `/ws/id` and `/ws/relay`).
- Remote control: hardware video decoding with WebCodecs (VP9, AV1, H.264,
  H.265, VP8), Opus audio, mouse, keyboard, clipboard, chat, multiple
  displays, quality, codec, FPS and resolution, Ctrl+Alt+Del, lock, privacy
  mode, restart and elevation.
- File manager with uploads (files, folders, drag and drop) and downloads.
- Terminal (xterm.js) for peers that support it.
- Address books, accessible devices, recent and favourite peers.

## Requirements

A Chromium-based browser, Safari 17+ or Firefox 130+ (WebCodecs). The page must
be served over https for clipboard access and wss.

## Development

```sh
npm ci
API_TARGET=https://your-api.example.com npm run dev   # proxies /api and /webclient-config
npm test
npm run build                                         # dist/
```

The build uses relative paths, so `dist/` can be served from any sub-path.
rustdesk-api serves it at `/webclient/`.
