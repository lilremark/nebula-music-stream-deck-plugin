export interface ArtworkCandidate {
  image: string;
  hasArtwork: boolean;
}

interface FrozenArtwork extends ArtworkCandidate {
  trackKey: string;
}

export class FrozenArtworkCache {
  readonly #entries = new Map<string, FrozenArtwork>();

  constructor(private readonly capacity = 32) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Artwork cache capacity must be a positive integer");
    }
  }

  select(trackKey: string, candidate: ArtworkCandidate): string {
    const previous = this.#entries.get(trackKey);
    const selected =
      !previous || (!previous.hasArtwork && candidate.hasArtwork)
        ? { trackKey, ...candidate }
        : previous;

    this.#entries.delete(trackKey);
    this.#entries.set(trackKey, selected);
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return selected.image;
  }
}
