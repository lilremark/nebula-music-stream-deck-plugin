import { EventEmitter } from "node:events";
import streamDeck from "@elgato/streamdeck";
import { z } from "zod";
import { NebulaBridgeServer, type BridgeStatus } from "./core/bridge-server.js";
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

export class NebulaService extends EventEmitter {
  #server?: NebulaBridgeServer;
  #settings = globalSettingsSchema.parse({});
  #pairingCode: { code: string; expiresAt: number } | undefined;
  lastNonZeroVolume = 1;

  get snapshot(): NebulaSnapshot | undefined {
    return this.#server?.snapshot;
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
    this.#server.on("change", () => {
      const volume = this.snapshot?.volume;
      if (volume !== undefined && volume > 0) this.lastNonZeroVolume = volume;
      this.emit("change");
    });
    try {
      await this.#server.start();
    } catch {
      // The property inspector and action feedback expose the actionable port-conflict status.
    }
  }

  async close(): Promise<void> {
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
    this.emit("change");
    return this.getStatus();
  }

  command(command: NebulaCommand): Promise<void> {
    if (!this.#server) return Promise.reject(new Error("Bridge not initialized"));
    return this.#server.command(command);
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
}
