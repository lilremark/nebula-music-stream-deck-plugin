import type { NebulaSnapshot } from "../protocol/schema.js";

export interface InstanceCandidate {
  sessionId: string;
  authenticated: boolean;
  connectedAt: number;
  hello: {
    visible: boolean;
    lastActiveAt: number;
  };
  snapshot?: NebulaSnapshot;
}

export function selectActiveInstance(
  instances: Iterable<InstanceCandidate>,
  pinnedSessionId?: string
): InstanceCandidate | undefined {
  const connected = [...instances].filter((instance) => instance.authenticated);
  if (pinnedSessionId) {
    const pinned = connected.find((instance) => instance.sessionId === pinnedSessionId);
    if (pinned) return pinned;
  }

  return connected.sort((left, right) => {
    const playing =
      Number(Boolean(right.snapshot?.playing)) - Number(Boolean(left.snapshot?.playing));
    if (playing !== 0) return playing;
    const visible = Number(right.hello.visible) - Number(left.hello.visible);
    if (visible !== 0) return visible;
    const activity = right.hello.lastActiveAt - left.hello.lastActiveAt;
    if (activity !== 0) return activity;
    return right.connectedAt - left.connectedAt;
  })[0];
}
