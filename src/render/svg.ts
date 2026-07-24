import { clamp } from "../core/math.js";
import type { NebulaSnapshot } from "../protocol/schema.js";

const BACKGROUND = "#0a0a0a";
const SURFACE = "#171717";
const MUTED = "#a3a3a3";
const PRIMARY = "#06b6d4";
const SECONDARY = "#8b5cf6";
const ACCENT_GRADIENT = `<linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="8" y1="136" x2="136" y2="8"><stop stop-color="${PRIMARY}"/><stop offset="1" stop-color="${SECONDARY}"/></linearGradient>`;

export function nowPlayingSvg(snapshot?: NebulaSnapshot): string {
  if (!snapshot?.track) return idleNowPlayingSvg();

  const ratio =
    snapshot.durationSeconds > 0
      ? clamp(snapshot.positionSeconds / snapshot.durationSeconds, 0, 1)
      : 0;
  const progress = Math.round(ratio * 128);
  const artwork = snapshot.track.artworkDataUrl
    ? `<image href="${escapeAttribute(snapshot.track.artworkDataUrl)}" width="144" height="144" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="144" height="144" fill="${SURFACE}"/>${waveformMark(72, 55, 1.5)}`;
  const playbackIcon = snapshot.playing
    ? `<path d="M121 13h3v10h-3zm6 0h3v10h-3z" fill="#fff"/>`
    : `<path d="m121 12 10 6-10 6z" fill="#fff"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    ${ACCENT_GRADIENT}
    <linearGradient id="shade" x1="0" y1=".2" x2="0" y2="1"><stop offset=".24" stop-color="#000" stop-opacity="0"/><stop offset=".68" stop-color="#000" stop-opacity=".78"/><stop offset="1" stop-color="#000" stop-opacity=".98"/></linearGradient>
    <clipPath id="clip"><rect width="144" height="144" rx="12"/></clipPath>
  </defs>
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <g clip-path="url(#clip)">${artwork}<rect width="144" height="144" fill="url(#shade)"/></g>
  <circle cx="126" cy="18" r="12" fill="#0a0a0a" fill-opacity=".78" stroke="#fff" stroke-opacity=".18"/>${playbackIcon}
  <text x="8" y="101" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#fafafa">${escapeText(truncate(snapshot.track.title, 18))}</text>
  <text x="8" y="119" font-family="Arial,sans-serif" font-size="10.5" font-weight="500" fill="#d4d4d4">${escapeText(truncate(snapshot.track.artist, 22))}</text>
  <rect x="8" y="134" width="128" height="3" rx="1.5" fill="#525252"/><rect x="8" y="134" width="${progress}" height="3" rx="1.5" fill="url(#accent)"/>
  </svg>`;
}

export function volumeSvg(snapshot?: NebulaSnapshot): string {
  const percent = snapshot ? Math.round(snapshot.volume * 100) : undefined;
  const muted = !snapshot || snapshot.muted || percent === 0;
  const width = percent === undefined ? 0 : Math.round(clamp(percent, 0, 100) * 1.04);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>${ACCENT_GRADIENT}${surfaceGlow()}</defs>
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/><rect width="144" height="144" rx="12" fill="url(#glow)"/>
  <circle cx="72" cy="47" r="27" fill="${SURFACE}" stroke="url(#accent)" stroke-width="2"/>
  ${speakerMark(72, 47, muted, 1.15)}
  <text x="72" y="101" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#fafafa">${percent === undefined ? "—" : `${percent}%`}</text>
  <rect x="20" y="119" width="104" height="5" rx="2.5" fill="#262626"/><rect x="20" y="119" width="${width}" height="5" rx="2.5" fill="url(#accent)"/>
  </svg>`;
}

export function playlistSvg(name: string): string {
  const label = name || "Choose playlist";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>${ACCENT_GRADIENT}${surfaceGlow()}</defs>
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/><rect width="144" height="144" rx="12" fill="url(#glow)"/>
  <circle cx="72" cy="51" r="29" fill="${SURFACE}" stroke="url(#accent)" stroke-width="2"/>
  ${playlistMark(72, 51, 1.1)}
  <text x="72" y="102" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="700" letter-spacing="1.4" fill="${MUTED}">PLAYLIST</text>
  <text x="72" y="121" text-anchor="middle" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="#fafafa">${escapeText(truncate(label, 18))}</text>
  </svg>`;
}

export function statusSvg(title: string, subtitle: string, symbol: string): string {
  const mark =
    symbol === "link"
      ? connectionMark(72, 48, 1)
      : `<text x="72" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="#fafafa">${escapeText(symbol)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>${ACCENT_GRADIENT}${surfaceGlow()}</defs>
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/><rect width="144" height="144" rx="12" fill="url(#glow)"/>
  <circle cx="72" cy="48" r="27" fill="${SURFACE}" stroke="url(#accent)" stroke-width="2"/>
  ${mark}
  <text x="72" y="96" text-anchor="middle" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="#fafafa">${escapeText(truncate(title, 19))}</text>
  <text x="72" y="116" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="600" fill="${MUTED}">${escapeText(truncate(subtitle, 24))}</text>
  </svg>`;
}

export function dialIconSvg(type: "volume" | "playlist", inactive = false): string {
  const mark = type === "volume" ? speakerMark(24, 24, inactive, 0.8) : playlistMark(24, 24, 0.75);
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><defs><linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="4" y1="44" x2="44" y2="4"><stop stop-color="${PRIMARY}"/><stop offset="1" stop-color="${SECONDARY}"/></linearGradient></defs><circle cx="24" cy="24" r="22" fill="${SURFACE}" stroke="url(#accent)" stroke-width="2"/>${mark}</svg>`
  );
}

export function dialArtworkFallbackSvg(): string {
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="70" viewBox="0 0 64 70"><defs><linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="4" y1="66" x2="60" y2="4"><stop stop-color="${PRIMARY}"/><stop offset="1" stop-color="${SECONDARY}"/></linearGradient></defs><rect width="64" height="70" rx="7" fill="${SURFACE}"/>${waveformMark(32, 35, 0.7)}</svg>`
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

function idleNowPlayingSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>${ACCENT_GRADIENT}${surfaceGlow()}</defs>
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/><rect width="144" height="144" rx="12" fill="url(#glow)"/>
  <circle cx="72" cy="61" r="34" fill="${SURFACE}" stroke="url(#accent)" stroke-width="2"/>
  ${waveformMark(72, 61, 1)}
  <text x="72" y="116" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="700" letter-spacing="1.5" fill="${MUTED}">NO PLAYER</text>
  </svg>`;
}

function surfaceGlow(): string {
  return `<radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(18 12) rotate(35) scale(145)"><stop stop-color="${PRIMARY}" stop-opacity=".13"/><stop offset=".55" stop-color="${SECONDARY}" stop-opacity=".07"/><stop offset="1" stop-color="${BACKGROUND}" stop-opacity="0"/></radialGradient>`;
}

function waveformMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="url(#accent)" stroke-linecap="round" stroke-width="3.5"><path d="M -20 -3 v 6" opacity=".5"/><path d="M -10 -9 v 18" opacity=".75"/><path d="M 0 -16 v 32"/><path d="M 10 -9 v 18" opacity=".75"/><path d="M 20 -3 v 6" opacity=".5"/></g>`;
}

function speakerMark(cx: number, cy: number, muted: boolean, scale: number): string {
  const sound = muted
    ? `<path d="m14-6 12 12m0-12L14 6" stroke="${MUTED}"/>`
    : `<path d="M12-6a9 9 0 0 1 0 12M17-11a16 16 0 0 1 0 22"/>`;
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="#fafafa" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"><path d="m-3-10-9 8h-7v10h7l9 8z"/>${sound}</g>`;
}

function playlistMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="#fafafa" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"><path d="M-20-12H3M-20-5H3M-20 2h16M8-14V9a7 7 0 1 1-5-6.7V-9l12-3"/></g>`;
}

function connectionMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="#fafafa" stroke-linecap="round" stroke-width="2.8"><path d="m-5 5 10-10M-8 8l-2 2a6 6 0 0 1-9-9l6-6a6 6 0 0 1 9 0M8-8l2-2a6 6 0 0 1 9 9l-6 6a6 6 0 0 1-9 0"/></g>`;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeAttribute(value: string): string {
  return escapeText(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
