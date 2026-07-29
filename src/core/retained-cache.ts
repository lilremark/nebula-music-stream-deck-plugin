export class HiddenContextCache {
  readonly #hiddenKeys = new Map<string, true>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Cache capacity must be a positive integer");
    }
  }

  hide(key: string): string | undefined {
    this.#hiddenKeys.delete(key);
    this.#hiddenKeys.set(key, true);
    if (this.#hiddenKeys.size <= this.capacity) return undefined;
    const oldest = this.#hiddenKeys.keys().next().value;
    if (oldest === undefined) return undefined;
    this.#hiddenKeys.delete(oldest);
    return oldest;
  }

  show(key: string): void {
    this.#hiddenKeys.delete(key);
  }
}
