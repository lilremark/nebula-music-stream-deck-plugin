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
let propertyInspectorVisible = false;
let lastPropertyInspectorPayload = "";

function sendPropertyInspectorStatus(force = false): void {
  if (!propertyInspectorVisible) return;
  const payload = {
    type: "status",
    ...service.getStatus(),
    playlists: service.snapshot?.playlists ?? []
  };
  const serialized = JSON.stringify(payload);
  if (!force && serialized === lastPropertyInspectorPayload) return;
  lastPropertyInspectorPayload = serialized;
  void streamDeck.ui.sendToPropertyInspector(payload);
}

streamDeck.actions.registerAction(new NowPlayingAction(service));
streamDeck.actions.registerAction(new PlayPauseAction(service));
streamDeck.actions.registerAction(new PreviousAction(service));
streamDeck.actions.registerAction(new NextAction(service));
streamDeck.actions.registerAction(new VolumeAction(service));
streamDeck.actions.registerAction(new PlaylistAction(service));
streamDeck.actions.registerAction(new PlaylistBrowserAction(service));
streamDeck.actions.registerAction(new ConnectionAction(service));

streamDeck.ui.onDidAppear(() => {
  propertyInspectorVisible = true;
  lastPropertyInspectorPayload = "";
  sendPropertyInspectorStatus(true);
});

streamDeck.ui.onDidDisappear(() => {
  propertyInspectorVisible = false;
  lastPropertyInspectorPayload = "";
});

streamDeck.ui.onSendToPlugin((event) => {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
  const payload = event.payload as Record<string, unknown>;
  const type = payload.type;
  if (type === "getStatus") {
    sendPropertyInspectorStatus(true);
  } else if (type === "generatePairingCode") {
    service.issuePairingCode();
    sendPropertyInspectorStatus(true);
  } else if (type === "pinInstance") {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    void service.pinSession(sessionId);
  } else if (type === "setPort" && typeof payload.port === "number") {
    void service.setPort(payload.port);
  } else if (type === "unpair" && typeof payload.clientId === "string") {
    void service.unpair(payload.clientId);
  }
});

service.on("change", () => sendPropertyInspectorStatus());

await streamDeck.connect();
await service.initialize();

process.once("SIGTERM", () => {
  void service.close();
});
