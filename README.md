# Nebula Music for Stream Deck

A Stream Deck and Stream Deck+ plugin for controlling the active
[Nebula Music](https://github.com/lilremark/Nebula-Music) browser tab. It provides live
artwork and playback progress, transport controls, seeking, volume, and playlist launching without
turning the plugin into a second Subsonic client.

Download the current installer from the
[latest GitHub release](https://github.com/lilremark/nebula-music-stream-deck-plugin/releases/latest).

## Requirements

- Stream Deck 7.1 or newer
- Windows 10+ or macOS 13+
- A Nebula Music build with the opt-in Stream Deck bridge
- Node.js 24 for development

## Pairing

1. Add and select the **Connection** action in Stream Deck.
2. Generate a six-digit pairing code in the Connection property inspector.
3. In Nebula Music, enable the Stream Deck bridge and enter the code.
4. Keep the default endpoint, `ws://127.0.0.1:37921/nebula/v1`, unless the property inspector shows
   a fallback port.

Codes are single-use, expire after five minutes, and are throttled per browser client and globally.
The resulting 256-bit token is stored in Stream Deck global settings and Nebula's IndexedDB. After
the initial exchange it never crosses the socket: reconnects prove possession through a single-use
HMAC-SHA256 challenge. Connections are accepted only on IPv4 loopback and the claimed Nebula origin
must match the browser's WebSocket Upgrade origin. Subsonic credentials, authenticated artwork
URLs, and queues are never sent to this plugin.

When several Nebula tabs are connected, selection priority is a manually pinned tab, a playing tab,
a visible and recently active tab, then the newest connection.

## Actions

- **Now Playing:** the display-only key uses the album cover as its full background with title,
  artist, and album metadata. Long metadata scrolls automatically. On Stream Deck+, rotate to seek,
  tap the progress strip to scrub to an absolute position, and press the dial to play/pause.
- **Play / Pause:** two-state key with explicit states in Multi Actions.
- **Previous / Next:** Nebula's native queue navigation behavior.
- **Volume:** key percentage and mute toggle; on Stream Deck+ rotate by 2%, tap the strip to set an
  absolute value, and press to mute/restore.
- **Speed & Pitch:** Stream Deck+ dial for speed, pitch, or both; press to switch between digital
  independent control and analogue vinyl-style behavior.
- **Playlist:** choose a live playlist in the property inspector, then press to replace the queue and
  play it.
- **Playlist Browser:** rotate through playlists on Stream Deck+, then press or tap to play.
- **Connection:** shows connection state and generates a pairing code when pressed.

## Development

```sh
npm ci
npm run check
npm run validate
npm run pack:dry
```

`npm run build` bundles the plugin to
`com.lilremark.nebula-music.sdPlugin/bin/plugin.js` and generates the required PNG plugin icons.
`npm run dev` watches TypeScript sources. `npm run preview:ui` renders a key-image contact sheet to
`dist/ui-preview.png`. The committed plugin directory is validated and packed by the official Stream
Deck CLI.

The browser-side contract is documented in [docs/protocol.md](docs/protocol.md).

## Local installation

With the Stream Deck desktop application installed and running, create a developer link and restart
the plugin:

```sh
npm ci
npm run install:local
```

The link points Stream Deck at this checkout, so subsequent `npm run build` commands update the
local test installation. Use `npm run dev` while actively editing the plugin.

To create a standalone installer instead, run:

```sh
npm ci
npm run package:local
```

Then open `dist/com.lilremark.nebula-music.streamDeckPlugin` and approve the installation in Stream
Deck. The `--force` packaging option makes the command repeatable when an older local package
already exists.

## Releases

Releases are tagged from commits already merged to `main`. A stable tag such as `v1.1.4` must
match `package.json` `1.1.4` and manifest `1.1.4.0`. GitHub Actions runs the full validation suite,
packages the `.streamDeckPlugin`, generates a SHA-256 checksum and build-provenance attestation,
then publishes the GitHub release. SemVer tags containing a hyphen are published as prereleases.
