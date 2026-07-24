import { describe, expect, it, vi } from "vitest";
import { changedFeedback, CommandDispatcher } from "../src/core/command-dispatcher.js";
import {
  clamp,
  seekPositionFromTouch,
  seekSeconds,
  steppedVolume,
  volumeFromTouch
} from "../src/core/math.js";
import { commandErrorLabel, NebulaCommandError } from "../src/core/errors.js";
import { selectActiveInstance, type InstanceCandidate } from "../src/core/selection.js";
import { commandSchema, PROTOCOL, parseBrowserMessage } from "../src/protocol/schema.js";
import { formatTime, nowPlayingSvg, playlistSvg, volumeSvg } from "../src/render/svg.js";

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
        capabilities: ["seekAbsolute"]
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
  it("renders disconnected and connected device states safely", () => {
    expect(nowPlayingSvg()).toContain("Disconnected");
    expect(volumeSvg()).toContain("Disconnected");
    expect(playlistSvg("Favorites", true)).toContain("Favorites");
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
        artist: "A very long artist name which truncates"
      },
      playlists: []
    });
    expect(svg).toContain("&lt;Danger &amp;");
    expect(svg).toContain('width="36"');
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(
      volumeSvg({
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
      })
    ).toContain("0%");
    expect(playlistSvg("Playlist", false)).toContain("Disconnected");
  });
});
