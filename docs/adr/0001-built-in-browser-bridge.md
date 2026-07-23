# ADR 0001: Built-in browser bridge

## Status

Accepted

## Decision

Nebula Music owns an opt-in browser bridge that connects to the Stream Deck plugin's IPv4-loopback
WebSocket server. Commands call Nebula's existing player and playlist stores. The browser publishes
only presentation state and compressed artwork.

## Consequences

The plugin never holds Subsonic credentials or reimplements queue semantics. Browser playback
continues to use Nebula's authenticated session. A compatible Nebula change is required, and browser
background throttling may delay heartbeats until the tab resumes.
