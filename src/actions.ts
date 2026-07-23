import {
  action,
  type Action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent
} from "@elgato/streamdeck";
import { commandErrorLabel } from "./core/errors.js";
import { seekSeconds, steppedVolume, volumeFromTouch } from "./core/math.js";
import type { NebulaCommand } from "./protocol/schema.js";
import { formatTime, nowPlayingSvg, playlistSvg, statusSvg, volumeSvg } from "./render/svg.js";
import type { NebulaService } from "./service.js";

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

abstract class ResponsiveAction<
  T extends CommonSettings = CommonSettings
> extends SingletonAction<T> {
  constructor(protected readonly service: NebulaService) {
    super();
    service.on("change", () => {
      this.actions.forEach((visible) => {
        void this.refresh(visible as Action<T>);
      });
    });
  }

  override async onWillAppear(event: WillAppearEvent<T>): Promise<void> {
    await this.refresh(event.action);
  }

  override async onDidReceiveSettings(event: DidReceiveSettingsEvent<T>): Promise<void> {
    await this.refresh(event.action);
  }

  protected abstract refresh(target: Action<T>): Promise<void>;

  protected async execute(target: Action<T>, command: NebulaCommand): Promise<boolean> {
    try {
      await this.service.command(command);
      return true;
    } catch (error) {
      const label = commandErrorLabel(error);
      await target.showAlert();
      if (target.isKey()) await target.setImage(statusSvg("Command failed", label, "!"));
      else if (target.isDial()) await target.setTitle(label);
      const reset = setTimeout(() => {
        void this.refresh(target);
      }, 1_500);
      reset.unref();
      return false;
    }
  }
}

@action({ UUID: "com.lilremark.nebula-music.now-playing" })
export class NowPlayingAction extends ResponsiveAction {
  override async onKeyDown(event: KeyDownEvent): Promise<void> {
    await this.execute(event.action, { name: "togglePlayback" });
  }

  override async onDialDown(event: DialDownEvent): Promise<void> {
    await this.execute(event.action, { name: "togglePlayback" });
  }

  override async onDialRotate(event: DialRotateEvent<CommonSettings>): Promise<void> {
    const seconds = seekSeconds(event.payload.ticks, event.payload.settings.seekStepSeconds ?? 5);
    if (seconds !== 0) await this.execute(event.action, { name: "seekRelative", seconds });
  }

  override async onTouchTap(event: TouchTapEvent): Promise<void> {
    await this.execute(event.action, { name: "togglePlayback" });
  }

  protected override async refresh(target: Action): Promise<void> {
    const snapshot = this.service.snapshot;
    if (target.isKey()) {
      await target.setImage(nowPlayingSvg(snapshot));
      await target.setTitle("");
      return;
    }
    if (target.isDial()) {
      await target.setFeedback({
        artwork: snapshot?.track?.artworkDataUrl ?? "",
        title: snapshot?.track?.title ?? "Nebula Music",
        artist: snapshot?.track?.artist ?? "Disconnected",
        time: snapshot
          ? `${formatTime(snapshot.positionSeconds)} / ${formatTime(snapshot.durationSeconds)}`
          : "—",
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
  override async onKeyDown(event: KeyDownEvent<PlaybackSettings>): Promise<void> {
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
    await this.execute(event.action, command);
  }

  protected override async refresh(target: Action<PlaybackSettings>): Promise<void> {
    if (!target.isKey()) return;
    await target.setState(this.service.snapshot?.playing ? 1 : 0);
    await target.setTitle(this.service.snapshot ? "" : "Offline");
  }
}

abstract class TransportAction extends ResponsiveAction {
  protected abstract readonly commandName: "previous" | "next";

  override async onKeyDown(event: KeyDownEvent): Promise<void> {
    await this.execute(event.action, { name: this.commandName });
  }

  protected override async refresh(target: Action): Promise<void> {
    if (target.isKey()) await target.setTitle(this.service.snapshot ? "" : "Offline");
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
  override async onKeyDown(event: KeyDownEvent): Promise<void> {
    await this.toggleMute(event.action);
  }

  override async onDialDown(event: DialDownEvent): Promise<void> {
    await this.toggleMute(event.action);
  }

  override async onDialRotate(event: DialRotateEvent<CommonSettings>): Promise<void> {
    const current = this.service.snapshot?.volume ?? 0;
    const volume = steppedVolume(
      current,
      event.payload.ticks,
      event.payload.settings.volumeStepPercent ?? 2
    );
    await this.execute(event.action, { name: "setVolume", volume });
  }

  override async onTouchTap(event: TouchTapEvent): Promise<void> {
    const volume = volumeFromTouch(event.payload.tapPos[0]);
    await this.execute(event.action, { name: "setVolume", volume });
  }

  protected override async refresh(target: Action): Promise<void> {
    const snapshot = this.service.snapshot;
    if (target.isKey()) {
      await target.setImage(volumeSvg(snapshot));
      await target.setTitle("");
      return;
    }
    if (target.isDial()) {
      await target.setFeedback({
        icon: snapshot?.muted ? "🔇" : "🔊",
        title: "Volume",
        value: snapshot ? `${Math.round(snapshot.volume * 100)}%` : "Offline",
        volume: Math.round((snapshot?.volume ?? 0) * 100)
      });
    }
  }

  private async toggleMute(target: Action): Promise<void> {
    const current = this.service.snapshot?.volume ?? 0;
    const volume = current > 0 ? 0 : this.service.lastNonZeroVolume;
    await this.execute(target, { name: "setVolume", volume });
  }
}

@action({ UUID: "com.lilremark.nebula-music.playlist" })
export class PlaylistAction extends ResponsiveAction<PlaylistSettings> {
  override async onKeyDown(event: KeyDownEvent<PlaylistSettings>): Promise<void> {
    const playlistId = event.payload.settings.playlistId;
    if (!playlistId) {
      await event.action.showAlert();
      return;
    }
    await this.execute(event.action, { name: "startPlaylist", playlistId });
  }

  protected override async refresh(target: Action<PlaylistSettings>): Promise<void> {
    if (!target.isKey()) return;
    const settings = await target.getSettings<PlaylistSettings>();
    await target.setImage(
      playlistSvg(settings.playlistName ?? "Choose playlist", Boolean(this.service.snapshot))
    );
    await target.setTitle("");
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
    await this.refresh(event.action);
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
    await target.setFeedback({
      icon: "☷",
      title: "Playlists",
      playlist: playlist?.name ?? (this.service.snapshot ? "No playlists" : "Disconnected"),
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
    await this.execute(target, { name: "startPlaylist", playlistId: playlist.id });
  }
}

@action({ UUID: "com.lilremark.nebula-music.connection" })
export class ConnectionAction extends ResponsiveAction {
  override async onKeyDown(event: KeyDownEvent): Promise<void> {
    this.service.issuePairingCode();
    await this.refresh(event.action);
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
    await target.setImage(statusSvg("Nebula Link", subtitle, connected ? "✓" : "⌁"));
    await target.setTitle("");
  }
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
