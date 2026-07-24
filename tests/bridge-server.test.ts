import { once } from "node:events";
import { createServer } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { NebulaBridgeServer } from "../src/core/bridge-server.js";
import { createAuthenticationProof, PairingManager } from "../src/core/pairing.js";
import { PROTOCOL, type PluginMessage } from "../src/protocol/schema.js";

const servers: NebulaBridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.stop()));
});

describe("NebulaBridgeServer", () => {
  it("pairs, authenticates, receives state and routes commands", async () => {
    const pairing = new PairingManager();
    const { code } = pairing.issueCode();
    let persisted = 0;
    const server = new NebulaBridgeServer({
      preferredPort: await getAvailablePort(),
      fallbackPorts: 20,
      pairing,
      persistPairedClients: () => {
        persisted += 1;
        return Promise.resolve();
      }
    });
    servers.push(server);
    const port = await server.start();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, {
      origin: "https://music.example.test"
    });
    const messages = messageQueue(socket);
    await once(socket, "open");
    send(socket, {
      protocol: PROTOCOL,
      type: "hello",
      sessionId: "session",
      clientId: "client",
      origin: "https://music.example.test",
      nebulaVersion: "0.9.0",
      visible: true,
      lastActiveAt: 100,
      capabilities: ["seekAbsolute", "progressVolume"]
    });
    const initialChallenge = await messages.next();
    expect(initialChallenge).toMatchObject({ type: "authChallenge" });
    send(socket, { protocol: PROTOCOL, type: "pair", clientId: "client", code });
    const paired = await messages.next();
    expect(paired).toMatchObject({ type: "pairingResult", ok: true });
    expect(persisted).toBe(1);
    const challenge = await messages.next();
    expect(challenge).toMatchObject({ type: "authChallenge" });
    if (paired.type !== "pairingResult" || !paired.token) throw new Error("Expected token");
    if (challenge.type !== "authChallenge") throw new Error("Expected challenge");

    send(socket, {
      protocol: PROTOCOL,
      type: "authenticate",
      clientId: "client",
      proof: createAuthenticationProof(paired.token, "client", "session", challenge.nonce)
    });
    expect(await messages.next()).toMatchObject({ type: "pairingResult", ok: true });
    expect(await messages.next()).toMatchObject({ type: "requestSnapshot" });
    expect(server.supportsActiveCapability("seekAbsolute")).toBe(true);
    expect(server.supportsActiveCapability("futureCapability")).toBe(false);

    send(socket, {
      protocol: PROTOCOL,
      type: "state",
      snapshot: {
        sessionId: "session",
        clientId: "client",
        origin: "https://music.example.test",
        nebulaVersion: "0.9.0",
        visible: true,
        lastActiveAt: 100,
        connectedAt: 50,
        playing: true,
        positionSeconds: 10,
        durationSeconds: 120,
        volume: 0.8,
        muted: false,
        track: {
          id: "track",
          title: "Song",
          artist: "Artist",
          artworkDataUrl: "data:image/png;base64,AA=="
        },
        playlists: [{ id: "playlist", name: "Favorites", trackCount: 4 }]
      }
    });
    await waitFor(() => server.snapshot?.track?.id === "track");
    expect(server.getStatus().activeSessionId).toBe("session");
    send(socket, {
      protocol: PROTOCOL,
      type: "state",
      snapshot: {
        ...server.snapshot,
        track: { id: "track", title: "Song (updated)", artist: "Artist" }
      }
    });
    await waitFor(() => server.snapshot?.track?.title === "Song (updated)");
    expect(server.snapshot?.track?.artworkDataUrl).toBe("data:image/png;base64,AA==");

    const result = server.command({ name: "next" });
    const command = await messages.next();
    expect(command).toMatchObject({ type: "command", command: { name: "next" } });
    if (command.type !== "command") throw new Error("Expected command");
    send(socket, {
      protocol: PROTOCOL,
      type: "commandResult",
      requestId: command.requestId,
      ok: true
    });
    await expect(result).resolves.toBeUndefined();

    send(socket, {
      protocol: PROTOCOL,
      type: "progress",
      sessionId: "session",
      positionSeconds: 11,
      durationSeconds: 120,
      playing: true,
      volume: 0.4,
      muted: false
    });
    await waitFor(() => server.snapshot?.positionSeconds === 11);
    expect(server.snapshot?.volume).toBe(0.4);
    send(socket, {
      protocol: PROTOCOL,
      type: "heartbeat",
      sessionId: "session",
      visible: false,
      lastActiveAt: 200
    });

    const failed = server.command({ name: "startPlaylist", playlistId: "missing" });
    const failedCommand = await messages.next();
    if (failedCommand.type !== "command") throw new Error("Expected command");
    send(socket, {
      protocol: PROTOCOL,
      type: "commandResult",
      requestId: failedCommand.requestId,
      ok: false,
      error: { code: "stale_playlist", message: "Playlist no longer exists" }
    });
    await expect(failed).rejects.toMatchObject({ code: "stale_playlist" });

    server.setPinnedSession("session");
    send(socket, { protocol: PROTOCOL, type: "revoke", clientId: "client" });
    expect(await messages.next()).toMatchObject({ type: "revocationResult", ok: true });
    expect(persisted).toBe(2);
    await once(socket, "close");
    await server.unpair("unknown");
    await expect(server.command({ name: "next" })).rejects.toMatchObject({
      code: "disconnected"
    });
  });

  it("rejects invalid authentication and unauthenticated state", async () => {
    const pairing = new PairingManager();
    const server = new NebulaBridgeServer({
      preferredPort: await getAvailablePort(),
      pairing,
      persistPairedClients: () => Promise.resolve()
    });
    servers.push(server);
    const socket = new WebSocket(`ws://127.0.0.1:${await server.start()}/nebula/v1`, {
      origin: "https://example.test"
    });
    const messages = messageQueue(socket);
    await once(socket, "open");
    send(socket, {
      protocol: PROTOCOL,
      type: "hello",
      sessionId: "session",
      clientId: "client",
      origin: "https://example.test",
      nebulaVersion: "1",
      visible: false,
      lastActiveAt: 1
    });
    const challenge = await messages.next();
    expect(challenge).toMatchObject({ type: "authChallenge" });
    send(socket, {
      protocol: PROTOCOL,
      type: "authenticate",
      clientId: "client",
      proof: "A".repeat(43)
    });
    expect(await messages.next()).toMatchObject({
      type: "pairingResult",
      ok: false,
      error: "unauthorized"
    });
    const rotated = await messages.next();
    expect(rotated).toMatchObject({ type: "authChallenge" });
    if (challenge.type === "authChallenge" && rotated.type === "authChallenge") {
      expect(rotated.nonce).not.toBe(challenge.nonce);
    }
    send(socket, {
      protocol: PROTOCOL,
      type: "heartbeat",
      sessionId: "session",
      visible: true,
      lastActiveAt: 2
    });
    await once(socket, "close");
    await waitFor(() => server.getStatus().instances.length === 0);
    expect(server.getStatus().instances).toHaveLength(0);
  });

  it("rejects malformed and incompatible messages", async () => {
    const server = new NebulaBridgeServer({
      preferredPort: await getAvailablePort(),
      pairing: new PairingManager(),
      persistPairedClients: () => Promise.resolve()
    });
    servers.push(server);
    const port = await server.start();
    expect(await server.start()).toBe(port);

    const malformed = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, {
      origin: "https://example.test"
    });
    await once(malformed, "open");
    malformed.send("{");
    await once(malformed, "close");

    const incompatible = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, {
      origin: "https://example.test"
    });
    const messages = messageQueue(incompatible);
    await once(incompatible, "open");
    incompatible.send(JSON.stringify({ protocol: "old", type: "hello" }));
    expect(await messages.next()).toMatchObject({ error: "protocol_mismatch" });
    await once(incompatible, "close");
  });

  it("binds hello identity to Upgrade Origin and limits idle unauthenticated clients", async () => {
    const server = new NebulaBridgeServer({
      preferredPort: await getAvailablePort(),
      pairing: new PairingManager(),
      persistPairedClients: () => Promise.resolve(),
      authDeadlineMs: 40,
      maxUnauthenticatedConnections: 2,
      maxUnauthenticatedPerOrigin: 1
    });
    servers.push(server);
    const port = await server.start();
    const missingOrigin = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`);
    const missingOriginClose = once(missingOrigin, "close");
    await once(missingOrigin, "open");
    await missingOriginClose;

    const first = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, {
      origin: "https://one.example.test"
    });
    await once(first, "open");

    const limited = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, {
      origin: "https://one.example.test"
    });
    const limitedClose = once(limited, "close");
    await once(limited, "open");
    await limitedClose;

    const mismatch = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, {
      origin: "https://two.example.test"
    });
    const mismatchClose = once(mismatch, "close");
    await once(mismatch, "open");
    send(mismatch, {
      protocol: PROTOCOL,
      type: "hello",
      sessionId: "mismatch",
      clientId: "mismatch",
      origin: "https://different.example.test",
      nebulaVersion: "1",
      visible: true,
      lastActiveAt: 1
    });
    await mismatchClose;
    await once(first, "close");
  });

  it("evicts stale authenticated tabs and fails over to a live instance", async () => {
    const firstToken = Buffer.alloc(32, 1).toString("base64url");
    const secondToken = Buffer.alloc(32, 2).toString("base64url");
    const server = new NebulaBridgeServer({
      preferredPort: await getAvailablePort(),
      pairing: new PairingManager([
        { clientId: "first", token: firstToken, pairedAt: 1 },
        { clientId: "second", token: secondToken, pairedAt: 1 }
      ]),
      persistPairedClients: () => Promise.resolve(),
      staleAfterMs: 35,
      sweepIntervalMs: 5
    });
    servers.push(server);
    const port = await server.start();
    const first = await connectAuthenticated(
      port,
      "https://first.example.test",
      "first",
      "first-session",
      firstToken
    );
    sendState(first.socket, "first", "first-session", "https://first.example.test", true);
    const second = await connectAuthenticated(
      port,
      "https://second.example.test",
      "second",
      "second-session",
      secondToken
    );
    sendState(second.socket, "second", "second-session", "https://second.example.test", false);
    await waitFor(() => server.getStatus().activeSessionId === "first-session");

    const firstClosed = once(first.socket, "close");
    const keepSecondAlive = setInterval(() => {
      send(second.socket, {
        protocol: PROTOCOL,
        type: "heartbeat",
        sessionId: "second-session",
        visible: true,
        lastActiveAt: Date.now()
      });
    }, 10);
    try {
      await firstClosed;
      await waitFor(() => server.getStatus().activeSessionId === "second-session");
    } finally {
      clearInterval(keepSecondAlive);
    }
    second.socket.close();
  });

  it("falls back from occupied ports and reports exhausted ranges", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    const fallback = new NebulaBridgeServer({
      preferredPort: address.port,
      fallbackPorts: 2,
      pairing: new PairingManager(),
      persistPairedClients: () => Promise.resolve()
    });
    servers.push(fallback);
    expect(await fallback.start()).toBe(address.port + 1);
    await fallback.restart(address.port + 1);

    const exhausted = new NebulaBridgeServer({
      preferredPort: address.port,
      fallbackPorts: 1,
      pairing: new PairingManager(),
      persistPairedClients: () => Promise.resolve()
    });
    servers.push(exhausted);
    await expect(exhausted.start()).rejects.toThrow("No available loopback port");
    expect(exhausted.getStatus().status).toBe("port-conflict");
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve()))
    );
  });
});

function send(socket: WebSocket, value: unknown): void {
  socket.send(JSON.stringify(value));
}

async function getAvailablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function connectAuthenticated(
  port: number,
  origin: string,
  clientId: string,
  sessionId: string,
  token: string
): Promise<{ socket: WebSocket; messages: ReturnType<typeof messageQueue> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/nebula/v1`, { origin });
  const messages = messageQueue(socket);
  await once(socket, "open");
  send(socket, {
    protocol: PROTOCOL,
    type: "hello",
    sessionId,
    clientId,
    origin,
    nebulaVersion: "1",
    visible: true,
    lastActiveAt: Date.now()
  });
  const challenge = await messages.next();
  if (challenge.type !== "authChallenge") throw new Error("Expected auth challenge");
  send(socket, {
    protocol: PROTOCOL,
    type: "authenticate",
    clientId,
    proof: createAuthenticationProof(token, clientId, sessionId, challenge.nonce)
  });
  expect(await messages.next()).toMatchObject({ type: "pairingResult", ok: true });
  expect(await messages.next()).toMatchObject({ type: "requestSnapshot" });
  return { socket, messages };
}

function sendState(
  socket: WebSocket,
  clientId: string,
  sessionId: string,
  origin: string,
  playing: boolean
): void {
  send(socket, {
    protocol: PROTOCOL,
    type: "state",
    snapshot: {
      sessionId,
      clientId,
      origin,
      nebulaVersion: "1",
      visible: true,
      lastActiveAt: Date.now(),
      connectedAt: Date.now(),
      playing,
      positionSeconds: 0,
      durationSeconds: 120,
      volume: 1,
      muted: false,
      track: { id: sessionId, title: sessionId, artist: "Artist" },
      playlists: []
    }
  });
}

function messageQueue(socket: WebSocket): { next: () => Promise<PluginMessage> } {
  const queued: PluginMessage[] = [];
  const waiting: Array<(message: PluginMessage) => void> = [];
  socket.on("message", (data) => {
    const parts = Array.isArray(data)
      ? data
      : [Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data))];
    const message = JSON.parse(Buffer.concat(parts).toString("utf8")) as PluginMessage;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  return {
    next: () => {
      const message = queued.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve) => waiting.push(resolve));
    }
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met");
}
