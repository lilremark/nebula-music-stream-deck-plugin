import { z } from "zod";

export const PROTOCOL = "nebula-streamdeck/1" as const;

const protocol = z.literal(PROTOCOL);
const identifier = z.string().min(1).max(256);
const cryptographicValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export const trackSchema = z.object({
  id: identifier,
  title: z.string().max(512),
  artist: z.string().max(512),
  album: z.string().max(512).optional(),
  artworkDataUrl: z
    .string()
    .max(512_000)
    .refine((value) => /^data:image\/(?:png|jpeg|webp);base64,/u.test(value), "Invalid artwork")
    .optional()
});

export const playlistSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(512),
  trackCount: z.number().int().nonnegative().optional()
});

export const snapshotSchema = z.object({
  sessionId: identifier,
  clientId: identifier,
  origin: z.string().url().max(2048),
  nebulaVersion: z.string().max(64),
  visible: z.boolean(),
  lastActiveAt: z.number().int().nonnegative(),
  connectedAt: z.number().int().nonnegative(),
  playing: z.boolean(),
  positionSeconds: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  track: trackSchema.nullable(),
  playlists: z.array(playlistSchema).max(1000)
});

export const commandSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("setPlayback"), playing: z.boolean() }),
  z.object({ name: z.literal("togglePlayback") }),
  z.object({ name: z.literal("previous") }),
  z.object({ name: z.literal("next") }),
  z.object({ name: z.literal("setVolume"), volume: z.number().min(0).max(1) }),
  z.object({
    name: z.literal("seekRelative"),
    seconds: z.number().finite().min(-86_400).max(86_400)
  }),
  z.object({ name: z.literal("startPlaylist"), playlistId: identifier })
]);

const base = { protocol };

export const browserMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("hello"),
    sessionId: identifier,
    clientId: identifier,
    origin: z.string().url().max(2048),
    nebulaVersion: z.string().max(64),
    visible: z.boolean(),
    lastActiveAt: z.number().int().nonnegative()
  }),
  z.object({
    ...base,
    type: z.literal("pair"),
    clientId: identifier,
    code: z.string().regex(/^\d{6}$/u)
  }),
  z.object({
    ...base,
    type: z.literal("authenticate"),
    clientId: identifier,
    proof: cryptographicValue
  }),
  z.object({ ...base, type: z.literal("revoke"), clientId: identifier }),
  z.object({ ...base, type: z.literal("state"), snapshot: snapshotSchema }),
  z.object({
    ...base,
    type: z.literal("progress"),
    sessionId: identifier,
    positionSeconds: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    playing: z.boolean()
  }),
  z.object({
    ...base,
    type: z.literal("commandResult"),
    requestId: identifier,
    ok: z.boolean(),
    error: z
      .object({
        code: z.enum([
          "unauthorized",
          "disconnected",
          "stale_playlist",
          "empty_playlist",
          "playback_failed",
          "invalid_command",
          "internal_error"
        ]),
        message: z.string().max(512)
      })
      .optional()
  }),
  z.object({
    ...base,
    type: z.literal("heartbeat"),
    sessionId: identifier,
    visible: z.boolean(),
    lastActiveAt: z.number().int().nonnegative()
  })
]);

export const pluginMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("authChallenge"), nonce: cryptographicValue }),
  z.object({
    ...base,
    type: z.literal("pairingResult"),
    ok: z.boolean(),
    token: cryptographicValue.optional(),
    error: z
      .enum(["invalid_code", "expired_code", "rate_limited", "protocol_mismatch", "unauthorized"])
      .optional()
  }),
  z.object({ ...base, type: z.literal("revocationResult"), ok: z.boolean() }),
  z.object({ ...base, type: z.literal("requestSnapshot") }),
  z.object({
    ...base,
    type: z.literal("command"),
    requestId: identifier,
    command: commandSchema
  })
]);

export type BrowserMessage = z.infer<typeof browserMessageSchema>;
export type PluginMessage = z.infer<typeof pluginMessageSchema>;
export type NebulaCommand = z.infer<typeof commandSchema>;
export type NebulaSnapshot = z.infer<typeof snapshotSchema>;
export type PlaylistSummary = z.infer<typeof playlistSchema>;
export type CommandErrorCode = NonNullable<
  Extract<BrowserMessage, { type: "commandResult" }>["error"]
>["code"];

export function parseBrowserMessage(input: unknown): BrowserMessage | undefined {
  const result = browserMessageSchema.safeParse(input);
  return result.success ? result.data : undefined;
}
