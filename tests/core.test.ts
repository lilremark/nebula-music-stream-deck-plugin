import { describe, expect, it, vi } from "vitest";
import { changedFeedback, CommandDispatcher } from "../src/core/command-dispatcher.js";
import { LatestFeedbackDispatcher } from "../src/core/feedback-dispatcher.js";
import { nowPlayingPressCommand } from "../src/core/interaction.js";
import {
  DIAL_MARQUEE_LIMITS,
  keyMetadataTitle,
  marqueeText,
  metadataNeedsMarquee
} from "../src/core/marquee.js";
import {
  clamp,
  seekPositionFromTouch,
  seekSeconds,
  steppedPitch,
  steppedPlaybackRate,
  steppedVolume,
  volumeFromTouch
} from "../src/core/math.js";
import { commandErrorLabel, NebulaCommandError } from "../src/core/errors.js";
import {
  acceptsConnectionCommand,
  CONNECTION_ACTION,
  PLAYLIST_ACTION,
  propertyInspectorScope
} from "../src/core/property-inspector.js";
import { selectActiveInstance, type InstanceCandidate } from "../src/core/selection.js";
import { commandSchema, PROTOCOL, parseBrowserMessage } from "../src/protocol/schema.js";
import {
  dialArtworkFallbackSvg,
  dialIconSvg,
  formatTime,
  keyArtworkFallbackSvg,
  nowPlayingKeyImage,
  nowPlayingSvg,
  playlistSvg,
  volumeSvg
} from "../src/render/svg.js";

const base: InstanceCandidate = {
  sessionId: "base",
  authenticated: true,
  connectedAt: 1,
  hello: { visible: false, lastActiveAt: 1 }
};

describe("selection", () => {
  it("prefers a connected pin, then playing, visible, active and newest instances", () => {
    const playing = {
      ...base,
      sessionId: "playing",
      snapshot: { playing: true }
    } as InstanceCandidate;
    const visible = {
      ...base,
      sessionId: "visible",
      hello: { visible: true, lastActiveAt: 2 }
    };
    const unauthorized = { ...base, sessionId: "pin", authenticated: false };
    expect(selectActiveInstance([visible, playing, unauthorized], "pin")?.sessionId).toBe(
      "playing"
    );
    expect(selectActiveInstance([visible, playing], "visible")?.sessionId).toBe("visible");
    expect(selectActiveInstance([{ ...base, sessionId: "old" }, visible])?.sessionId).toBe(
      "visible"
    );
    expect(
      selectActiveInstance([
        { ...base, sessionId: "less-active", hello: { visible: true, lastActiveAt: 2 } },
        { ...base, sessionId: "more-active", hello: { visible: true, lastActiveAt: 8 } }
      ])?.sessionId
    ).toBe("more-active");
    expect(
      selectActiveInstance([
        { ...base, sessionId: "older", connectedAt: 1 },
        { ...base, sessionId: "newer", connectedAt: 2 }
      ])?.sessionId
    ).toBe("newer");
    expect(selectActiveInstance([])).toBeUndefined();
  });
});

describe("control math", () => {
  it("clamps values and applies dial/touch steps", () => {
    expect(clamp(20, 0, 10)).toBe(10);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(volumeFromTouch(100)).toBe(0.5);
    expect(volumeFromTouch(300)).toBe(1);
    expect(steppedVolume(0.5, 2)).toBeCloseTo(0.54);
    expect(steppedPlaybackRate(1, 3)).toBe(1.3);
    expect(steppedPlaybackRate(1.9, 5)).toBe(2);
    expect(steppedPitch(0, -3)).toBe(-3);
    expect(steppedPitch(10, 5)).toBe(12);
    expect(seekSeconds(-3)).toBe(-15);
    expect(seekSeconds(100_000)).toBe(86_400);
    expect(seekPositionFromTouch(4, 200)).toBe(0);
    expect(seekPositionFromTouch(100, 200)).toBe(100);
    expect(seekPositionFromTouch(196, 200)).toBe(200);
    expect(seekPositionFromTouch(300, 200)).toBe(200);
    expect(seekPositionFromTouch(100, Number.NaN)).toBe(0);
    const error = new NebulaCommandError("empty_playlist", "No tracks");
    expect(error.name).toBe("NebulaCommandError");
    expect(error.code).toBe("empty_playlist");
    expect(commandErrorLabel(error)).toBe("Playlist empty");
    expect(commandErrorLabel(new Error("unknown"))).toBe("Command failed");
    expect(
      [
        "unauthorized",
        "disconnected",
        "stale_playlist",
        "empty_playlist",
        "invalid_command",
        "playback_failed",
        "internal_error"
      ].map((code) =>
        commandErrorLabel(
          new NebulaCommandError(
            code as ConstructorParameters<typeof NebulaCommandError>[0],
            "message"
          )
        )
      )
    ).toEqual([
      "Pair again",
      "Nebula offline",
      "Playlist changed",
      "Playlist empty",
      "Invalid action",
      "Playback failed",
      "Nebula error"
    ]);
  });
});

describe("control dispatch", () => {
  it("keeps only the latest high-frequency command while one is in flight", async () => {
    const completions: Array<() => void> = [];
    const send = vi.fn((command: number) => {
      void command;
      return new Promise<void>((resolve) => {
        completions.push(resolve);
      });
    });
    const onError = vi.fn();
    const dispatcher = new CommandDispatcher(send);

    dispatcher.dispatchLatest("volume", 1, onError);
    dispatcher.dispatchLatest("volume", 2, onError);
    dispatcher.dispatchLatest("volume", 3, onError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(1);

    completions.shift()?.();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith(3);
    completions.shift()?.();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns only changed feedback fields", () => {
    expect(
      changedFeedback(
        { artwork: "large-data-url", title: "Song", progress: 10 },
        { artwork: "large-data-url", title: "Song", progress: 11, time: "0:11" }
      )
    ).toEqual({ progress: 11, time: "0:11" });
  });

  it("keeps only the newest hardware feedback frame during a burst", async () => {
    vi.useFakeTimers();
    try {
      let finishFirst: (() => void) | undefined;
      const first = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const send = vi
        .fn<(target: string, feedback: Record<string, string | number>) => Promise<void>>()
        .mockImplementationOnce(() => first)
        .mockResolvedValue();
      const dispatcher = new LatestFeedbackDispatcher(send, 50);

      dispatcher.update("dial", "target", { value: 1, state: "ACTIVE" });
      for (let value = 2; value <= 100; value += 1) {
        dispatcher.update("dial", "target", { value, state: "ACTIVE" });
      }
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenLastCalledWith("target", { value: 1, state: "ACTIVE" });

      finishFirst?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith("target", { value: 100 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Now Playing interaction", () => {
  it("keeps the key display-only while retaining dial controls", () => {
    expect(nowPlayingPressCommand("key")).toBeUndefined();
    expect(nowPlayingPressCommand("dial")).toEqual({ name: "togglePlayback" });
  });
});

describe("metadata marquee", () => {
  it("leaves short metadata alone and scrolls overflowing text", () => {
    expect(marqueeText("Short title", 16, 20)).toBe("Short title");
    expect(marqueeText("A title that is much too long", 16, 0)).toBe("A title that is ");
    expect(marqueeText("A title that is much too long", 16, 1)).toBe(" title that is m");
    expect(
      metadataNeedsMarquee(
        {
          title: "A title that is much too long",
          artist: "Artist",
          album: "Album"
        },
        DIAL_MARQUEE_LIMITS
      )
    ).toBe(true);
    expect(
      metadataNeedsMarquee(
        {
          title: "Title",
          artist: "Artist",
          album: "Album"
        },
        DIAL_MARQUEE_LIMITS
      )
    ).toBe(false);
    expect(
      keyMetadataTitle(
        {
          title: "A title that is much too long",
          artist: "Artist",
          album: "Album"
        },
        1
      )
    ).toBe(" title that is muc\nAlbum\nArtist");
    expect(keyMetadataTitle(undefined, 99)).toBe("Nothing playing");
  });
});

describe("property inspector isolation", () => {
  it("exposes connection controls only to the Connection action", () => {
    expect(propertyInspectorScope(CONNECTION_ACTION)).toBe("connection");
    expect(propertyInspectorScope(PLAYLIST_ACTION)).toBe("playlists");
    expect(propertyInspectorScope("com.lilremark.nebula-music.volume")).toBeUndefined();
    expect(acceptsConnectionCommand(CONNECTION_ACTION)).toBe(true);
    expect(acceptsConnectionCommand(PLAYLIST_ACTION)).toBe(false);
  });
});

describe("protocol", () => {
  it("accepts versioned hello messages and rejects invalid protocol data", () => {
    expect(
      parseBrowserMessage({
        protocol: PROTOCOL,
        type: "hello",
        sessionId: "session",
        clientId: "client",
        origin: "https://music.example.test",
        nebulaVersion: "1.2.3",
        visible: true,
        lastActiveAt: 10,
        capabilities: ["seekAbsolute", "playbackTuning"]
      })?.type
    ).toBe("hello");
    expect(
      parseBrowserMessage({
        protocol: PROTOCOL,
        type: "hello",
        sessionId: "session",
        clientId: "client",
        origin: "https://music.example.test",
        nebulaVersion: "1.2.3",
        visible: true,
        lastActiveAt: 10,
        capabilities: ["unknown"]
      })
    ).toBeUndefined();
    expect(parseBrowserMessage({ protocol: "wrong", type: "heartbeat" })).toBeUndefined();
    expect(commandSchema.safeParse({ name: "setPlaybackRate", playbackRate: 1.2 }).success).toBe(
      true
    );
    expect(commandSchema.safeParse({ name: "setPitch", pitchSemitones: -4 }).success).toBe(true);
    expect(commandSchema.safeParse({ name: "setPitchCorrection", enabled: false }).success).toBe(
      true
    );
    expect(commandSchema.safeParse({ name: "setPlaybackRate", playbackRate: 2.1 }).success).toBe(
      false
    );
    expect(
      parseBrowserMessage({
        protocol: PROTOCOL,
        type: "commandResult",
        requestId: "request",
        ok: false,
        error: { code: "empty_playlist", message: "No tracks" }
      })?.type
    ).toBe("commandResult");
    expect(
      parseBrowserMessage({
        protocol: PROTOCOL,
        type: "state",
        snapshot: {
          sessionId: "s",
          clientId: "c",
          origin: "https://example.test",
          nebulaVersion: "1",
          visible: true,
          lastActiveAt: 1,
          connectedAt: 1,
          playing: false,
          positionSeconds: 0,
          durationSeconds: 1,
          volume: 1,
          muted: false,
          track: null,
          playlists: []
        }
      })?.type
    ).toBe("state");
    expect(
      parseBrowserMessage({
        protocol: PROTOCOL,
        type: "progress",
        sessionId: "s",
        positionSeconds: 40,
        durationSeconds: 120,
        playing: true,
        volume: 0.42,
        muted: false
      })
    ).toMatchObject({ type: "progress", volume: 0.42, muted: false });
    expect(
      commandSchema.safeParse({
        name: "seekAbsolute",
        seconds: 60,
        trackId: "track"
      }).success
    ).toBe(true);
  });
});

describe("SVG rendering", () => {
  it("renders action-specific device states safely", () => {
    expect(nowPlayingSvg()).toContain("NOTHING PLAYING");
    expect(nowPlayingSvg()).not.toContain("Disconnected");
    expect(volumeSvg()).not.toContain("Disconnected");
    expect(playlistSvg("Favorites")).toContain("Favorites");
    const svg = nowPlayingSvg({
      sessionId: "s",
      clientId: "c",
      origin: "https://example.test",
      nebulaVersion: "1",
      visible: true,
      lastActiveAt: 1,
      connectedAt: 1,
      playing: true,
      positionSeconds: 30,
      durationSeconds: 120,
      volume: 0.5,
      muted: false,
      track: {
        id: "t",
        title: "<Danger & Friends>",
        artist: "A very long artist name which scrolls",
        album: "A very long album name which scrolls"
      },
      playlists: []
    });
    expect(svg).toContain("&lt;Danger &amp;");
    expect(svg).not.toContain("NOW PLAYING");
    expect(svg).toContain('id="shade"');
    expect(svg).not.toContain('cx="126"');
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(Number.NaN)).toBe("0:00");
    const mutedVolume = volumeSvg({
      sessionId: "s",
      clientId: "c",
      origin: "https://example.test",
      nebulaVersion: "1",
      visible: true,
      lastActiveAt: 1,
      connectedAt: 1,
      playing: false,
      positionSeconds: 0,
      durationSeconds: 0,
      volume: 0,
      muted: true,
      track: null,
      playlists: []
    });
    expect(mutedVolume).toContain("MUTED");
    expect(mutedVolume).toContain('d="M2 3l20 18"');
    expect(playlistSvg("Playlist")).not.toContain("Disconnected");
    expect(dialIconSvg("volume")).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(dialIconSvg("playlist")).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(dialArtworkFallbackSvg()).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(keyArtworkFallbackSvg()).toMatch(/^data:image\/svg\+xml;base64,/u);
    const artwork = "data:image/png;base64,AA==";
    expect(
      nowPlayingKeyImage({
        sessionId: "s",
        clientId: "c",
        origin: "https://example.test",
        nebulaVersion: "1",
        visible: true,
        lastActiveAt: 1,
        connectedAt: 1,
        playing: true,
        positionSeconds: 0,
        durationSeconds: 1,
        volume: 1,
        muted: false,
        track: { id: "t", title: "Title", artist: "Artist", artworkDataUrl: artwork },
        playlists: []
      })
    ).toBe(artwork);
  });
});
