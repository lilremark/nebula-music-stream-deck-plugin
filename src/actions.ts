import {
  action,
  type Action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  Target,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from "@elgato/streamdeck";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import { LatestFeedbackDispatcher } from "./core/feedback-dispatcher.js";
import { nowPlayingPressCommand } from "./core/interaction.js";
import {
  clamp,
  seekPositionFromTouch,
  seekSeconds,
  steppedPitch,
  steppedPlaybackRate,
  steppedVolume,
  volumeFromTouch
} from "./core/math.js";
import { FrozenArtworkCache } from "./core/now-playing-key.js";
import { HiddenContextCache } from "./core/retained-cache.js";
import { settingsEqual } from "./core/settings.js";
import type { NebulaCommand } from "./protocol/schema.js";
import {
  formatTime,
  nowPlayingKeyImage,
  nowPlayingSvg,
  playlistSvg,
  statusSvg,
  volumeKeyState
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

type PlaybackTuningSettings = CommonSettings & {
  tuningTarget?: "speed" | "pitch" | "both";
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

const MAX_RETAINED_ACTIONS = 64;

abstract class ResponsiveAction<
  T extends CommonSettings = CommonSettings
> extends SingletonAction<T> {
  readonly #dispatcher: CommandDispatcher<QueuedCommand>;
  readonly #feedbackDispatcher: LatestFeedbackDispatcher<Action<T>>;
  readonly #refreshes = new Map<string, RefreshState<T>>();
  readonly #images = new Map<string, string | undefined>();
  readonly #states = new Map<string, number>();
  readonly #settings = new Map<string, T>();
  readonly #lastAlertAt = new Map<string, number>();
  readonly #retainedActions = new HiddenContextCache(MAX_RETAINED_ACTIONS);

  constructor(protected readonly service: NebulaService) {
    super();
    this.#dispatcher = new CommandDispatcher(({ command, operation }) =>
      service.command(command, false, operation)
    );
    this.#feedbackDispatcher = new LatestFeedbackDispatcher((target, feedback) =>
      target.isDial() ? target.setFeedback(feedback) : Promise.resolve()
    );
    service.on("change", (kind: ServiceChangeKind) => {
      if (!this.shouldRefresh(kind)) return;
      this.actions.forEach((visible) => {
        void this.requestRefresh(visible, kind);
      });
    });
  }

  override async onWillAppear(event: WillAppearEvent<T>): Promise<void> {
    this.#retainedActions.show(event.action.id);
    this.#settings.set(event.action.id, event.payload.settings);
    await this.requestRefresh(event.action);
  }

  override onWillDisappear(event: WillDisappearEvent<T>): void {
    this.#refreshes.delete(event.action.id);
    this.#lastAlertAt.delete(event.action.id);
    this.retainHiddenFeedbackCache(event.action.id);
  }

  override async onDidReceiveSettings(event: DidReceiveSettingsEvent<T>): Promise<void> {
    const previousSettings = this.#settings.get(event.action.id);
    if (previousSettings && settingsEqual(previousSettings, event.payload.settings)) return;
    this.#settings.set(event.action.id, event.payload.settings);
    await this.requestRefresh(event.action);
  }

  protected abstract refresh(target: Action<T>, kind: ServiceChangeKind): Promise<void>;

  protected settingsFor(target: Action<T>): T {
    return this.#settings.get(target.id) ?? ({} as T);
  }

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
      void error;
      void this.showAlert(target);
    });
  }

  protected executeLatest(target: Action<T>, lane: string, command: NebulaCommand): void {
    const operation = this.service.preview(command);
    this.#dispatcher.dispatchLatest(
      `${lane}:${target.id}`,
      operation ? { command, operation } : { command },
      (error) => {
        void error;
        void this.showAlert(target);
      }
    );
  }

  protected async showAlert(target: Action<T>, minimumIntervalMs = 1_000): Promise<void> {
    const now = Date.now();
    if (now - (this.#lastAlertAt.get(target.id) ?? 0) < minimumIntervalMs) return;
    this.#lastAlertAt.set(target.id, now);
    await target.showAlert();
  }

  protected async setImage(
    target: Action<T>,
    image: string | undefined,
    state?: 0 | 1
  ): Promise<void> {
    if (!target.isKey()) return;
    const cacheKey = `${target.id}:${state ?? "all"}`;
    if (this.#images.has(cacheKey) && this.#images.get(cacheKey) === image) return;
    await target.setImage(image, {
      target: Target.HardwareAndSoftware,
      ...(state !== undefined ? { state } : {})
    });
    this.#images.set(cacheKey, image);
  }

  protected async setState(target: Action<T>, state: number): Promise<void> {
    if (!target.isKey() || this.#states.get(target.id) === state) return;
    await target.setState(state);
    this.#states.set(target.id, state);
  }

  protected setFeedback(
    target: Action<T>,
    feedback: Record<string, string | number>
  ): Promise<void> {
    if (target.isDial()) this.#feedbackDispatcher.update(target.id, target, feedback);
    return Promise.resolve();
  }

  private async drainRefreshes(state: RefreshState<T>): Promise<void> {
    while (state.queued) {
      state.queued = false;
      const kind = state.kind;
      state.kind = "progress";
      await this.refresh(state.target, kind);
    }
  }

  private clearFeedbackCache(actionId: string): void {
    for (const key of this.#images.keys()) {
      if (key.startsWith(`${actionId}:`)) this.#images.delete(key);
    }
    this.#states.delete(actionId);
    this.#feedbackDispatcher.clear(actionId);
  }

  private retainHiddenFeedbackCache(actionId: string): void {
    const evictedActionId = this.#retainedActions.hide(actionId);
    if (!evictedActionId) return;
    this.#settings.delete(evictedActionId);
    this.clearFeedbackCache(evictedActionId);
  }
}

@action({ UUID: "com.lilremark.nebula-music.now-playing" })
export class NowPlayingAction extends ResponsiveAction {
  readonly #artwork = new FrozenArtworkCache();

  override onDialDown(event: DialDownEvent): void {
    const command = nowPlayingPressCommand("dial");
    if (command) this.execute(event.action, command);
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
      const trackKey = snapshot?.track
        ? `${snapshot.sessionId}:${snapshot.track.id}`
        : `idle:${snapshot?.sessionId ?? "disconnected"}`;
      const image = this.#artwork.select(trackKey, {
        image: nowPlayingKeyImage(snapshot),
        hasArtwork: Boolean(snapshot?.track?.artworkDataUrl)
      });
      const composite =
        snapshot?.track === undefined || snapshot.track === null
          ? nowPlayingSvg(snapshot)
          : nowPlayingSvg({
              ...snapshot,
              track: { ...snapshot.track, artworkDataUrl: image }
            });
      await this.setImage(target, composite);
      return;
    }
    if (target.isDial()) {
      const track = snapshot?.track;
      const progress = {
        state: snapshot?.playing ? "PLAYING" : "PAUSED",
        time: snapshot
          ? `${formatTime(snapshot.positionSeconds)} / ${formatTime(snapshot.durationSeconds)}`
          : "",
        progress:
          snapshot && snapshot.durationSeconds > 0
            ? Math.round((snapshot.positionSeconds / snapshot.durationSeconds) * 100)
            : 0
      };
      await this.setFeedback(
        target,
        kind === "progress"
          ? progress
          : {
              ...progress,
              trackTitle: track?.title ?? "Nothing playing",
              artist: track?.artist ?? "",
              album: track?.album ?? ""
            }
      );
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
  }
}

abstract class TransportAction extends ResponsiveAction {
  protected abstract readonly commandName: "previous" | "next";

  override onKeyDown(event: KeyDownEvent): void {
    this.execute(event.action, { name: this.commandName });
  }

  protected override refresh(): Promise<void> {
    return Promise.resolve();
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

  protected override async refresh(target: Action): Promise<void> {
    const snapshot = this.service.snapshot;
    if (target.isKey()) {
      const state = volumeKeyState(snapshot);
      await this.setImage(target, undefined, state);
      await this.setState(target, state);
      return;
    }
    if (target.isDial()) {
      await this.setFeedback(target, {
        state: !snapshot || snapshot.muted ? "MUTED" : "ACTIVE",
        value: snapshot ? `${Math.round(snapshot.volume * 100)}%` : "—",
        hint: "ROTATE · PRESS TO MUTE",
        volume: Math.round((snapshot?.volume ?? 0) * 100)
      });
    }
  }

  private toggleMute(target: Action): void {
    const current = this.service.snapshot?.volume ?? 0;
    const volume = current > 0 ? 0 : this.service.lastNonZeroVolume;
    this.executeLatest(target, "volume", { name: "setVolume", volume });
    void this.requestRefresh(target, "state");
  }
}

@action({ UUID: "com.lilremark.nebula-music.speed-pitch" })
export class SpeedPitchAction extends ResponsiveAction<PlaybackTuningSettings> {
  override async onDialDown(event: DialDownEvent): Promise<void> {
    if (!this.service.supportsActiveCapability("playbackTuning")) {
      await this.showAlert(event.action);
      return;
    }
    const enabled = !(this.service.snapshot?.pitchCorrection ?? true);
    this.executeLatest(event.action, "pitch-correction", {
      name: "setPitchCorrection",
      enabled
    });
  }

  override async onDialRotate(event: DialRotateEvent<PlaybackTuningSettings>): Promise<void> {
    if (!this.service.supportsActiveCapability("playbackTuning")) {
      await this.showAlert(event.action);
      return;
    }
    const ticks = event.payload.ticks;
    if (ticks === 0) return;
    const target = event.payload.settings.tuningTarget ?? "speed";
    const snapshot = this.service.snapshot;
    if (target === "speed" || target === "both") {
      this.executeLatest(event.action, "playback-rate", {
        name: "setPlaybackRate",
        playbackRate: steppedPlaybackRate(snapshot?.playbackRate ?? 1, ticks)
      });
    }
    if (target === "pitch" || target === "both") {
      this.executeLatest(event.action, "pitch", {
        name: "setPitch",
        pitchSemitones: steppedPitch(snapshot?.pitchSemitones ?? 0, ticks)
      });
    }
  }

  protected override async refresh(target: Action<PlaybackTuningSettings>): Promise<void> {
    if (!target.isDial()) return;
    const settings = this.settingsFor(target);
    const supported = this.service.supportsActiveCapability("playbackTuning");
    const snapshot = this.service.snapshot;
    await this.setFeedback(target, {
      mode: supported ? (snapshot?.pitchCorrection === false ? "ANALOGUE" : "DIGITAL") : "UPDATE",
      speed: supported ? `${(snapshot?.playbackRate ?? 1).toFixed(1)}×` : "—",
      pitch: supported ? formatPitch(snapshot?.pitchSemitones ?? 0) : "—",
      target: supported
        ? `KNOB · ${(settings.tuningTarget ?? "speed").toUpperCase()}`
        : "NEBULA REQUIRED"
    });
  }

  protected override shouldRefresh(kind: ServiceChangeKind): boolean {
    return kind === "state" || kind === "progress";
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
    const settings = this.settingsFor(target);
    await this.setImage(target, playlistSvg(settings.playlistName ?? "Choose playlist"));
  }
}

@action({ UUID: "com.lilremark.nebula-music.playlist-browser" })
export class PlaylistBrowserAction extends ResponsiveAction {
  readonly #selected = new Map<string, number>();

  override onDialRotate(event: DialRotateEvent): void {
    const playlists = this.service.snapshot?.playlists ?? [];
    if (playlists.length === 0) {
      void this.showAlert(event.action);
      return;
    }
    const current = this.#selected.get(event.action.id) ?? 0;
    const next = mod(current + event.payload.ticks, playlists.length);
    this.#selected.set(event.action.id, next);
    void this.requestRefresh(event.action);
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
      playlist: playlist?.name ?? "No playlists",
      position: playlist ? `${index + 1} / ${playlists.length}` : "—",
      hint: playlist ? "ROTATE · PRESS TO PLAY" : "NEBULA REQUIRED"
    });
  }

  private async startSelected(target: Action): Promise<void> {
    const playlists = this.service.snapshot?.playlists ?? [];
    const playlist = playlists[this.#selected.get(target.id) ?? 0];
    if (!playlist) {
      await this.showAlert(target);
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

function formatPitch(semitones: number): string {
  return `${semitones > 0 ? "+" : ""}${Math.round(semitones)} st`;
}
