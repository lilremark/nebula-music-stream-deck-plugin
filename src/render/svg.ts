import { clamp } from "../core/math.js";
import { KEY_MARQUEE_LIMITS, marqueeText } from "../core/marquee.js";
import type { NebulaSnapshot } from "../protocol/schema.js";

const BACKGROUND = "#0a0a0a";
const SURFACE = "#171717";
const ELEVATED = "#262626";
const TEXT = "#fafafa";
const MUTED = "#a3a3a3";
const ACCENT = "#3b82c4";

export function nowPlayingSvg(snapshot?: NebulaSnapshot, marqueeFrame = 0): string {
  if (!snapshot?.track) return idleNowPlayingSvg();

  const artwork = snapshot.track.artworkDataUrl
    ? `<image href="${escapeAttribute(snapshot.track.artworkDataUrl)}" width="144" height="144" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="144" height="144" fill="${SURFACE}"/>${recordMark(72, 59, 1.35)}`;
  const title = marqueeText(snapshot.track.title, KEY_MARQUEE_LIMITS.title, marqueeFrame);
  const artist = marqueeText(snapshot.track.artist, KEY_MARQUEE_LIMITS.artist, marqueeFrame);
  const album = marqueeText(snapshot.track.album ?? "", KEY_MARQUEE_LIMITS.album, marqueeFrame);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <clipPath id="tile"><rect width="144" height="144" rx="12"/></clipPath>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".38" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity=".78"/><stop offset="1" stop-color="#000" stop-opacity=".98"/></linearGradient>
  </defs>
  <g clip-path="url(#tile)">${artwork}<rect width="144" height="144" fill="url(#shade)"/></g>
  <text x="8" y="105" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="${TEXT}">${escapeText(title)}</text>
  <text x="8" y="121" font-family="Arial,sans-serif" font-size="9.5" font-weight="500" fill="#d4d4d4">${escapeText(artist)}</text>
  <text x="8" y="136" font-family="Arial,sans-serif" font-size="8.5" font-weight="500" fill="${MUTED}">${escapeText(album)}</text>
  </svg>`;
}

export function volumeSvg(snapshot?: NebulaSnapshot): string {
  const percent = snapshot ? Math.round(snapshot.volume * 100) : undefined;
  const muted = volumeKeyState(snapshot) === 1;
  const ratio = percent === undefined ? 0 : clamp(percent / 100, 0, 1);
  const value = percent === undefined ? "—" : muted ? "MUTED" : `${percent}%`;
  const valueSize = muted && percent !== undefined ? 20 : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  ${speakerMark(72, 57, muted, 1.7)}
  <text x="72" y="112" text-anchor="middle" font-family="Arial,sans-serif" font-size="${valueSize}" font-weight="700" fill="${muted && percent !== undefined ? ACCENT : TEXT}">${value}</text>
  ${waveformProgress(ratio, 16, 126, 112, 10, 28)}
  </svg>`;
}

export function volumeKeyState(snapshot?: NebulaSnapshot): 0 | 1 {
  return !snapshot || snapshot.muted || snapshot.volume === 0 ? 1 : 0;
}

export function playlistSvg(name: string): string {
  const label = name || "Choose playlist";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  ${playlistMark(72, 58, 1.7)}
  <text x="72" y="111" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="${TEXT}">${escapeText(truncate(label, 20))}</text>
  <rect x="48" y="125" width="48" height="2" rx="1" fill="${ACCENT}"/>
  </svg>`;
}

export function statusSvg(title: string, subtitle: string, symbol: string): string {
  const mark =
    symbol === "link"
      ? connectionMark(72, 57, 1.55)
      : `<text x="72" y="67" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="${TEXT}">${escapeText(symbol)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  ${mark}
  <text x="72" y="105" text-anchor="middle" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="${TEXT}">${escapeText(truncate(title, 19))}</text>
  <text x="72" y="124" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="600" fill="${MUTED}">${escapeText(truncate(subtitle, 24))}</text>
  </svg>`;
}

export function dialIconSvg(type: "volume" | "playlist", inactive = false): string {
  const mark = type === "volume" ? speakerMark(24, 24, inactive, 1.35) : playlistMark(24, 24, 1.35);
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${mark}</svg>`
  );
}

export function dialArtworkFallbackSvg(): string {
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="${SURFACE}"/>${recordMark(50, 50, 1.25)}</svg>`
  );
}

export function keyArtworkFallbackSvg(): string {
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="12" fill="${SURFACE}"/>${recordMark(72, 62, 1.8)}</svg>`
  );
}

export function nowPlayingKeyImage(snapshot?: NebulaSnapshot): string {
  return snapshot?.track?.artworkDataUrl ?? keyArtworkFallbackSvg();
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

function idleNowPlayingSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  ${recordMark(72, 63, 1.2)}
  <text x="72" y="116" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="700" letter-spacing="1.4" fill="${MUTED}">NOTHING PLAYING</text>
  </svg>`;
}

function recordMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)" fill="none" stroke="${MUTED}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><circle cx="12" cy="12" r="2" stroke="${ACCENT}"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/></g>`;
}

function waveformProgress(
  ratio: number,
  x: number,
  y: number,
  width: number,
  height: number,
  count: number
): string {
  const gap = 1.4;
  const barWidth = (width - gap * (count - 1)) / count;
  const bars = Array.from({ length: count }, (_, index) => {
    const phase = index / Math.max(1, count - 1);
    const amplitude = 0.34 + Math.abs(Math.sin(index * 0.72) * Math.cos(index * 0.19)) * 0.66;
    const barHeight = Math.max(2, amplitude * height);
    const fill = phase <= ratio ? "#d4d4d4" : ELEVATED;
    return `<rect x="${(x + index * (barWidth + gap)).toFixed(2)}" y="${(y + (height - barHeight) / 2).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx=".5" fill="${fill}"/>`;
  }).join("");
  const marker = x + clamp(ratio, 0, 1) * width;
  return `<g>${bars}<rect x="${marker.toFixed(2)}" y="${y - 1}" width="1.5" height="${height + 2}" rx=".75" fill="${ACCENT}"/></g>`;
}

function speakerMark(cx: number, cy: number, muted: boolean, scale: number): string {
  const sound = muted
    ? `<path d="m16 9 6 6"/><path d="m22 9-6 6"/>`
    : `<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`;
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)" fill="none" stroke="${TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>${sound}</g>`;
}

function playlistMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)" fill="none" stroke="${TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 5H3"/><path d="M11 12H3"/><path d="M11 19H3"/><path d="M21 16V5"/><circle cx="18" cy="16" r="3"/></g>`;
}

function connectionMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)" fill="none" stroke="${TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></g>`;
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
