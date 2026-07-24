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
  title: 20,
  artist: 25,
  album: 25
};

export const DIAL_MARQUEE_LIMITS: MarqueeLimits = {
  title: 13,
  artist: 17,
  album: 17
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
