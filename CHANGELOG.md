# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-24

### Added

- Stream Deck and Stream Deck+ actions for Now Playing, play/pause, previous, next, volume,
  playlists, playlist browsing, and connection management.
- Live album artwork, metadata, playback progress, smooth marquee text, dial seeking, touch-strip
  scrubbing, and absolute volume control.
- Opt-in, authenticated localhost bridge pairing with multi-instance selection and pinning.
- Property inspector controls for pairing, diagnostics, playlists, connection selection, and
  configurable seek and volume steps.
- Local developer installation, standalone packaging, cross-platform CI, checksum generation, and
  build-provenance attestations.

### Changed

- Reduced control latency with optimistic feedback and latest-command coalescing.
- Refined key and dial artwork to match Nebula Music's visual language.
- Separated Now Playing artwork from metadata refreshes to avoid expensive full-image regeneration.

### Fixed

- Restored reliable album artwork rendering on Now Playing keys.
- Stabilized browser disconnect cleanup, stale-tab failover, Windows integration-test ports, and
  local installation when Nebula Music is not installed as a desktop application.

### Security

- Bind the bridge to IPv4 loopback and validate message size, protocol version, origin, and schema.
- Protect pairing with expiring single-use codes, attempt throttling, random client tokens, and
  single-use HMAC-SHA256 authentication challenges.
- Keep Subsonic credentials, authenticated artwork URLs, queues, pairing secrets, and media
  metadata out of plugin logs.

[Unreleased]: https://github.com/lilremark/nebula-music-stream-deck-plugin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lilremark/nebula-music-stream-deck-plugin/releases/tag/v1.0.0
