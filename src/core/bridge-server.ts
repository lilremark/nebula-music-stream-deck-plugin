import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL, parseBrowserMessage } from "../protocol/schema.js";
import type {
  BrowserMessage,
  NebulaCommand,
  NebulaSnapshot,
  PluginMessage
} from "../protocol/schema.js";
import { NebulaCommandError } from "./errors.js";
import { createAuthenticationChallenge, type PairingManager } from "./pairing.js";
import { selectActiveInstance, type InstanceCandidate } from "./selection.js";

const PATH = "/nebula/v1";
const COMMAND_TIMEOUT_MS = 5_000;
const MAX_MESSAGE_BYTES = 512 * 1024;
const DEFAULT_AUTH_DEADLINE_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 45_000;
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;
const DEFAULT_MAX_UNAUTHENTICATED = 16;
const DEFAULT_MAX_UNAUTHENTICATED_PER_ORIGIN = 4;

export type BridgeChangeKind = "status" | "state" | "progress";

interface ClientConnection extends InstanceCandidate {
  socket: WebSocket;
  clientId: string;
  origin: string;
  nebulaVersion: string;
  capabilities: ReadonlySet<string>;
  lastProgressAt: number;
  authNonce: string | undefined;
  lastMessageAt: number;
}

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BridgeStatus {
  status: "stopped" | "listening" | "port-conflict";
  port: number;
  activeSessionId?: string;
  pinnedSessionId?: string;
  instances: Array<{
    sessionId: string;
    clientId: string;
    origin: string;
    nebulaVersion: string;
    authenticated: boolean;
    playing: boolean;
    visible: boolean;
  }>;
}

export interface BridgeServerOptions {
  preferredPort?: number;
  fallbackPorts?: number;
  pairing: PairingManager;
  pinnedSessionId?: string;
  persistPairedClients: () => Promise<void>;
  onPortSelected?: (port: number) => Promise<void>;
  now?: () => number;
  authDeadlineMs?: number;
  staleAfterMs?: number;
  sweepIntervalMs?: number;
  maxUnauthenticatedConnections?: number;
  maxUnauthenticatedPerOrigin?: number;
}

export class NebulaBridgeServer extends EventEmitter {
  readonly #connections = new Set<ClientConnection>();
  readonly #pending = new Map<string, PendingCommand>();
  readonly #pairing: PairingManager;
  readonly #fallbackPorts: number;
  readonly #persistPairedClients: () => Promise<void>;
  readonly #onPortSelected: ((port: number) => Promise<void>) | undefined;
  readonly #now: () => number;
  readonly #authDeadlineMs: number;
  readonly #staleAfterMs: number;
  readonly #sweepIntervalMs: number;
  readonly #maxUnauthenticatedConnections: number;
  readonly #maxUnauthenticatedPerOrigin: number;
  readonly #unauthenticatedByOrigin = new Map<string, number>();
  #preferredPort: number;
  #pinnedSessionId: string | undefined;
  #server: Server | undefined;
  #webSocketServer: WebSocketServer | undefined;
  #status: BridgeStatus["status"] = "stopped";
  #listeningPort = 0;
  #unauthenticatedTotal = 0;
  #sweepTimer: NodeJS.Timeout | undefined;

  constructor(options: BridgeServerOptions) {
    super();
    this.#preferredPort = options.preferredPort ?? 37921;
    this.#fallbackPorts = options.fallbackPorts ?? 10;
    this.#pairing = options.pairing;
    this.#pinnedSessionId = options.pinnedSessionId;
    this.#persistPairedClients = options.persistPairedClients;
    this.#onPortSelected = options.onPortSelected;
    this.#now = options.now ?? Date.now;
    this.#authDeadlineMs = options.authDeadlineMs ?? DEFAULT_AUTH_DEADLINE_MS;
    this.#staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.#sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.#maxUnauthenticatedConnections =
      options.maxUnauthenticatedConnections ?? DEFAULT_MAX_UNAUTHENTICATED;
    this.#maxUnauthenticatedPerOrigin =
      options.maxUnauthenticatedPerOrigin ?? DEFAULT_MAX_UNAUTHENTICATED_PER_ORIGIN;
  }

  get pairing(): PairingManager {
    return this.#pairing;
  }

  get snapshot(): NebulaSnapshot | undefined {
    return this.active?.snapshot;
  }

  get active(): ClientConnection | undefined {
    return selectActiveInstance(this.#connections, this.#pinnedSessionId) as
      ClientConnection | undefined;
  }

  supportsActiveCapability(capability: string): boolean {
    return this.active?.capabilities.has(capability) ?? false;
  }

  async start(): Promise<number> {
    if (this.#server) return this.#listeningPort;
    for (let offset = 0; offset < this.#fallbackPorts; offset += 1) {
      const port = this.#preferredPort + offset;
      try {
        await this.listen(port);
        this.#status = "listening";
        this.#listeningPort = port;
        this.startSweeper();
        await this.#onPortSelected?.(port);
        this.notify("status");
        return port;
      } catch (error) {
        if (!isAddressUnavailable(error)) throw error;
      }
    }
    this.#status = "port-conflict";
    this.#listeningPort = this.#preferredPort;
    this.notify("state");
    throw new Error("No available loopback port in the configured range");
  }

  async stop(): Promise<void> {
    for (const client of this.#connections) client.socket.close(1001, "Plugin stopping");
    this.#connections.clear();
    for (const command of this.#pending.values()) {
      clearTimeout(command.timer);
      command.reject(new NebulaCommandError("disconnected", "Bridge stopped"));
    }
    this.#pending.clear();
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.#sweepTimer = undefined;
    this.#webSocketServer?.close();
    if (this.#server) {
      await new Promise<void>((resolve, reject) => {
        this.#server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    this.#server = undefined;
    this.#webSocketServer = undefined;
    this.#unauthenticatedTotal = 0;
    this.#unauthenticatedByOrigin.clear();
    this.#status = "stopped";
    this.notify("state");
  }

  async restart(port: number): Promise<number> {
    await this.stop();
    this.#preferredPort = port;
    return this.start();
  }

  setPinnedSession(sessionId?: string): void {
    this.#pinnedSessionId = sessionId || undefined;
    this.notify("state");
  }

  getStatus(): BridgeStatus {
    const active = this.active;
    return {
      status: this.#status,
      port: this.#listeningPort || this.#preferredPort,
      ...(active ? { activeSessionId: active.sessionId } : {}),
      ...(this.#pinnedSessionId ? { pinnedSessionId: this.#pinnedSessionId } : {}),
      instances: [...this.#connections].map((client) => ({
        sessionId: client.sessionId,
        clientId: client.clientId,
        origin: client.origin,
        nebulaVersion: client.nebulaVersion,
        authenticated: client.authenticated,
        playing: client.snapshot?.playing ?? false,
        visible: client.hello.visible
      }))
    };
  }

  async unpair(clientId: string): Promise<void> {
    if (!this.#pairing.unpair(clientId)) return;
    await this.#persistPairedClients();
    for (const client of this.#connections) {
      if (client.clientId === clientId) client.socket.close(4001, "Unpaired");
    }
    this.notify("state");
  }

  command(command: NebulaCommand): Promise<void> {
    const client = this.active;
    if (!client?.authenticated || client.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new NebulaCommandError("disconnected", "No paired Nebula tab is connected")
      );
    }
    const requestId = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new NebulaCommandError("playback_failed", "Nebula did not acknowledge the command"));
      }, COMMAND_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.send(client.socket, {
        protocol: PROTOCOL,
        type: "command",
        requestId,
        command
      });
    });
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
      });
      const webSocketServer = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_MESSAGE_BYTES,
        perMessageDeflate: false
      });

      server.on("upgrade", (request, socket, head) => {
        const remote = request.socket.remoteAddress;
        if (request.url !== PATH || (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1")) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        webSocketServer.handleUpgrade(request, socket, head, (ws) => {
          webSocketServer.emit("connection", ws, request);
        });
      });
      webSocketServer.on("connection", (socket, request) =>
        this.accept(socket, request.headers.origin)
      );
      server.once("error", (error) => {
        webSocketServer.close();
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        server.removeAllListeners("error");
        server.on("error", () => {
          this.#status = "port-conflict";
          this.notify("status");
        });
        this.#server = server;
        this.#webSocketServer = webSocketServer;
        resolve();
      });
    });
  }

  private accept(socket: WebSocket, headerOrigin: string | undefined): void {
    const upgradeOrigin = normalizeOrigin(headerOrigin);
    if (!upgradeOrigin) {
      socket.close(1008, "Valid Origin required");
      return;
    }
    const originCount = this.#unauthenticatedByOrigin.get(upgradeOrigin) ?? 0;
    if (
      this.#unauthenticatedTotal >= this.#maxUnauthenticatedConnections ||
      originCount >= this.#maxUnauthenticatedPerOrigin
    ) {
      socket.close(1013, "Unauthenticated connection limit reached");
      return;
    }
    this.#unauthenticatedTotal += 1;
    this.#unauthenticatedByOrigin.set(upgradeOrigin, originCount + 1);
    let countedUnauthenticated = true;
    const releaseUnauthenticated = (): void => {
      if (!countedUnauthenticated) return;
      countedUnauthenticated = false;
      this.#unauthenticatedTotal = Math.max(0, this.#unauthenticatedTotal - 1);
      const remaining = Math.max(0, (this.#unauthenticatedByOrigin.get(upgradeOrigin) ?? 1) - 1);
      if (remaining === 0) this.#unauthenticatedByOrigin.delete(upgradeOrigin);
      else this.#unauthenticatedByOrigin.set(upgradeOrigin, remaining);
    };
    const authDeadline = setTimeout(() => {
      if (countedUnauthenticated) socket.close(4001, "Authentication deadline exceeded");
    }, this.#authDeadlineMs);
    authDeadline.unref();
    let client: ClientConnection | undefined;
    let processing = Promise.resolve<ClientConnection | undefined>(undefined);
    socket.on("message", (data, isBinary) => {
      if (isBinary || rawDataLength(data) > MAX_MESSAGE_BYTES) {
        socket.close(1003, "Text protocol required");
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(rawDataToText(data));
      } catch {
        socket.close(1007, "Malformed JSON");
        return;
      }
      const message = parseBrowserMessage(decoded);
      if (!message) {
        const candidate = decoded as { protocol?: unknown };
        if (candidate?.protocol !== PROTOCOL) {
          this.send(socket, {
            protocol: PROTOCOL,
            type: "pairingResult",
            ok: false,
            error: "protocol_mismatch"
          });
        }
        socket.close(1008, "Invalid protocol message");
        return;
      }
      processing = processing
        .then((current) => this.handleMessage(socket, upgradeOrigin, current, message))
        .then((updated) => {
          client = updated;
          if (updated?.authenticated) {
            clearTimeout(authDeadline);
            releaseUnauthenticated();
          }
          return updated;
        })
        .catch(() => {
          socket.close(1011, "Bridge processing failed");
          return client;
        });
    });
    socket.on("close", () => {
      clearTimeout(authDeadline);
      releaseUnauthenticated();
      const activeBefore = this.active?.sessionId;
      if (client) this.#connections.delete(client);
      this.notify(activeBefore !== this.active?.sessionId ? "state" : "status");
    });
    socket.on("error", () => {
      // Connection errors are surfaced as a disconnect status, never logged with private metadata.
    });
  }

  private async handleMessage(
    socket: WebSocket,
    upgradeOrigin: string,
    client: ClientConnection | undefined,
    message: BrowserMessage
  ): Promise<ClientConnection | undefined> {
    if (message.type === "hello") {
      if (message.origin !== upgradeOrigin) {
        socket.close(1008, "Origin mismatch");
        return client;
      }
      if (client) this.#connections.delete(client);
      const next: ClientConnection = {
        socket,
        sessionId: message.sessionId,
        clientId: message.clientId,
        origin: message.origin,
        nebulaVersion: message.nebulaVersion,
        capabilities: new Set(message.capabilities ?? []),
        authenticated: false,
        connectedAt: this.#now(),
        hello: { visible: message.visible, lastActiveAt: message.lastActiveAt },
        lastProgressAt: 0,
        authNonce: undefined,
        lastMessageAt: this.#now()
      };
      this.#connections.add(next);
      this.rotateChallenge(next);
      this.notify("status");
      return next;
    }

    if (!client) {
      socket.close(1008, "Hello required");
      return client;
    }
    if ("clientId" in message && message.clientId !== client.clientId) {
      socket.close(1008, "Client mismatch");
      return client;
    }
    client.lastMessageAt = this.#now();

    if (message.type === "pair") {
      const result = this.#pairing.pair(message.clientId, message.code);
      if (result.token) {
        await this.#persistPairedClients();
        this.send(socket, {
          protocol: PROTOCOL,
          type: "pairingResult",
          ok: true,
          token: result.token
        });
        this.rotateChallenge(client);
      } else {
        this.send(socket, {
          protocol: PROTOCOL,
          type: "pairingResult",
          ok: false,
          error: result.error ?? "invalid_code"
        });
      }
      return client;
    }

    if (message.type === "authenticate") {
      if (client.authenticated) {
        socket.close(1008, "Already authenticated");
        return client;
      }
      const nonce = client.authNonce;
      client.authNonce = undefined;
      client.authenticated =
        nonce !== undefined &&
        this.#pairing.verifyProof(message.clientId, client.sessionId, nonce, message.proof);
      this.send(socket, {
        protocol: PROTOCOL,
        type: "pairingResult",
        ok: client.authenticated,
        ...(client.authenticated ? {} : { error: "unauthorized" })
      });
      if (client.authenticated) {
        this.send(socket, { protocol: PROTOCOL, type: "requestSnapshot" });
      } else {
        this.rotateChallenge(client);
      }
      this.notify("state");
      return client;
    }

    if (!client.authenticated) {
      socket.close(4001, "Authentication required");
      return client;
    }

    if (message.type === "revoke") {
      const revoked = this.#pairing.unpair(message.clientId);
      await this.#persistPairedClients();
      await this.sendConfirmed(socket, {
        protocol: PROTOCOL,
        type: "revocationResult",
        ok: revoked
      });
      socket.close(4001, "Revoked");
    } else if (message.type === "state") {
      if (message.snapshot.sessionId !== client.sessionId) {
        socket.close(1008, "Session mismatch");
        return client;
      }
      const activeBefore = this.active?.sessionId;
      const previousTrack = client.snapshot?.track;
      const incomingTrack = message.snapshot.track;
      const track =
        incomingTrack &&
        previousTrack?.id === incomingTrack.id &&
        !incomingTrack.artworkDataUrl &&
        previousTrack.artworkDataUrl
          ? { ...incomingTrack, artworkDataUrl: previousTrack.artworkDataUrl }
          : incomingTrack;
      client.snapshot = { ...message.snapshot, track };
      client.hello.visible = message.snapshot.visible;
      client.hello.lastActiveAt = message.snapshot.lastActiveAt;
      this.notify(
        activeBefore !== this.active?.sessionId || this.active?.sessionId === client.sessionId
          ? "state"
          : "status"
      );
    } else if (message.type === "progress") {
      if (message.sessionId !== client.sessionId) return client;
      const now = this.#now();
      if (client.snapshot && now - client.lastProgressAt >= 900) {
        const activeBefore = this.active?.sessionId;
        client.snapshot = {
          ...client.snapshot,
          positionSeconds: message.positionSeconds,
          durationSeconds: message.durationSeconds,
          playing: message.playing,
          ...(message.volume !== undefined ? { volume: message.volume } : {}),
          ...(message.muted !== undefined ? { muted: message.muted } : {})
        };
        client.lastProgressAt = now;
        const activeAfter = this.active?.sessionId;
        if (activeBefore !== activeAfter) this.notify("state");
        else if (activeAfter === client.sessionId) this.notify("progress");
      }
    } else if (message.type === "heartbeat") {
      if (message.sessionId !== client.sessionId) return client;
      const activeBefore = this.active?.sessionId;
      client.hello.visible = message.visible;
      client.hello.lastActiveAt = message.lastActiveAt;
      this.notify(activeBefore !== this.active?.sessionId ? "state" : "status");
    } else if (message.type === "commandResult") {
      const pending = this.#pending.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(message.requestId);
        if (message.ok) pending.resolve();
        else {
          pending.reject(
            new NebulaCommandError(
              message.error?.code ?? "playback_failed",
              message.error?.message ?? "Command failed"
            )
          );
        }
      }
    }
    return client;
  }

  private send(socket: WebSocket, message: PluginMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private sendConfirmed(socket: WebSocket, message: PluginMessage): Promise<void> {
    return new Promise((resolve) => {
      if (socket.readyState !== WebSocket.OPEN) {
        resolve();
        return;
      }
      socket.send(JSON.stringify(message), () => resolve());
    });
  }

  private rotateChallenge(client: ClientConnection): void {
    client.authNonce = createAuthenticationChallenge();
    this.send(client.socket, {
      protocol: PROTOCOL,
      type: "authChallenge",
      nonce: client.authNonce
    });
  }

  private notify(kind: BridgeChangeKind): void {
    this.emit("change", kind, this.getStatus());
  }

  private startSweeper(): void {
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.#sweepTimer = setInterval(() => {
      const cutoff = this.#now() - this.#staleAfterMs;
      for (const client of this.#connections) {
        if (client.authenticated && client.lastMessageAt < cutoff) {
          client.socket.terminate();
        }
      }
    }, this.#sweepIntervalMs);
    this.#sweepTimer.unref();
  }
}

function isAddressUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EADDRINUSE" || error.code === "EACCES")
  );
}

function rawDataLength(data: WebSocket.RawData): number {
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

function rawDataToText(data: WebSocket.RawData): string {
  const parts = Array.isArray(data)
    ? data
    : [Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data))];
  return Buffer.concat(parts).toString("utf8");
}

function normalizeOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}
