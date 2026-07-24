import type { NebulaCommand } from "../protocol/schema.js";

export type NowPlayingPressTarget = "key" | "dial";

export function nowPlayingPressCommand(target: NowPlayingPressTarget): NebulaCommand | undefined {
  return target === "dial" ? { name: "togglePlayback" } : undefined;
}
