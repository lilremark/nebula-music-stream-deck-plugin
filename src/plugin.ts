import streamDeck from "@elgato/streamdeck";
import {
  ConnectionAction,
  NextAction,
  NowPlayingAction,
  PlaylistAction,
  PlaylistBrowserAction,
  PlayPauseAction,
  PreviousAction,
  SpeedPitchAction,
  VolumeAction
} from "./actions.js";
import { acceptsConnectionCommand, propertyInspectorScope } from "./core/property-inspector.js";
import { NebulaService } from "./service.js";

const service = new NebulaService();
let propertyInspectorVisible = false;
let propertyInspectorAction: string | undefined;
let lastPropertyInspectorPayload = "";

function sendPropertyInspectorData(force = false): void {
  if (!propertyInspectorVisible) return;
  const scope = propertyInspectorScope(propertyInspectorAction);
  const payload =
    scope === "connection"
      ? { type: "connection", ...service.getStatus() }
      : scope === "playlists"
        ? { type: "playlists", playlists: service.snapshot?.playlists ?? [] }
        : undefined;
  if (!payload) return;
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
streamDeck.actions.registerAction(new SpeedPitchAction(service));
streamDeck.actions.registerAction(new PlaylistAction(service));
streamDeck.actions.registerAction(new PlaylistBrowserAction(service));
streamDeck.actions.registerAction(new ConnectionAction(service));

streamDeck.ui.onDidAppear((event) => {
  propertyInspectorVisible = true;
  propertyInspectorAction = event.action.manifestId;
  lastPropertyInspectorPayload = "";
  sendPropertyInspectorData(true);
});

streamDeck.ui.onDidDisappear(() => {
  propertyInspectorVisible = false;
  propertyInspectorAction = undefined;
  lastPropertyInspectorPayload = "";
});

streamDeck.ui.onSendToPlugin((event) => {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
  const payload = event.payload as Record<string, unknown>;
  const type = payload.type;
  if (type === "getStatus") {
    sendPropertyInspectorData(true);
  } else if (acceptsConnectionCommand(propertyInspectorAction) && type === "generatePairingCode") {
    service.issuePairingCode();
    sendPropertyInspectorData(true);
  } else if (acceptsConnectionCommand(propertyInspectorAction) && type === "pinInstance") {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    void service.pinSession(sessionId);
  } else if (
    acceptsConnectionCommand(propertyInspectorAction) &&
    type === "setPort" &&
    typeof payload.port === "number"
  ) {
    void service.setPort(payload.port);
  } else if (
    acceptsConnectionCommand(propertyInspectorAction) &&
    type === "unpair" &&
    typeof payload.clientId === "string"
  ) {
    void service.unpair(payload.clientId);
  }
});

service.on("change", () => sendPropertyInspectorData());

await streamDeck.connect();
await service.initialize();

process.once("SIGTERM", () => {
  void service.close();
});
