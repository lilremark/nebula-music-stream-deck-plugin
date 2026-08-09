export interface NowPlayingKeyFrame {
  image: string;
  title: string;
  hasArtwork: boolean;
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
    let selected: FrozenFrame;
    if (!previous || previous.trackKey !== trackKey || forceRefresh) {
      selected = { trackKey, frame: candidate };
    } else if (!previous.frame.hasArtwork && candidate.hasArtwork) {
      // Nebula sends the track metadata before its artwork finishes loading. Upgrade the frozen
      // frame's image so a late-arriving cover replaces the placeholder without touching metadata.
      selected = {
        trackKey,
        frame: { ...previous.frame, image: candidate.image, hasArtwork: true }
      };
    } else {
      selected = previous;
    }

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
