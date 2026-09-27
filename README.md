# AUREX MEET

A free, self-hostable, Google Meet-style video meeting website built on the browser's
own WebRTC stack. A small Node.js WebSocket server introduces participants to each
other; audio and video then travel **directly between browsers**.

- No accounts, no sign-ups, no authentication.
- No external AI services, no meeting/video SDKs, no paid APIs.
- No meeting timer and no hard-coded participant cap.
- No media ever touches the application server.
- No fake participants, no simulated video, no placeholder buttons.

---

## Table of contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Technologies](#3-technologies)
4. [Folder structure](#4-folder-structure)
5. [Local installation](#5-local-installation)
6. [Running the client](#6-running-the-client)
7. [Running the server](#7-running-the-server)
8. [Creating a meeting](#8-creating-a-meeting)
9. [Joining a meeting](#9-joining-a-meeting)
10. [Browser permissions](#10-browser-permissions)
11. [How WebRTC is used](#11-how-webrtc-is-used)
12. [How the WebSocket signaling works](#12-how-the-websocket-signaling-works)
13. [Available features](#13-available-features)
14. [Configuration](#14-configuration)
15. [Health endpoint](#15-health-endpoint)
16. [Testing](#16-testing)
17. [Troubleshooting](#17-troubleshooting)
18. [Deployment basics](#18-deployment-basics)
19. [Known limitations](#19-known-limitations)

---

## 1. Overview

AUREX MEET is a meeting application you host yourself. Someone opens your URL, clicks
**New meeting**, copies the link and sends it to other people. Each participant grants
camera and microphone access once, and then the browsers connect to each other
peer-to-peer.

The signaling server is deliberately small. It stores room metadata in memory and
nothing else: who is in a room, who the host is, who is muted, who is presenting. It
never sees or records a media stream.

---

## 2. Architecture

```
┌──────────────┐   offer / answer / ICE     ┌──────────────┐   offer / answer / ICE
│  Browser A   │ ─────────────────────────▶ │  Browser B   │
│  (React +    │ ◀───────────────────────── │  (React +    │
│   WebRTC)    │      direct media (SRTP)   │   WebRTC)    │
└──────┬───────┘ ◀════════════════════════▶ └──────┬───────┘
       │                                             │
       │  join / leave / chat / media state / host   │
       │  commands  (JSON over WebSocket)             │
       ▼                                             ▼
            ┌──────────────────────────────────┐
            │  Signaling server (Node + ws)     │
            │  rooms, presence, host authority, │
            │  chat relay, validation           │
            └──────────────────────────────────┘
```

**Data paths**

| Path | Transport | Notes |
| --- | --- | --- |
| Meeting description (SDP) | WebSocket, relayed | Small, only during setup and renegotiation |
| ICE candidates | WebSocket, relayed | Trickle ICE, queued until the remote description arrives |
| Audio + video | **Direct browser-to-browser (WebRTC)** | Never passes through the server |
| Chat, presence, host commands | WebSocket, relayed | Room-scoped, validated, rate limited |
| Room state | Server memory only | Discarded when the last participant leaves |

**Why P2P, and where an SFU would slot in.** The WebRTC layer is a separate service
(`client/src/services/webrtc/`) that speaks only in terms of participant ids, streams
and media state. `PeerManager` owns every `RTCPeerConnection`. If a room outgrows what
a single host can upload, an SFU can replace `PeerManager` without touching a single
UI component. No SFU is included, and none is needed for normal use.

---

## 3. Technologies

| Layer | Choice | Why |
| --- | --- | --- |
| Server runtime | Node.js 18.17+ (ESM) | Zero-cost, runs anywhere |
| Server HTTP | Express | `/health` and optional static SPA hosting |
| Server realtime | `ws` | The de-facto minimal WebSocket library |
| Client build | Vite 5 | Fast dev server with a built-in WS proxy |
| Client UI | React 18 + React Router 6 | Small, explicit, no UI framework to fight |
| Styling | Hand-written CSS ("Ivory Ink") | No CSS framework, full control, tiny bundle |
| Media | Native `getUserMedia`, `getDisplayMedia`, `RTCPeerConnection` | No third-party media code |

Runtime dependencies in total: `express`, `cors`, `ws`, `react`, `react-dom`,
`react-router-dom`. There is no database, no message broker, no cloud SDK and no
telemetry.

---

## 4. Folder structure

```
Meeting/
├── client/                         React + Vite single-page app
│   ├── index.html
│   ├── vite.config.js              dev proxy for /ws and /api
│   ├── public/favicon.svg
│   └── src/
│       ├── main.jsx                entry point
│       ├── App.jsx                 routes: / /create /join /meeting/:meetingId
│       ├── config.js               protocol constants + shared enums
│       ├── context/
│       │   └── MeetingContext.jsx  single MeetingSession + React mirror
│       ├── services/
│       │   ├── signaling/
│       │   │   └── SignalingClient.js   socket, status, backoff, resume
│       │   ├── webrtc/
│       │   │   ├── PeerLink.js          one RTCPeerConnection + recovery
│       │   │   ├── PeerManager.js       all connections, keyed by participant id
│       │   │   ├── mediaDevices.js      getUserMedia / display / devices
│       │   │   ├── quality.js           getStats() -> user-facing quality
│       │   │   └── rtcConfig.js         ICE servers (empty by default)
│       │   └── session/
│       │       ├── MeetingSession.js    the orchestrator
│       │       └── identity.js          per-tab resume token (sessionStorage)
│       ├── components/
│       │   ├── MeetingView.jsx    active room
│       │   ├── PreJoin.jsx        name + device preview
│       │   ├── ParticipantTile.jsx  one reusable tile
│       │   ├── VideoGrid.jsx      adaptive grid
│       │   ├── PresentationStage.jsx  shared-screen layout
│       │   ├── VideoSurface.jsx   stream -> <video>
│       │   ├── ui/index.jsx       buttons, fields, modal, switch, callout
│       │   ├── icons.jsx          inline SVG icon set
│       │   └── meeting/           control bar, side panel, chat, participants,
│       │                          settings, host controls, waiting room
│       ├── pages/                 Home, Create, Join, Meeting, NotFound
│       ├── hooks/                 (reusable hooks live beside their consumers)
│       ├── utils/                 ids, errors, initials, logger, meetingUrl
│       └── styles/                tokens, base, components, landing, meeting,
│                                  panels, responsive
│   └── package.json
│
├── server/                         Node.js signaling + room server
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── server.js              express app, http server, graceful shutdown
│   │   ├── config.js              env parsing
│   │   ├── rooms/
│   │   │   ├── Room.js            per-room state
│   │   │   └── RoomManager.js     room table, resume tokens, sweeping
│   │   ├── signaling/
│   │   │   ├── index.js           transport: framing, heartbeat, rate limits
│   │   │   ├── handlers.js        all protocol logic
│   │   │   ├── protocol.js        canonical message names
│   │   │   └── rateLimiter.js     fixed-window counters
│   │   └── utils/                 logger, ids, errors, validate, env
│   └── test/protocol.test.js      19 integration tests over the real protocol
│
├── package.json                    workspace scripts (dev / build / start / test)
└── README.md
```

---

## 5. Local installation

Requirements: **Node.js 18.17 or newer** and a modern browser
(Chrome, Edge, Firefox, or Safari 15+).

```bash
git clone <your-repo> Meeting
cd Meeting
npm run setup
```

`npm run setup` installs the root dev tooling plus the `client` and `server`
dependencies. To do it by hand:

```bash
npm install                  # root (concurrently)
npm install --prefix server
npm install --prefix client
```

Optional: copy `server/.env.example` to `server/.env` and
`client/.env.example` to `client/.env`. Every value has a working default, so this
is only needed when you change ports or self-host behind a domain.

---

## 6. Running the client

```bash
npm run dev:client        # or: npm run dev --prefix client
```

- URL: <http://localhost:5173>
- The Vite dev server proxies `/ws` (signaling), `/api` and `/health` to
  `http://127.0.0.1:4000`, so the browser always talks to a single origin.
- Change the proxy target with `SIGNALING_PROXY_TARGET=http://host:port` in
  `client/.env`.

Production build:

```bash
npm run build              # writes client/dist
```

## 7. Running the server

```bash
npm run dev:server         # node --watch, restarts on change
# or
npm run start              # plain node
```

- HTTP: <http://localhost:4000>
- WebSocket: `ws://localhost:4000/ws`
- When `client/dist` exists and `SERVE_CLIENT=true` (the default), the same server
  also serves the built SPA, so production is a single process.

## 8. Creating a meeting

1. Open the app and click **New meeting** (or go to `/create`).
2. Enter a display name and check the camera/microphone preview.
3. Click **Create meeting**.

The server mints a room ID from 12 characters of a 30-symbol alphabet using
`crypto.randomBytes`, so IDs are unguessable and never sequential. You land in the
meeting with a card showing the meeting ID and the full shareable link
(`http://localhost:5173/meeting/<id>`) plus a working **Copy link** button.

The creator becomes the **host**; the server records that fact. No client can claim
host status.

## 9. Joining a meeting

Either:

- click **Join with a link** and paste a meeting ID or a full meeting URL
  (`https://…/meeting/abc234jkmnpq` also works), or
- open the shared link directly.

Enter a display name (2–48 characters), check your devices, then **Join meeting**.
Errors are explicit: unknown meeting, invalid ID, locked meeting, invalid name.

The display name is kept in `sessionStorage` for the current tab only. It is not an
account and it is not shared with anyone except the other participants in the room.

## 10. Browser permissions

AUREX MEET needs `getUserMedia`. The browser asks once per origin.

| Permission | Consequence of refusal |
| --- | --- |
| Microphone | You join muted and can listen. Chat and video still work. |
| Camera | Your tile shows a generated initials avatar. You can enable it later from the control bar or Settings. |
| Screen capture | Only needed when you click **Share screen**; refusal cancels cleanly. |

Refusals are detected, explained in plain language, and recoverable: turning the
microphone or camera on later re-requests just that device.

**Screen sharing is always subject to the browser.** The app never captures a screen
without an explicit user action and never attempts to work around browser security.

## 11. How WebRTC is used

- **One `RTCPeerConnection` per remote participant**, stored in a `Map` keyed by
  participant id — never by array index, so joins and leaves can never desynchronise
  the grid.
- **Perfect negotiation.** Which side is "polite" is derived from a deterministic id
  comparison, so glare is resolved without bookkeeping and both join orders work.
- **Stable transceivers.** An `sendrecv` audio and video transceiver is created up
  front, even when the local track is missing. A participant who joins with no camera
  can switch devices later with `replaceTrack()` and no renegotiation.
- **Trickle ICE with queuing.** Candidates that arrive before the remote description
  are queued and flushed in order; invalid or duplicated candidates are discarded
  instead of breaking the connection.
- **Bounded recovery.** `disconnected` gets an 8-second grace period, then an ICE
  restart, then at most one controlled rebuild. There is no unbounded retry loop.
- **Real statistics.** `getStats()` is sampled every 2.5 s per connection and turned
  into Excellent / Good / Unstable / Poor / Reconnecting with hysteresis. When the
  browser has not reported enough data the state is "Checking connection" — never a
  guess.
- **Switching devices and muting never rebuild a connection.** `RTCRtpSender.replaceTrack()`
  is used throughout.
- **Screen sharing reuses the video sender track.** The camera track is remembered and
  restored, and the previous camera on/off state is preserved.

## 12. How the WebSocket signaling works

Client → server:

| Type | Purpose |
| --- | --- |
| `create-room` | Mint a room, join as host |
| `join-room` | Join a room (optionally with a resume token) |
| `leave-room` | Leave and release server state |
| `offer` / `answer` / `ice-candidate` | Relayed WebRTC handshake, addressed with `to` |
| `media-state-changed` | Microphone / camera state |
| `screen-share-state-changed` | Presenting state (single presenter enforced) |
| `hand-state-changed` | Raised hand |
| `chat-message` | Room-scoped chat |
| `mute-request`, `remove-participant`, `lock-room`, `set-waiting-room`, `admit-participant`, `deny-participant`, `transfer-host`, `end-meeting` | Host commands, all validated server-side |
| `ping` | Liveness |

Server → client mirrors this with `room-created`, `room-joined`, `room-state`,
`participant-joined`, `participant-left`, `room-settings-changed`, `host-changed`,
`waiting-room-state`, `waiting-room-updated`, `meeting-ended`, `participant-removed`,
`media-state-changed`, `screen-share-state-changed`, `hand-state-changed`,
`chat-message`, `chat-system`, `offer`, `answer`, `ice-candidate`, `room-error`, `pong`.

**Reconnection.** A dropped socket retries with exponential backoff and jitter
(≈0.6 s → 8 s), pauses while the browser is offline and stops permanently on an
intentional leave. On reconnect the client rejoins the *same* room with a
server-issued resume token, so a refresh or a short network drop does not create a
duplicate participant. The token is single-use and expires after `RESUME_TTL_MS`.

**Dead connection cleanup.** The server pings every connection on an interval and
terminates any socket that misses two beats, then removes the participant, notifies the
room and elects a new host if needed.

**Validation.** Every message is checked for type, size, room membership, target
existence, host permission and payload shape. Malformed frames are answered with a
structured `room-error` and never crash the server. `participantId`, `host` and room
membership are always determined by the server, never by the client.

## 13. Available features

**Meetings**
- Create / join / leave, shareable link, working copy-link with confirmation
- Display name, no accounts, per-tab only
- Dynamic video grid that adapts to participant count and viewport (1 → 40+)
- Pin a participant, full screen for any tile
- Reconnection, offline detection, reconnecting / unstable / poor-quality states

**Media**
- Microphone and camera toggles that stay in sync for everyone
- Camera / microphone / speaker device selection via `enumerateDevices()`
- Device switching with `replaceTrack()` (no reconnect, no rejoin)
- Screen sharing with presentation mode, filmstrip, pin and full screen
- Tab/system audio forwarded when the browser offers it, without duplicating mic audio
- Browser's own "Stop sharing" control is honoured; camera state is restored
- Handful of keyboard shortcuts: `M` mute, `V` camera (ignored while typing)

**Collaboration**
- In-meeting chat (Enter to send, Shift + Enter for a newline, unread badge, system
  notices for joins/leaves/host changes, plain-text rendering only)
- Participants panel with live mic / camera / presenting / hand state
- Raise hand
- Reusable side panel (desktop) / bottom sheet (mobile)

**Host controls** (server-validated, never client-trusted)
- Host indicator and deterministic host transfer to the earliest remaining participant
- Ask a participant to mute (a request, not a forced hardware change — see limitations)
- Remove a participant
- Lock / unlock the meeting
- Enable / disable the waiting room, admit or deny waiting participants
- Transfer the host role
- End the meeting for everyone, with confirmation

**Platform**
- "Ivory Ink" design system, hand-written CSS, no UI framework
- Responsive down to phone widths with no horizontal scrolling
- Accessible controls: labels on every icon button, focus states, `aria-live`
  regions, Escape to close panels and dialogs, `prefers-reduced-motion` respected
- No meeting timer, no participant cap, no external services

## 14. Configuration

**Server** — `server/.env` (see `server/.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `CORS_ORIGINS` | localhost:5173 | Comma-separated allowed origins |
| `WS_PATH` | `/ws` | WebSocket path |
| `MAX_MESSAGE_BYTES` | `32768` | Largest accepted frame |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Ping interval; two misses = reap |
| `MAX_CONNECTIONS_PER_IP` | `64` | Per-IP connection cap |
| `RATE_LIMIT_MAX_MESSAGES` | `400` | Messages per 10 s per connection |
| `RATE_LIMIT_CHAT_MAX` | `40` | Chat messages per 10 s per connection |
| `MAX_NAME_LENGTH` / `MIN_NAME_LENGTH` | `48` / `2` | Display name bounds |
| `ROOM_ID_LENGTH` | `12` | Meeting ID length |
| `CHAT_MAX_LENGTH` | `2000` | Longest chat message |
| `RESUME_TTL_MS` | `90000` | How long a dropped participant may resume |
| `ROOM_TTL_MS` | `60000` | Grace period for an empty room |
| `SERVE_CLIENT` | `true` | Serve `client/dist` when present |

**Client** — `client/.env` (see `client/.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_SIGNALING_URL` | same origin `/ws` | Explicit WebSocket URL |
| `VITE_PUBLIC_ORIGIN` | `window.location.origin` | Base for shareable links |
| `VITE_ICE_SERVERS` | `[]` | JSON array of STUN/TURN entries |
| `VITE_DEBUG` | `false` | Verbose client logging |

Only `VITE_`-prefixed variables reach the browser. **Never put a secret in a client
environment variable** — everything there is public. This project has no secrets and
no authentication to configure.

### ICE servers and TURN

Out of the box the app uses **no ICE servers**: host and server-reflexive-free
candidates on localhost and a LAN are enough, and you keep zero third-party
dependencies. If you self-host across the internet, symmetric NATs will need a STUN
or TURN server. Supply your own — the app will never silently add a paid provider:

```bash
# client/.env
VITE_ICE_SERVERS=[{"urls":["stun:stun.example.org:3478"]},{"urls":["turn:turn.example.org:3478","username":"you","credential":"secret"}]
```

## 15. Health endpoint

```
GET /health        (also /api/health)
```

```json
{
  "status": "ok",
  "service": "aurex-meet-signaling",
  "uptimeSeconds": 412,
  "signalingPath": "/ws",
  "connections": 3,
  "rooms": 1,
  "participants": 2,
  "waiting": 0
}
```

Useful for a reverse-proxy health check. It exposes counts only — no room contents,
no participant names.

## 16. Testing

The server ships with integration tests that drive the real WebSocket protocol
against a real HTTP server — no mocks, no fake participants.

```bash
npm test          # node --test, in server/
```

19 tests covering room creation, joining, presence, chat validation and isolation,
WebRTC relay validation, host-authority enforcement, the waiting room, meeting lock,
automatic host transfer, single-presenter enforcement, identity resume across a
refresh, oversized frames, rate limiting, room-ID unpredictability and empty-room
cleanup.

The client has a production build you can use as a static check:

```bash
npm run build
```

Manual multi-browser testing: open the app in two or more browser windows, create a
meeting in one, join from the others, and exercise the controls. Use
`chrome://webrtc-internals` if you need to inspect a peer connection.

## 17. Troubleshooting

**"Could not reach the meeting server"**
The signaling server is not running or the URL is wrong. Start it with
`npm run dev:server` and confirm <http://localhost:4000/health> returns `status: ok`.

**Camera or microphone blocked**
Use the camera icon in the address bar to allow access, then reload. On macOS also
check System Settings → Privacy & Security → Camera and Microphone.

**"No camera was found" but you have one**
Another app may hold it. Close video-conferencing apps and retry. In Settings you can
pick a different device.

**Somebody joins but stays grey / connecting forever**
Their peer connection is not completing. This is usually NAT. Add a STUN/TURN server
via `VITE_ICE_SERVERS` (see above) and reload the client.

**Two tiles for the same person after a refresh**
Should not happen: refreshes resume the same participant id. If you see it, capture
the server log around the time — the room-state reconciliation is authoritative and
the test suite covers this path.

**Everything is blank after `npm run build`**
The SPA needs history fallback for deep links. `server` does this automatically when
`client/dist` exists and `SERVE_CLIENT=true`. Confirm the build output is in
`client/dist` and restart the server.

**Blank page, console shows a module error**
A stale Vite cache. Stop the dev server, delete `client/node_modules/.vite` and run
`npm run dev:client` again.

**Port already in use**
Change `PORT` in `server/.env`, and point the client proxy at it with
`SIGNALING_PROXY_TARGET` in `client/.env`.

**I want to see what the server is doing**
Set `LOG_LEVEL=debug`. Logs are structured and never contain message bodies, media or
anything private.

## 18. Deployment basics

**Single process (simplest)**

```bash
npm run setup
npm run build            # builds client/dist
NODE_ENV=production PORT=4000 npm start
```

Put a TLS reverse proxy in front of it so the app is served over `https` — browsers
require a secure context for `getUserMedia` on any non-localhost origin.

```nginx
server {
  listen 443 ssl http2;
  server_name meet.example.com;

  ssl_certificate     /etc/letsencrypt/live/meet.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/meet.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }
}
```

**Notes**
- WebSocket upgrade support (`Upgrade`/`Connection` headers) is mandatory.
- For multi-instance deployments, room state is per-process, so all participants of a
  meeting must reach the same instance. Use a sticky-session load balancer, or move
  rooms into shared storage and a pub/sub layer.
- Add your own STUN/TURN via `VITE_ICE_SERVERS` and rebuild the client.
- `CORS_ORIGINS` only matters when the client is served from a different origin.

## 19. Known limitations

These are real constraints, not bugs to be papered over.

1. **P2P bandwidth is the ceiling.** There is no meeting timer and no hard-coded
   participant cap, but each participant uploads their stream once per peer. WebRTC
   P2P performance therefore depends on participants' devices, browsers, networks and
   bandwidth. Roughly, a room stays comfortable for a small team on normal broadband;
   a dozen simultaneous HD video streams from one laptop will not work. There is no
   artificial software limit here — the limit is the hardware and network you already
   have. An SFU is the architectural answer, and `PeerManager` is the seam for it.
2. **Symmetric NAT needs TURN.** Direct P2P cannot traverse every network. Some
   restrictive corporate, mobile or multi-NAT setups will only connect through a TURN
   server. None is bundled or auto-configured, because that would mean depending on a
   third-party service. Supply your own with `VITE_ICE_SERVERS`.
3. **A host cannot forcibly mute anyone.** Web browsers do not let a website switch off
   another person's microphone. "Ask to mute" sends a request; the participant's own
   browser then disables the track. This is a security boundary, not a missing feature.
4. **No end-to-end protection from the host's browser.** Media is encrypted in
   transit (DTLS-SRTP) and the server never sees it, but in P2P every participant
   connects to every other participant.
5. **Server restart drops signaling, not necessarily media.** If the signaling server
   restarts, existing WebRTC connections often keep working, but the client cannot
   re-sync room state until the server is back. It reconnects with backoff and
   rejoins automatically. Do not expect an in-progress meeting to be fully
   server-independent.
6. **No recording, no transcription, no AI features.** Deliberately: they would need
   external services and the brief excludes them.
7. **State is in memory only.** Restarting the server ends all meetings. Nothing is
   persisted, and no chat history outlives the room.
8. **No authentication.** Anyone with a valid meeting link can join while the room is
   open. Host controls (lock, waiting room) are the access mechanism.
9. **Best on Chromium and Firefox.** Safari 15+ works, but device switching and
   tab-audio during screen sharing are less consistent. Output-device selection needs
   `HTMLMediaElement.setSinkId()` and is hidden gracefully when unsupported.

---

## License

MIT. Use it, host it, change it.
