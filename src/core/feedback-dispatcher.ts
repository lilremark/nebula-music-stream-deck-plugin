import { changedFeedback } from "./command-dispatcher.js";

type Feedback = Record<string, string | number>;

interface FeedbackLane<T> {
  target: T;
  desiredFull: Feedback;
  acknowledged: Feedback | undefined;
  inFlight: boolean;
  lastSentAt: number;
  timer: NodeJS.Timeout | undefined;
  generation: number;
  revision: number;
  failedRevision: number | undefined;
}

/**
 * Keeps hardware feedback off the input path and submits only the newest frame.
 * This avoids piling up compositor work when the Stream Deck window is minimized.
 */
export class LatestFeedbackDispatcher<T> {
  readonly #lanes = new Map<string, FeedbackLane<T>>();

  constructor(
    private readonly send: (target: T, feedback: Feedback) => Promise<void>,
    private readonly minimumIntervalMs = 50
  ) {}

  update(laneId: string, target: T, feedback: Feedback): void {
    const lane = this.#lanes.get(laneId) ?? {
      target,
      desiredFull: {},
      acknowledged: undefined,
      inFlight: false,
      lastSentAt: 0,
      timer: undefined,
      generation: 0,
      revision: 0,
      failedRevision: undefined
    };
    lane.target = target;
    const changed = changedFeedback(lane.desiredFull, feedback);
    if (Object.keys(changed).length === 0) return;
    lane.desiredFull = { ...lane.desiredFull, ...changed };
    lane.revision += 1;
    this.#lanes.set(laneId, lane);
    this.pump(laneId, lane);
  }

  clear(laneId: string): void {
    const lane = this.#lanes.get(laneId);
    if (!lane) return;
    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = undefined;
    lane.desiredFull = {};
    lane.acknowledged = undefined;
    lane.generation += 1;
    lane.revision += 1;
    lane.failedRevision = undefined;
    if (!lane.inFlight) this.#lanes.delete(laneId);
  }

  private pump(laneId: string, lane: FeedbackLane<T>): void {
    if (lane.inFlight || lane.timer) return;
    if (Object.keys(lane.desiredFull).length === 0) {
      this.#lanes.delete(laneId);
      return;
    }
    if (lane.failedRevision === lane.revision) return;
    const feedback =
      lane.acknowledged === undefined
        ? lane.desiredFull
        : changedFeedback(lane.acknowledged, lane.desiredFull);
    if (Object.keys(feedback).length === 0) return;
    const delay = Math.max(0, lane.lastSentAt + this.minimumIntervalMs - Date.now());
    if (delay > 0) {
      lane.timer = setTimeout(() => {
        lane.timer = undefined;
        this.pump(laneId, lane);
      }, delay);
      lane.timer.unref();
      return;
    }

    lane.inFlight = true;
    lane.lastSentAt = Date.now();
    const generation = lane.generation;
    const revision = lane.revision;
    void this.send(lane.target, feedback)
      .then(() => {
        if (lane.generation !== generation) return;
        lane.acknowledged = { ...(lane.acknowledged ?? {}), ...feedback };
        lane.failedRevision = undefined;
      })
      .catch(() => {
        if (lane.generation !== generation) return;
        lane.acknowledged = undefined;
        lane.failedRevision = revision;
      })
      .finally(() => {
        lane.inFlight = false;
        if (this.#lanes.get(laneId) === lane) this.pump(laneId, lane);
      });
  }
}
