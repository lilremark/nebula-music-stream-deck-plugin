# Browser Bridge Protocol

The bridge is a JSON WebSocket protocol identified by `nebula-streamdeck/1`. The plugin listens on
IPv4 loopback at `/nebula/v1`, beginning at port `37921` and trying the next nine ports if needed.
Text messages are limited to 512 KiB; binary, malformed, oversized, unauthenticated, and incompatible
messages are rejected. The `hello.origin` value must exactly equal the normalized HTTP(S) `Origin`
header from the WebSocket Upgrade. The plugin caps unauthenticated connections globally and per
origin, closes them on an authentication deadline, and evicts authenticated sessions that send
nothing for approximately 45 seconds.

## Session lifecycle

1. Browser sends `hello` with stable `clientId`, per-tab `sessionId`, origin, Nebula version,
   visibility, and activity time. Plugin returns an `authChallenge` with a random 32-byte base64url
   nonce.
2. A new client sends `pair` with the code shown by Stream Deck. The plugin returns `pairingResult`
   containing a random 32-byte base64url token exactly once, then rotates and sends a fresh
   `authChallenge`.
3. On this and later connections, the browser computes an HMAC proof and sends `authenticate`. On
   success the plugin returns `pairingResult { ok: true }` and `requestSnapshot`. A challenge nonce
   is single-use; a failed proof returns `unauthorized` and a new challenge.
4. Browser sends a full `state`, sends `progress` at most once per second, and sends `heartbeat` at
   least every 15 seconds as well as immediately when visibility/activity changes. Send compressed
   256×256 artwork as a `data:image/...;base64` value only when the track changes; the plugin retains
   cached artwork when later snapshots for the same track omit it.
5. Plugin sends `command` with a unique `requestId`. Browser invokes the existing Nebula store,
   then returns `commandResult` with the same identifier.
6. To forget the pairing from Nebula, an authenticated browser sends `revoke`. The plugin removes
   and persists the credential, returns `revocationResult`, then closes the connection.

Every message contains `"protocol": "nebula-streamdeck/1"` and a discriminating `type`.

## Browser messages

- `hello`: `sessionId`, `clientId`, `origin`, `nebulaVersion`, `visible`, `lastActiveAt`
- `pair`: `clientId`, `code`
- `authenticate`: `clientId`, `proof`
- `revoke`: `clientId`
- `state`: `snapshot`
- `progress`: `sessionId`, `positionSeconds`, `durationSeconds`, `playing`
- `commandResult`: `requestId`, `ok`, optional structured `error`
- `heartbeat`: `sessionId`, `visible`, `lastActiveAt`

### Authentication proof

Decode the stored base64url token to its original 32 bytes and use it as the HMAC-SHA256 key. The
message is the UTF-8 encoding of this exact transcript, with LF (`0x0A`) separators and no trailing
newline:

```text
nebula-streamdeck/1
authenticate
<clientId>
<sessionId>
<nonce>
```

Encode the 32-byte digest as unpadded base64url; `proof` is therefore 43 characters. The nonce is
also an unpadded 43-character base64url value. The stored token is transmitted only in the successful
initial `pairingResult`, never in `authenticate`.

A snapshot contains session/client identity, origin/version/activity fields, playback state, position,
duration, normalized volume, mute state, optional track metadata/artwork, and playlist summaries.
It must not contain the full queue, Subsonic credentials, server tokens, or authenticated media URLs.

## Plugin messages and commands

- `pairingResult`: `ok`, with a token on first success or an error code on failure
- `authChallenge`: `nonce`
- `revocationResult`: `ok`
- `requestSnapshot`
- `command`: `requestId` and one of:
  - `setPlayback { playing }`
  - `togglePlayback`
  - `previous`
  - `next`
  - `setVolume { volume }`, normalized from 0 to 1
  - `seekRelative { seconds }`
  - `startPlaylist { playlistId }`

Command errors are `unauthorized`, `disconnected`, `stale_playlist`, `empty_playlist`,
`playback_failed`, `invalid_command`, or `internal_error`.

For `startPlaylist`, the browser loads the complete playlist through Nebula's existing data layer,
replaces the queue, and starts the first track. It returns `empty_playlist` rather than changing the
queue when no tracks exist.
