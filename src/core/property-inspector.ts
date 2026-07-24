export const CONNECTION_ACTION = "com.lilremark.nebula-music.connection";
export const PLAYLIST_ACTION = "com.lilremark.nebula-music.playlist";

export type PropertyInspectorScope = "connection" | "playlists";

export function propertyInspectorScope(
  actionUUID: string | undefined
): PropertyInspectorScope | undefined {
  if (actionUUID === CONNECTION_ACTION) return "connection";
  if (actionUUID === PLAYLIST_ACTION) return "playlists";
  return undefined;
}

export function acceptsConnectionCommand(actionUUID: string | undefined): boolean {
  return propertyInspectorScope(actionUUID) === "connection";
}
