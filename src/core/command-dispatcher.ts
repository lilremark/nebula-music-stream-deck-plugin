export interface CommandDispatch<T> {
  command: T;
  onError: (error: unknown) => void;
}

interface CommandLane<T> {
  inFlight: boolean;
  pending: CommandDispatch<T> | undefined;
  lastSentAt: number;
  timer: NodeJS.Timeout | undefined;
}

/**
 * Sends ordinary commands immediately and keeps only the newest queued command
 * for high-frequency controls while one command is awaiting acknowledgement.
 */
export class CommandDispatcher<T> {
  readonly #lanes = new Map<string, CommandLane<T>>();

  constructor(
    private readonly send: (command: T) => Promise<void>,
    private readonly minimumIntervalMs = 25
  ) {}

  dispatch(command: T, onError: (error: unknown) => void): void {
    void this.send(command).catch(onError);
  }

  dispatchLatest(laneId: string, command: T, onError: (error: unknown) => void): void {
    const dispatch = { command, onError };
    const lane = this.#lanes.get(laneId);
    if (lane) {
      lane.pending = dispatch;
      this.pump(laneId, lane);
      return;
    }

    const nextLane = {
      inFlight: false,
      pending: undefined,
      lastSentAt: 0,
      timer: undefined
    };
    this.#lanes.set(laneId, nextLane);
    this.launch(laneId, nextLane, dispatch);
  }

  private launch(laneId: string, lane: CommandLane<T>, dispatch: CommandDispatch<T>): void {
    lane.inFlight = true;
    lane.lastSentAt = Date.now();
    void this.send(dispatch.command)
      .catch(dispatch.onError)
      .finally(() => {
        lane.inFlight = false;
        this.pump(laneId, lane);
      });
  }

  private pump(laneId: string, lane: CommandLane<T>): void {
    if (lane.inFlight || lane.timer) return;
    const delay = Math.max(0, lane.lastSentAt + this.minimumIntervalMs - Date.now());
    if (delay > 0) {
      lane.timer = setTimeout(() => {
        lane.timer = undefined;
        this.pump(laneId, lane);
      }, delay);
      lane.timer.unref();
      return;
    }

    const pending = lane.pending;
    lane.pending = undefined;
    if (pending) {
      this.launch(laneId, lane, pending);
    } else {
      this.#lanes.delete(laneId);
    }
  }
}

export function changedFeedback(
  previous: Readonly<Record<string, string | number>>,
  next: Readonly<Record<string, string | number>>
): Record<string, string | number> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => previous[key] !== value));
}
