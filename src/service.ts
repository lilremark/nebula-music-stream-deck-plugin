import { EventEmitter } from "node:events";
import streamDeck from "@elgato/streamdeck";
import { z } from "zod";
import {
  NebulaBridgeServer,
  type BridgeChangeKind,
  type BridgeStatus
} from "./core/bridge-server.js";
import { clamp } from "./core/math.js";
import { PairingManager } from "./core/pairing.js";
import type { NebulaCommand, NebulaSnapshot } from "./protocol/schema.js";

const globalSettingsSchema = z.object({
  port: z.number().int().min(1024).max(65525).default(37921),
  pinnedSessionId: z.string().max(256).optional(),
  pairedClients: z
    .array(
      z.object({
        clientId: z.string().min(1).max(256),
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
        pairedAt: z.number().int().nonnegative()
      })
    )
    .default([])
});

export interface ServiceStatus extends BridgeStatus {
  pairingCode?: string;
  pairingExpiresAt?: number;
}

type OptimisticFieldName = "playing" | "positionSeconds" | "volume";

interface OptimisticValue<T> {
  value: T;
  revision: number;
  expiresAt: number;
}

interface OptimisticSnapshot {
  sessionId: string;
  trackId: string | null;
  playing?: OptimisticValue<boolean>;
  positionSeconds?: OptimisticValue<number>;
  volume?: OptimisticValue<number>;
}

export interface OptimisticOperation {
  field: OptimisticFieldName;
  revision: number;
}

export type ServiceChangeKind = BridgeChangeKind;

export class NebulaService extends EventEmitter {
  #server?: NebulaBridgeServer;
  #settings = globalSettingsSchema.parse({});
  #pairingCode: { code: string; expiresAt: number } | undefined;
  #optimistic: OptimisticSnapshot | undefined;
  #nextOptimisticRevision = 0;
  readonly #optimisticTimers = new Map<OptimisticFieldName, NodeJS.Timeout>();
  #optimisticEmitTimer: NodeJS.Timeout | undefined;
  #lastOptimisticEmitAt = 0;
  lastNonZeroVolume = 1;

  get snapshot(): NebulaSnapshot | undefined {
    const snapshot = this.#server?.snapshot;
    const optimistic = this.#optimistic;
    if (
      !snapshot ||
      !optimistic ||
      optimistic.sessionId !== snapshot.sessionId ||
      optimistic.trackId !== (snapshot.track?.id ?? null)
    ) {
      return snapshot;
    }
    const now = Date.now();
    const playing =
      optimistic.playing && optimistic.playing.expiresAt > now
        ? optimistic.playing.value
        : undefined;
    const positionSeconds =
      optimistic.positionSeconds && optimistic.positionSeconds.expiresAt > now
        ? optimistic.positionSeconds.value
        : undefined;
    const volume =
      optimistic.volume && optimistic.volume.expiresAt > now ? optimistic.volume.value : undefined;
    return {
      ...snapshot,
      ...(playing !== undefined ? { playing } : {}),
      ...(positionSeconds !== undefined ? { positionSeconds } : {}),
      ...(volume !== undefined ? { volume, muted: volume === 0 } : {})
    };
  }

  async initialize(): Promise<void> {
    const raw = await streamDeck.settings.getGlobalSettings();
    const parsed = globalSettingsSchema.safeParse(raw);
    this.#settings = parsed.success ? parsed.data : globalSettingsSchema.parse({});
    const pairing = new PairingManager(this.#settings.pairedClients);
    this.#server = new NebulaBridgeServer({
      preferredPort: this.#settings.port,
      pairing,
      ...(this.#settings.pinnedSessionId
        ? { pinnedSessionId: this.#settings.pinnedSessionId }
        : {}),
      persistPairedClients: async () => this.persist(),
      onPortSelected: async (port) => {
        this.#settings.port = port;
        await this.persist();
      }
    });
    this.#server.on("change", (kind: ServiceChangeKind) => {
      this.reconcileOptimistic();
      const volume = this.snapshot?.volume;
      if (volume !== undefined && volume > 0) this.lastNonZeroVolume = volume;
      this.emit("change", kind);
    });
    try {
      await this.#server.start();
    } catch {
      // The property inspector and action feedback expose the actionable port-conflict status.
    }
  }

  async close(): Promise<void> {
    this.clearAllOptimistic();
    if (this.#optimisticEmitTimer) clearTimeout(this.#optimisticEmitTimer);
    this.#optimisticEmitTimer = undefined;
    await this.#server?.stop();
  }

  getStatus(): ServiceStatus {
    const status = this.#server?.getStatus() ?? {
      status: "stopped" as const,
      port: this.#settings.port,
      instances: []
    };
    if (this.#pairingCode && this.#pairingCode.expiresAt > Date.now()) {
      return {
        ...status,
        pairingCode: this.#pairingCode.code,
        pairingExpiresAt: this.#pairingCode.expiresAt
      };
    }
    return status;
  }

  issuePairingCode(): ServiceStatus {
    if (!this.#server) return this.getStatus();
    this.#pairingCode = this.#server.pairing.issueCode();
    this.emit("change", "status" satisfies ServiceChangeKind);
    return this.getStatus();
  }

  command(
    command: NebulaCommand,
    applyPreview = true,
    operation?: OptimisticOperation
  ): Promise<void> {
    if (!this.#server) return Promise.reject(new Error("Bridge not initialized"));
    const optimisticOperation = applyPreview ? this.applyOptimistic(command) : operation;
    return this.#server.command(command).catch((error: unknown) => {
      if (optimisticOperation) {
        const current = this.#optimistic?.[optimisticOperation.field];
        if (current?.revision === optimisticOperation.revision) {
          const kind = optimisticOperation.field === "playing" ? "state" : "progress";
          this.clearOptimisticField(optimisticOperation.field);
          this.queueOptimisticChange(kind);
        }
      }
      throw error;
    });
  }

  preview(command: NebulaCommand): OptimisticOperation | undefined {
    return this.applyOptimistic(command);
  }

  supportsActiveCapability(capability: string): boolean {
    return this.#server?.supportsActiveCapability(capability) ?? false;
  }

  async setPort(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1024 || port > 65525) return;
    this.#settings.port = port;
    await this.persist();
    try {
      await this.#server?.restart(port);
    } catch {
      // Status will become port-conflict.
    }
  }

  async pinSession(sessionId?: string): Promise<void> {
    this.#settings.pinnedSessionId = sessionId || undefined;
    this.#server?.setPinnedSession(sessionId);
    await this.persist();
  }

  async unpair(clientId: string): Promise<void> {
    await this.#server?.unpair(clientId);
  }

  private async persist(): Promise<void> {
    const pairedClients = this.#server?.pairing.list() ?? this.#settings.pairedClients;
    const settings = {
      port: this.#settings.port,
      pairedClients,
      ...(this.#settings.pinnedSessionId ? { pinnedSessionId: this.#settings.pinnedSessionId } : {})
    };
    type GlobalSettings = Parameters<typeof streamDeck.settings.setGlobalSettings>[0];
    await streamDeck.settings.setGlobalSettings(settings as unknown as GlobalSettings);
  }

  private applyOptimistic(command: NebulaCommand): OptimisticOperation | undefined {
    const snapshot = this.snapshot;
    if (!snapshot) return undefined;

    let field: OptimisticFieldName;
    let value: boolean | number;
    switch (command.name) {
      case "setPlayback":
        field = "playing";
        value = command.playing;
        break;
      case "togglePlayback":
        field = "playing";
        value = !snapshot.playing;
        break;
      case "setVolume":
        field = "volume";
        value = clamp(command.volume, 0, 1);
        break;
      case "seekRelative":
        field = "positionSeconds";
        value = clamp(
          snapshot.positionSeconds + command.seconds,
          0,
          snapshot.durationSeconds || Number.MAX_SAFE_INTEGER
        );
        break;
      case "seekAbsolute":
        if (snapshot.track?.id !== command.trackId) return undefined;
        field = "positionSeconds";
        value = clamp(command.seconds, 0, snapshot.durationSeconds || Number.MAX_SAFE_INTEGER);
        break;
      default:
        return undefined;
    }

    const current =
      this.#optimistic?.sessionId === snapshot.sessionId &&
      this.#optimistic.trackId === (snapshot.track?.id ?? null)
        ? this.#optimistic
        : undefined;
    this.#optimistic = {
      ...(current ?? {
        sessionId: snapshot.sessionId,
        trackId: snapshot.track?.id ?? null
      }),
      [field]: {
        value,
        revision: ++this.#nextOptimisticRevision,
        expiresAt: Date.now() + 2_000
      }
    };
    const revision = this.#nextOptimisticRevision;
    const previousTimer = this.#optimisticTimers.get(field);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      if (this.#optimistic?.[field]?.revision !== revision) return;
      this.clearOptimisticField(field);
      this.queueOptimisticChange(field === "playing" ? "state" : "progress");
    }, 2_000);
    timer.unref();
    this.#optimisticTimers.set(field, timer);
    this.queueOptimisticChange(field === "playing" ? "state" : "progress");
    return { field, revision };
  }

  private reconcileOptimistic(): void {
    const optimistic = this.#optimistic;
    const snapshot = this.#server?.snapshot;
    if (!optimistic || !snapshot) return;
    if (
      optimistic.sessionId !== snapshot.sessionId ||
      optimistic.trackId !== (snapshot.track?.id ?? null)
    ) {
      this.clearAllOptimistic();
      return;
    }

    if (optimistic.playing?.value === snapshot.playing) {
      this.clearOptimisticField("playing");
    }
    if (
      optimistic.volume !== undefined &&
      Math.abs(optimistic.volume.value - snapshot.volume) < 0.005
    ) {
      this.clearOptimisticField("volume");
    }
    if (
      optimistic.positionSeconds !== undefined &&
      Math.abs(optimistic.positionSeconds.value - snapshot.positionSeconds) < 1.5
    ) {
      this.clearOptimisticField("positionSeconds");
    }
  }

  private clearOptimisticField(field: OptimisticFieldName): void {
    const timer = this.#optimisticTimers.get(field);
    if (timer) clearTimeout(timer);
    this.#optimisticTimers.delete(field);
    if (!this.#optimistic) return;
    delete this.#optimistic[field];
    if (
      this.#optimistic.playing === undefined &&
      this.#optimistic.positionSeconds === undefined &&
      this.#optimistic.volume === undefined
    ) {
      this.#optimistic = undefined;
    }
  }

  private clearAllOptimistic(): void {
    for (const timer of this.#optimisticTimers.values()) clearTimeout(timer);
    this.#optimisticTimers.clear();
    this.#optimistic = undefined;
  }

  private queueOptimisticChange(kind: ServiceChangeKind): void {
    if (kind === "state") {
      this.emit("change", kind);
      return;
    }
    const elapsed = Date.now() - this.#lastOptimisticEmitAt;
    if (elapsed >= 33) {
      this.#lastOptimisticEmitAt = Date.now();
      this.emit("change", kind);
      return;
    }
    if (this.#optimisticEmitTimer) return;
    this.#optimisticEmitTimer = setTimeout(() => {
      this.#optimisticEmitTimer = undefined;
      this.#lastOptimisticEmitAt = Date.now();
      this.emit("change", "progress" satisfies ServiceChangeKind);
    }, 33 - elapsed);
    this.#optimisticEmitTimer.unref();
  }
}
