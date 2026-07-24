import {
  action,
  type Action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from "@elgato/streamdeck";
import { changedFeedback, CommandDispatcher } from "./core/command-dispatcher.js";
import { commandErrorLabel } from "./core/errors.js";
import {
  clamp,
  seekPositionFromTouch,
  seekSeconds,
  steppedVolume,
  volumeFromTouch
} from "./core/math.js";
import type { NebulaCommand } from "./protocol/schema.js";
import {
  dialArtworkFallbackSvg,
  dialIconSvg,
  formatTime,
  nowPlayingSvg,
  playlistSvg,
  statusSvg,
  volumeSvg
} from "./render/svg.js";
import type { NebulaService, OptimisticOperation, ServiceChangeKind } from "./service.js";

type CommonSettings = {
  seekStepSeconds?: number;
  volumeStepPercent?: number;
};

type PlaybackSettings = CommonSettings & {
  desiredState?: "toggle" | "play" | "pause";
};

type PlaylistSettings = CommonSettings & {
  playlistId?: string;
  playlistName?: string;
};

interface QueuedCommand {
  command: NebulaCommand;
  operation?: OptimisticOperation;
}

interface RefreshState<T extends CommonSettings> {
  target: Action<T>;
  kind: ServiceChangeKind;
  queued: boolean;
  promise: Promise<void> | undefined;
}

abstract class ResponsiveAction<
  T extends CommonSettings = CommonSettings
> extends SingletonAction<T> {
  readonly #dispatcher: CommandDispatcher<QueuedCommand>;
  readonly #refreshes = new Map<string, RefreshState<T>>();
  readonly #images = new Map<string, string>();
  readonly #imageUpdatedAt = new Map<string, number>();
  readonly #titles = new Map<string, string>();
  readonly #states = new Map<string, number>();
  readonly #feedback = new Map<string, Record<string, string | number>>();
  readonly #errors = new Map<string, string>();
  readonly #errorTimers = new Map<string, NodeJS.Timeout>();

  constructor(protected readonly service: NebulaService) {
    super();
    this.#dispatcher = new CommandDispatcher(({ command, operation }) =>
      service.command(command, false, operation)
    );
    service.on("change", (kind: ServiceChangeKind) => {
      if (!this.shouldRefresh(kind)) return;
      this.actions.forEach((visible) => {
        void this.requestRefresh(visible, kind);
      });
    });
  }

  override async onWillAppear(event: WillAppearEvent<T>): Promise<void> {
    this.clearFeedbackCache(event.action.id);
    await this.requestRefresh(event.action);
  }

  override onWillDisappear(event: WillDisappearEvent<T>): void {
    this.#refreshes.delete(event.action.id);
    this.#errors.delete(event.action.id);
    const timer = this.#errorTimers.get(event.action.id);
    if (timer) clearTimeout(timer);
    this.#errorTimers.delete(event.action.id);
    this.clearFeedbackCache(event.action.id);
  }

  override async onDidReceiveSettings(event: DidReceiveSettingsEvent<T>): Promise<void> {
    this.clearFeedbackCache(event.action.id);
    await this.requestRefresh(event.action);
  }

  protected abstract refresh(target: Action<T>, kind: ServiceChangeKind): Promise<void>;

  protected shouldRefresh(kind: ServiceChangeKind): boolean {
    return kind === "state";
  }

  protected requestRefresh(target: Action<T>, kind: ServiceChangeKind = "state"): Promise<void> {
    let state = this.#refreshes.get(target.id);
    if (!state) {
      state = { target, kind, queued: true, promise: undefined };
      this.#refreshes.set(target.id, state);
    } else {
      state.target = target;
      state.kind = mergeChangeKinds(state.kind, kind);
      state.queued = true;
    }
    if (!state.promise) {
      state.promise = this.drainRefreshes(state)
        .catch(() => {
          // Stream Deck can remove a target while an asynchronous feedback update is in flight.
        })
        .finally(() => {
          state.promise = undefined;
        });
    }
    return state.promise;
  }

  protected execute(target: Action<T>, command: NebulaCommand): void {
    void this.service.command(command).catch((error: unknown) => {
      void this.showCommandError(target, error).catch(() => {});
    });
  }

  protected executeLatest(target: Action<T>, lane: string, command: NebulaCommand): void {
    const operation = this.service.preview(command);
    this.#dispatcher.dispatchLatest(
      `${lane}:${target.id}`,
      operation ? { command, operation } : { command },
      (error) => {
        void this.showCommandError(target, error).catch(() => {});
      }
    );
  }

  protected async setImage(target: Action<T>, image: string, minimumIntervalMs = 0): Promise<void> {
    if (!target.isKey() || this.#images.get(target.id) === image) return;
    if (Date.now() - (this.#imageUpdatedAt.get(target.id) ?? 0) < minimumIntervalMs) return;
    await target.setImage(image);
    this.#images.set(target.id, image);
    this.#imageUpdatedAt.set(target.id, Date.now());
  }

  protected async setTitle(target: Action<T>, title: string): Promise<void> {
    if (this.#titles.get(target.id) === title) return;
    if (target.isKey()) await target.setTitle(title);
    else if (target.isDial()) await target.setTitle(title);
    else return;
    this.#titles.set(target.id, title);
  }

  protected async setState(target: Action<T>, state: number): Promise<void> {
    if (!target.isKey() || this.#states.get(target.id) === state) return;
    await target.setState(state);
    this.#states.set(target.id, state);
  }

  protected async setFeedback(
    target: Action<T>,
    feedback: Record<string, string | number>
  ): Promise<void> {
    if (!target.isDial()) return;
    const previous = this.#feedback.get(target.id) ?? {};
    const changed = changedFeedback(previous, feedback);
    if (Object.keys(changed).length === 0) return;
    await target.setFeedback(changed);
    this.#feedback.set(target.id, { ...previous, ...changed });
  }

  private async drainRefreshes(state: RefreshState<T>): Promise<void> {
    while (state.queued) {
      state.queued = false;
      const kind = state.kind;
      state.kind = "progress";
      const error = this.#errors.get(state.target.id);
      if (error) await this.renderCommandError(state.target, error);
      else await this.refresh(state.target, kind);
    }
  }

  private async showCommandError(target: Action<T>, error: unknown): Promise<void> {
    const label = commandErrorLabel(error);
    await target.showAlert();
    this.#errors.set(target.id, label);
    this.clearFeedbackCache(target.id);
    await this.requestRefresh(target, "state");
    const previousTimer = this.#errorTimers.get(target.id);
    if (previousTimer) clearTimeout(previousTimer);
    const reset = setTimeout(() => {
      this.#errors.delete(target.id);
      this.#errorTimers.delete(target.id);
      this.clearFeedbackCache(target.id);
      void this.requestRefresh(target, "state");
    }, 1_500);
    reset.unref();
    this.#errorTimers.set(target.id, reset);
  }

  private async renderCommandError(target: Action<T>, label: string): Promise<void> {
    if (target.isKey()) {
      await this.setImage(target, statusSvg("Command failed", label, "!"));
      return;
    }
    if (target.isDial()) await this.setTitle(target, label);
  }

  private clearFeedbackCache(actionId: string): void {
    this.#images.delete(actionId);
    this.#imageUpdatedAt.delete(actionId);
    this.#titles.delete(actionId);
    this.#states.delete(actionId);
    this.#feedback.delete(actionId);
  }
}

@action({ UUID: "com.lilremark.nebula-music.now-playing" })
export class NowPlayingAction extends ResponsiveAction {
  override onKeyDown(event: KeyDownEvent): void {
    this.execute(event.action, { name: "togglePlayback" });
  }

  override onDialDown(event: DialDownEvent): void {
    this.execute(event.action, { name: "togglePlayback" });
  }

  override onDialRotate(event: DialRotateEvent<CommonSettings>): void {
    const snapshot = this.service.snapshot;
    if (!snapshot?.track || snapshot.durationSeconds <= 0) return;
    const seconds = seekSeconds(event.payload.ticks, event.payload.settings.seekStepSeconds ?? 5);
    if (seconds === 0) return;
    if (!this.service.supportsActiveCapability("seekAbsolute")) {
      this.execute(event.action, { name: "seekRelative", seconds });
      return;
    }
    const position = clamp(snapshot.positionSeconds + seconds, 0, snapshot.durationSeconds);
    this.executeLatest(event.action, "seek", {
      name: "seekAbsolute",
      seconds: position,
      trackId: snapshot.track.id
    });
  }

  override onTouchTap(event: TouchTapEvent): void {
    const snapshot = this.service.snapshot;
    if (!snapshot?.track || snapshot.durationSeconds <= 0) return;
    const position = seekPositionFromTouch(event.payload.tapPos[0], snapshot.durationSeconds);
    if (!this.service.supportsActiveCapability("seekAbsolute")) {
      this.execute(event.action, {
        name: "seekRelative",
        seconds: position - snapshot.positionSeconds
      });
      return;
    }
    this.executeLatest(event.action, "seek", {
      name: "seekAbsolute",
      seconds: position,
      trackId: snapshot.track.id
    });
  }

  protected override shouldRefresh(kind: ServiceChangeKind): boolean {
    return kind === "state" || kind === "progress";
  }

  protected override async refresh(target: Action, kind: ServiceChangeKind): Promise<void> {
    const snapshot = this.service.snapshot;
    if (target.isKey()) {
      await this.setImage(target, nowPlayingSvg(snapshot), kind === "progress" ? 1_000 : 0);
      await this.setTitle(target, "");
      return;
    }
    if (target.isDial()) {
      await this.setFeedback(target, {
        artwork: snapshot?.track?.artworkDataUrl ?? dialArtworkFallbackSvg(),
        trackTitle: snapshot?.track?.title ?? "Nothing playing",
        artist: snapshot?.track?.artist ?? "",
        time: snapshot
          ? `${formatTime(snapshot.positionSeconds)} / ${formatTime(snapshot.durationSeconds)}`
          : "",
        progress:
          snapshot && snapshot.durationSeconds > 0
            ? Math.round((snapshot.positionSeconds / snapshot.durationSeconds) * 100)
            : 0
      });
    }
  }
}

@action({ UUID: "com.lilremark.nebula-music.play-pause" })
export class PlayPauseAction extends ResponsiveAction<PlaybackSettings> {
  override onKeyDown(event: KeyDownEvent<PlaybackSettings>): void {
    let command: NebulaCommand;
    if (event.payload.isInMultiAction) {
      command = { name: "setPlayback", playing: event.payload.userDesiredState === 1 };
    } else {
      const desired = event.payload.settings.desiredState ?? "toggle";
      command =
        desired === "toggle"
          ? { name: "togglePlayback" }
          : { name: "setPlayback", playing: desired === "play" };
    }
    this.execute(event.action, command);
  }

  protected override shouldRefresh(kind: ServiceChangeKind): boolean {
    return kind === "state" || kind === "progress";
  }

  protected override async refresh(target: Action<PlaybackSettings>): Promise<void> {
    if (!target.isKey()) return;
    await this.setState(target, this.service.snapshot?.playing ? 1 : 0);
    await this.setTitle(target, "");
  }
}

abstract class TransportAction extends ResponsiveAction {
  protected abstract readonly commandName: "previous" | "next";

  override onKeyDown(event: KeyDownEvent): void {
    this.execute(event.action, { name: this.commandName });
  }

  protected override async refresh(target: Action): Promise<void> {
    if (target.isKey()) await this.setTitle(target, "");
  }
}

@action({ UUID: "com.lilremark.nebula-music.previous" })
export class PreviousAction extends TransportAction {
  protected readonly commandName = "previous" as const;
}

@action({ UUID: "com.lilremark.nebula-music.next" })
export class NextAction extends TransportAction {
  protected readonly commandName = "next" as const;
}

@action({ UUID: "com.lilremark.nebula-music.volume" })
export class VolumeAction extends ResponsiveAction {
  override onKeyDown(event: KeyDownEvent): void {
    this.toggleMute(event.action);
  }

  override onDialDown(event: DialDownEvent): void {
    this.toggleMute(event.action);
  }

  override onDialRotate(event: DialRotateEvent<CommonSettings>): void {
    const current = this.service.snapshot?.volume ?? 0;
    const volume = steppedVolume(
      current,
      event.payload.ticks,
      event.payload.settings.volumeStepPercent ?? 2
    );
    this.executeLatest(event.action, "volume", { name: "setVolume", volume });
  }

  override onTouchTap(event: TouchTapEvent): void {
    const volume = volumeFromTouch(event.payload.tapPos[0]);
    this.executeLatest(event.action, "volume", { name: "setVolume", volume });
  }

  protected override shouldRefresh(kind: ServiceChangeKind): boolean {
    return kind === "state" || kind === "progress";
  }

  protected override async refresh(target: Action, kind: ServiceChangeKind): Promise<void> {
    const snapshot = this.service.snapshot;
    if (target.isKey()) {
      await this.setImage(target, volumeSvg(snapshot), kind === "progress" ? 1_000 : 0);
      await this.setTitle(target, "");
      return;
    }
    if (target.isDial()) {
      await this.setFeedback(target, {
        icon: dialIconSvg("volume", !snapshot || snapshot.muted),
        value: snapshot ? `${Math.round(snapshot.volume * 100)}%` : "—",
        volume: Math.round((snapshot?.volume ?? 0) * 100)
      });
    }
  }

  private toggleMute(target: Action): void {
    const current = this.service.snapshot?.volume ?? 0;
    const volume = current > 0 ? 0 : this.service.lastNonZeroVolume;
    this.executeLatest(target, "volume", { name: "setVolume", volume });
  }
}

@action({ UUID: "com.lilremark.nebula-music.playlist" })
export class PlaylistAction extends ResponsiveAction<PlaylistSettings> {
  override onKeyDown(event: KeyDownEvent<PlaylistSettings>): void {
    const playlistId = event.payload.settings.playlistId;
    if (!playlistId) {
      void event.action.showAlert();
      return;
    }
    this.execute(event.action, { name: "startPlaylist", playlistId });
  }

  protected override async refresh(target: Action<PlaylistSettings>): Promise<void> {
    if (!target.isKey()) return;
    const settings = await target.getSettings<PlaylistSettings>();
    await this.setImage(target, playlistSvg(settings.playlistName ?? "Choose playlist"));
    await this.setTitle(target, "");
  }
}

@action({ UUID: "com.lilremark.nebula-music.playlist-browser" })
export class PlaylistBrowserAction extends ResponsiveAction {
  readonly #selected = new Map<string, number>();

  override async onDialRotate(event: DialRotateEvent): Promise<void> {
    const playlists = this.service.snapshot?.playlists ?? [];
    if (playlists.length === 0) {
      await event.action.showAlert();
      return;
    }
    const current = this.#selected.get(event.action.id) ?? 0;
    const next = mod(current + event.payload.ticks, playlists.length);
    this.#selected.set(event.action.id, next);
    await this.requestRefresh(event.action);
  }

  override async onDialDown(event: DialDownEvent): Promise<void> {
    await this.startSelected(event.action);
  }

  override async onTouchTap(event: TouchTapEvent): Promise<void> {
    await this.startSelected(event.action);
  }

  protected override async refresh(target: Action): Promise<void> {
    if (!target.isDial()) return;
    const playlists = this.service.snapshot?.playlists ?? [];
    const index = Math.min(this.#selected.get(target.id) ?? 0, Math.max(0, playlists.length - 1));
    this.#selected.set(target.id, index);
    const playlist = playlists[index];
    await this.setFeedback(target, {
      icon: dialIconSvg("playlist"),
      playlist: playlist?.name ?? "No playlists",
      position: playlist ? `${index + 1} / ${playlists.length}` : "—"
    });
  }

  private async startSelected(target: Action): Promise<void> {
    const playlists = this.service.snapshot?.playlists ?? [];
    const playlist = playlists[this.#selected.get(target.id) ?? 0];
    if (!playlist) {
      await target.showAlert();
      return;
    }
    this.execute(target, { name: "startPlaylist", playlistId: playlist.id });
  }
}

@action({ UUID: "com.lilremark.nebula-music.connection" })
export class ConnectionAction extends ResponsiveAction {
  override async onKeyDown(event: KeyDownEvent): Promise<void> {
    this.service.issuePairingCode();
    await this.requestRefresh(event.action);
  }

  protected override async refresh(target: Action): Promise<void> {
    if (!target.isKey()) return;
    const status = this.service.getStatus();
    const connected = status.instances.some((instance) => instance.authenticated);
    const subtitle =
      status.status === "port-conflict"
        ? "Port conflict"
        : connected
          ? "Connected"
          : status.pairingCode
            ? `Code ${status.pairingCode}`
            : "Press for code";
    await this.setImage(target, statusSvg("Nebula Link", subtitle, "link"));
    await this.setTitle(target, "");
  }

  protected override shouldRefresh(kind: ServiceChangeKind): boolean {
    return kind === "state" || kind === "status";
  }
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function mergeChangeKinds(left: ServiceChangeKind, right: ServiceChangeKind): ServiceChangeKind {
  const priority: Record<ServiceChangeKind, number> = {
    progress: 0,
    status: 1,
    state: 2
  };
  return priority[left] >= priority[right] ? left : right;
}
