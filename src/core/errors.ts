import type { CommandErrorCode } from "../protocol/schema.js";

export class NebulaCommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string
  ) {
    super(message);
    this.name = "NebulaCommandError";
  }
}

export function commandErrorLabel(error: unknown): string {
  if (!(error instanceof NebulaCommandError)) return "Command failed";
  switch (error.code) {
    case "unauthorized":
      return "Pair again";
    case "disconnected":
      return "Nebula offline";
    case "stale_playlist":
      return "Playlist changed";
    case "empty_playlist":
      return "Playlist empty";
    case "invalid_command":
      return "Invalid action";
    case "playback_failed":
      return "Playback failed";
    case "internal_error":
      return "Nebula error";
  }
}
