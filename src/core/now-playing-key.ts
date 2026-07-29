export interface NowPlayingKeyFrame {
  image: string;
  title: string;
}

interface FrozenFrame {
  trackKey: string;
  frame: NowPlayingKeyFrame;
}

export class FrozenNowPlayingKeyCache {
  readonly #entries = new Map<string, FrozenFrame>();

  constructor(private readonly capacity = 64) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Now Playing key cache capacity must be a positive integer");
    }
  }

  select(
    contextId: string,
    trackKey: string,
    candidate: NowPlayingKeyFrame,
    forceRefresh = false
  ): NowPlayingKeyFrame {
    const previous = this.#entries.get(contextId);
    const selected =
      !previous || previous.trackKey !== trackKey || forceRefresh
        ? { trackKey, frame: candidate }
        : previous;

    this.#entries.delete(contextId);
    this.#entries.set(contextId, selected);
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return selected.frame;
  }
}
