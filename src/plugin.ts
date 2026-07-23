import streamDeck from "@elgato/streamdeck";
import {
  ConnectionAction,
  NextAction,
  NowPlayingAction,
  PlaylistAction,
  PlaylistBrowserAction,
  PlayPauseAction,
  PreviousAction,
  VolumeAction
} from "./actions.js";
import { NebulaService } from "./service.js";

const service = new NebulaService();

streamDeck.actions.registerAction(new NowPlayingAction(service));
streamDeck.actions.registerAction(new PlayPauseAction(service));
streamDeck.actions.registerAction(new PreviousAction(service));
streamDeck.actions.registerAction(new NextAction(service));
streamDeck.actions.registerAction(new VolumeAction(service));
streamDeck.actions.registerAction(new PlaylistAction(service));
streamDeck.actions.registerAction(new PlaylistBrowserAction(service));
streamDeck.actions.registerAction(new ConnectionAction(service));

streamDeck.ui.onSendToPlugin((event) => {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
  const payload = event.payload as Record<string, unknown>;
  const type = payload.type;
  if (type === "getStatus") {
    void streamDeck.ui.sendToPropertyInspector({
      type: "status",
      ...service.getStatus(),
      playlists: service.snapshot?.playlists ?? []
    });
  } else if (type === "generatePairingCode") {
    void streamDeck.ui.sendToPropertyInspector({
      type: "status",
      ...service.issuePairingCode(),
      playlists: service.snapshot?.playlists ?? []
    });
  } else if (type === "pinInstance") {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    void service.pinSession(sessionId);
  } else if (type === "setPort" && typeof payload.port === "number") {
    void service.setPort(payload.port);
  } else if (type === "unpair" && typeof payload.clientId === "string") {
    void service.unpair(payload.clientId);
  }
});

service.on("change", () => {
  void streamDeck.ui.sendToPropertyInspector({
    type: "status",
    ...service.getStatus(),
    playlists: service.snapshot?.playlists ?? []
  });
});

await streamDeck.connect();
await service.initialize();

process.once("SIGTERM", () => {
  void service.close();
});
