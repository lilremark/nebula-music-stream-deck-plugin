export interface MarqueeMetadata {
  title: string;
  artist: string;
  album?: string | undefined;
}

export interface MarqueeLimits {
  title: number;
  artist: number;
  album: number;
}

export const KEY_MARQUEE_LIMITS: MarqueeLimits = {
  title: 18,
  artist: 20,
  album: 20
};

export const DIAL_MARQUEE_LIMITS: MarqueeLimits = {
  title: 24,
  artist: 31,
  album: 31
};

const MARQUEE_GAP = "   •   ";

export function marqueeText(value: string, visibleCharacters: number, frame: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= visibleCharacters) return value;

  const loop = [...characters, ...Array.from(MARQUEE_GAP)];
  const start = Math.max(0, frame) % loop.length;
  return Array.from(
    { length: visibleCharacters },
    (_, offset) => loop[(start + offset) % loop.length]
  ).join("");
}

export function metadataNeedsMarquee(metadata: MarqueeMetadata, limits: MarqueeLimits): boolean {
  return (
    Array.from(metadata.title).length > limits.title ||
    Array.from(metadata.artist).length > limits.artist ||
    Array.from(metadata.album ?? "").length > limits.album
  );
}

export function keyMetadataTitle(metadata: MarqueeMetadata | undefined, frame: number): string {
  if (!metadata) return "Nothing playing";

  return [
    marqueeText(metadata.title, KEY_MARQUEE_LIMITS.title, frame),
    marqueeText(metadata.album ?? "", KEY_MARQUEE_LIMITS.album, frame),
    marqueeText(metadata.artist, KEY_MARQUEE_LIMITS.artist, frame)
  ]
    .filter(Boolean)
    .join("\n");
}

export function staticKeyMetadataTitle(metadata: MarqueeMetadata | undefined): string {
  if (!metadata) return "Nothing playing";

  return [
    truncateMetadata(metadata.title, KEY_MARQUEE_LIMITS.title),
    truncateMetadata(metadata.album ?? "", KEY_MARQUEE_LIMITS.album),
    truncateMetadata(metadata.artist, KEY_MARQUEE_LIMITS.artist)
  ]
    .filter(Boolean)
    .join("\n");
}

function truncateMetadata(value: string, limit: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= limit) return value;
  return `${characters.slice(0, Math.max(1, limit - 1)).join("")}…`;
}
