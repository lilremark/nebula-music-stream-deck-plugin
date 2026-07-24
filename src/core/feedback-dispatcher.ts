import { changedFeedback } from "./command-dispatcher.js";

type Feedback = Record<string, string | number>;

interface FeedbackLane<T> {
  target: T;
  desired: Feedback;
  pending: Feedback;
  inFlight: boolean;
  lastSentAt: number;
  timer: NodeJS.Timeout | undefined;
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
      desired: {},
      pending: {},
      inFlight: false,
      lastSentAt: 0,
      timer: undefined
    };
    lane.target = target;
    const changed = changedFeedback(lane.desired, feedback);
    if (Object.keys(changed).length === 0) return;
    lane.desired = { ...lane.desired, ...changed };
    lane.pending = { ...lane.pending, ...changed };
    this.#lanes.set(laneId, lane);
    this.pump(laneId, lane);
  }

  clear(laneId: string): void {
    const lane = this.#lanes.get(laneId);
    if (lane?.timer) clearTimeout(lane.timer);
    this.#lanes.delete(laneId);
  }

  private pump(laneId: string, lane: FeedbackLane<T>): void {
    if (lane.inFlight || lane.timer || Object.keys(lane.pending).length === 0) return;
    const delay = Math.max(0, lane.lastSentAt + this.minimumIntervalMs - Date.now());
    if (delay > 0) {
      lane.timer = setTimeout(() => {
        lane.timer = undefined;
        this.pump(laneId, lane);
      }, delay);
      lane.timer.unref();
      return;
    }

    const feedback = lane.pending;
    lane.pending = {};
    lane.inFlight = true;
    lane.lastSentAt = Date.now();
    void this.send(lane.target, feedback)
      .catch(() => {
        lane.desired = {};
      })
      .finally(() => {
        lane.inFlight = false;
        if (this.#lanes.get(laneId) === lane) this.pump(laneId, lane);
      });
  }
}
