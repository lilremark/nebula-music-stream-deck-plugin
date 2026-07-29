import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ManifestAction {
  UUID: string;
  DisableAutomaticStates?: boolean;
  States: Array<{ Image: string; ShowTitle?: boolean }>;
}

describe("Stream Deck manifest", () => {
  it("defines dedicated automatic-state-disabled images for the Volume key", async () => {
    const manifest = JSON.parse(
      await readFile("com.lilremark.nebula-music.sdPlugin/manifest.json", "utf8")
    ) as { Actions: ManifestAction[] };
    const volume = manifest.Actions.find(
      (action) => action.UUID === "com.lilremark.nebula-music.volume"
    );

    expect(volume?.DisableAutomaticStates).toBe(true);
    expect(volume?.States.map((state) => state.Image)).toEqual([
      "imgs/key-volume",
      "imgs/key-volume-muted"
    ]);
  });

  it("keeps Now Playing metadata in a separate layer from its artwork", async () => {
    const manifest = JSON.parse(
      await readFile("com.lilremark.nebula-music.sdPlugin/manifest.json", "utf8")
    ) as { Actions: ManifestAction[] };
    const nowPlaying = manifest.Actions.find(
      (action) => action.UUID === "com.lilremark.nebula-music.now-playing"
    );

    expect(nowPlaying?.States).toHaveLength(1);
    expect(nowPlaying?.States[0]?.ShowTitle).toBe(true);
  });
});
