import { clamp } from "../core/math.js";
import type { NebulaSnapshot } from "../protocol/schema.js";

const BACKGROUND = "#0a0a0a";
const SURFACE = "#171717";
const ELEVATED = "#262626";
const TEXT = "#fafafa";
const MUTED = "#a3a3a3";
const SUBTLE = "#525252";
const ACCENT = "#3b82c4";

export function nowPlayingSvg(snapshot?: NebulaSnapshot): string {
  if (!snapshot?.track) return idleNowPlayingSvg();

  const ratio =
    snapshot.durationSeconds > 0
      ? clamp(snapshot.positionSeconds / snapshot.durationSeconds, 0, 1)
      : 0;
  const artwork = snapshot.track.artworkDataUrl
    ? `<image href="${escapeAttribute(snapshot.track.artworkDataUrl)}" x="31" y="20" width="82" height="82" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="31" y="20" width="82" height="82" fill="${SURFACE}"/>${recordMark(72, 61, 1)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <clipPath id="art"><rect x="31" y="20" width="82" height="82" rx="9"/></clipPath>
  </defs>
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <text x="8" y="13" font-family="Arial,sans-serif" font-size="7.5" font-weight="700" letter-spacing="1.1" fill="${MUTED}">NOW PLAYING</text>
  <g clip-path="url(#art)">${artwork}</g>
  <text x="72" y="117" text-anchor="middle" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="${TEXT}">${escapeText(truncate(snapshot.track.title, 20))}</text>
  <text x="72" y="130" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="500" fill="${MUTED}">${escapeText(truncate(snapshot.track.artist, 25))}</text>
  ${waveformProgress(ratio, 8, 135, 128, 7, 34)}
  </svg>`;
}

export function volumeSvg(snapshot?: NebulaSnapshot): string {
  const percent = snapshot ? Math.round(snapshot.volume * 100) : undefined;
  const muted = !snapshot || snapshot.muted || percent === 0;
  const ratio = percent === undefined ? 0 : clamp(percent / 100, 0, 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <text x="8" y="14" font-family="Arial,sans-serif" font-size="8" font-weight="700" letter-spacing="1.2" fill="${MUTED}">VOLUME</text>
  ${speakerMark(72, 57, muted, 1.35)}
  <text x="72" y="112" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="${TEXT}">${percent === undefined ? "—" : `${percent}%`}</text>
  ${waveformProgress(ratio, 16, 126, 112, 10, 28)}
  </svg>`;
}

export function playlistSvg(name: string): string {
  const label = name || "Choose playlist";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <text x="8" y="14" font-family="Arial,sans-serif" font-size="8" font-weight="700" letter-spacing="1.2" fill="${MUTED}">PLAYLIST</text>
  ${playlistMark(72, 58, 1.2)}
  <text x="72" y="111" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="${TEXT}">${escapeText(truncate(label, 20))}</text>
  <rect x="48" y="125" width="48" height="2" rx="1" fill="${ACCENT}"/>
  </svg>`;
}

export function statusSvg(title: string, subtitle: string, symbol: string): string {
  const mark =
    symbol === "link"
      ? connectionMark(72, 57, 1.05)
      : `<text x="72" y="67" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="${TEXT}">${escapeText(symbol)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <text x="8" y="14" font-family="Arial,sans-serif" font-size="8" font-weight="700" letter-spacing="1.2" fill="${MUTED}">CONNECTION</text>
  ${mark}
  <text x="72" y="105" text-anchor="middle" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="${TEXT}">${escapeText(truncate(title, 19))}</text>
  <text x="72" y="124" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="600" fill="${MUTED}">${escapeText(truncate(subtitle, 24))}</text>
  </svg>`;
}

export function dialIconSvg(type: "volume" | "playlist", inactive = false): string {
  const mark = type === "volume" ? speakerMark(24, 24, inactive, 0.8) : playlistMark(24, 24, 0.75);
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="${SURFACE}"/>${mark}<rect x="10" y="44" width="28" height="2" rx="1" fill="${ACCENT}"/></svg>`
  );
}

export function dialArtworkFallbackSvg(): string {
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="70" viewBox="0 0 64 70"><rect width="64" height="70" rx="7" fill="${SURFACE}"/>${recordMark(32, 35, 0.75)}</svg>`
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

function idleNowPlayingSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <text x="8" y="14" font-family="Arial,sans-serif" font-size="8" font-weight="700" letter-spacing="1.2" fill="${MUTED}">NOW PLAYING</text>
  ${recordMark(72, 63, 1.2)}
  <text x="72" y="116" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" font-weight="700" letter-spacing="1.4" fill="${MUTED}">NOTHING PLAYING</text>
  </svg>`;
}

function recordMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})"><circle r="25" fill="${SURFACE}" stroke="${SUBTLE}" stroke-width="1.5"/><circle r="11" fill="none" stroke="${ELEVATED}" stroke-width="8"/><circle r="5" fill="${ACCENT}"/><circle r="2" fill="${BACKGROUND}"/></g>`;
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
    ? `<path d="m14-6 12 12m0-12L14 6" stroke="${MUTED}"/>`
    : `<path d="M12-6a9 9 0 0 1 0 12M17-11a16 16 0 0 1 0 22"/>`;
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"><path d="m-3-10-9 8h-7v10h7l9 8z"/>${sound}</g>`;
}

function playlistMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"><path d="M-20-12H3M-20-5H3M-20 2h16"/><path d="M8-14V9a7 7 0 1 1-5-6.7V-9l12-3" stroke="${ACCENT}"/></g>`;
}

function connectionMark(cx: number, cy: number, scale: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${TEXT}" stroke-linecap="round" stroke-width="2.8"><path d="m-5 5 10-10" stroke="${ACCENT}"/><path d="M-8 8l-2 2a6 6 0 0 1-9-9l6-6a6 6 0 0 1 9 0M8-8l2-2a6 6 0 0 1 9 9l-6 6a6 6 0 0 1-9 0"/></g>`;
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
