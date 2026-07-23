# ADR 0002: Pairing and local security

## Status

Accepted

## Decision

Listen only on `127.0.0.1`, accept only `/nebula/v1`, and require a versioned JSON protocol. Pair
with a random six-digit, single-use code valid for five minutes. Throttle attempts per client and
globally, then exchange the code for a random 32-byte token. Persist the token in Stream Deck global
settings and Nebula IndexedDB. On reconnect, prove token possession with HMAC-SHA256 over a
single-use 32-byte challenge and a transcript binding protocol, client, session, and nonce; never
send the stored token again.

Bind the claimed browser identity to the HTTP Upgrade Origin, cap pending connections globally and
per origin, time out unauthenticated clients, and evict authenticated clients that stop sending
heartbeats. Reject binary, malformed, oversized, incompatible, and unauthenticated traffic. Do not
log codes, tokens, track metadata, origins, ports, or server details. Persist browser-requested
revocation before acknowledging it and closing the socket.

## Consequences

Untrusted websites cannot control playback without explicit pairing even though browsers can reach
loopback. Users must re-pair after clearing either application's settings. A local process running as
the same user remains outside the threat model.
