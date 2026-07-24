import type { NebulaSnapshot } from "../protocol/schema.js";
import { clamp } from "../core/math.js";

const BACKGROUND = "#0b1020";
const ACCENT = "#8b5cf6";

export function nowPlayingSvg(snapshot?: NebulaSnapshot): string {
  if (!snapshot) return statusSvg("Nebula", "Disconnected", "⏻");
  if (!snapshot.track) return statusSvg("Nebula Music", "Nothing playing", "♫");

  const progress =
    snapshot.durationSeconds > 0
      ? Math.round(clamp(snapshot.positionSeconds / snapshot.durationSeconds, 0, 1) * 144)
      : 0;
  const artwork = snapshot.track.artworkDataUrl
    ? `<image href="${escapeAttribute(snapshot.track.artworkDataUrl)}" x="0" y="0" width="144" height="144" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="144" height="144" fill="#171f38"/><text x="72" y="69" text-anchor="middle" font-size="42" fill="#c4b5fd">♫</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <clipPath id="clip"><rect width="144" height="144" rx="12"/></clipPath>
  <g clip-path="url(#clip)">${artwork}<rect y="72" width="144" height="72" fill="#050711" fill-opacity=".86"/></g>
  <text x="8" y="95" font-family="Arial,sans-serif" font-weight="700" font-size="13" fill="white">${escapeText(truncate(snapshot.track.title, 18))}</text>
  <text x="8" y="113" font-family="Arial,sans-serif" font-size="11" fill="#d1d5db">${escapeText(truncate(snapshot.track.artist, 22))}</text>
  <rect x="0" y="139" width="144" height="5" fill="#343b52"/><rect x="0" y="139" width="${progress}" height="5" fill="${ACCENT}"/>
  <circle cx="129" cy="91" r="10" fill="${ACCENT}"/><text x="129" y="96" text-anchor="middle" font-size="12" fill="white">${snapshot.playing ? "Ⅱ" : "▶"}</text>
  </svg>`;
}

export function volumeSvg(snapshot?: NebulaSnapshot): string {
  if (!snapshot) return statusSvg("Volume", "Disconnected", "×");
  const percent = Math.round(snapshot.volume * 100);
  const width = clamp(percent, 0, 100) * 1.12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <text x="72" y="60" text-anchor="middle" font-family="Arial,sans-serif" font-size="35" fill="white">${snapshot.muted || percent === 0 ? "🔇" : "🔊"}</text>
  <text x="72" y="97" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="white">${percent}%</text>
  <rect x="16" y="116" width="112" height="8" rx="4" fill="#343b52"/><rect x="16" y="116" width="${width.toFixed(2)}" height="8" rx="4" fill="${ACCENT}"/>
  </svg>`;
}

export function playlistSvg(name: string, connected: boolean): string {
  return statusSvg(
    connected ? truncate(name || "Choose playlist", 18) : "Playlist",
    connected ? "Press to play" : "Disconnected",
    "☷"
  );
}

export function statusSvg(title: string, subtitle: string, symbol: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="12" fill="${BACKGROUND}"/>
  <circle cx="72" cy="48" r="27" fill="#242c48"/><text x="72" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="29" fill="#c4b5fd">${escapeText(symbol)}</text>
  <text x="72" y="96" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="white">${escapeText(truncate(title, 19))}</text>
  <text x="72" y="116" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#aab2c8">${escapeText(truncate(subtitle, 24))}</text>
  </svg>`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
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
