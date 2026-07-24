import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";

const bundle = await build({
  entryPoints: ["src/render/svg.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false
});
const source = bundle.outputFiles[0].text;
const render = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const snapshot = {
  sessionId: "preview",
  clientId: "preview",
  origin: "https://music.example.test",
  nebulaVersion: "1",
  visible: true,
  lastActiveAt: 1,
  connectedAt: 1,
  playing: true,
  positionSeconds: 94,
  durationSeconds: 248,
  volume: 0.74,
  muted: false,
  track: {
    id: "track",
    title: "Midnight Drive",
    artist: "The Satellites"
  },
  playlists: []
};

const tiles = [
  ["Now Playing — idle", render.nowPlayingSvg()],
  ["Now Playing — active", render.nowPlayingSvg(snapshot)],
  ["Volume — active", render.volumeSvg(snapshot)],
  ["Volume — idle", render.volumeSvg()],
  ["Fixed Playlist", render.playlistSvg("Night Rotation")],
  ["Connection only", render.statusSvg("Nebula Link", "Code 384219", "link")]
];
const tileSize = 288;
const tileWidth = 312;
const tileHeight = 340;
const canvasWidth = tileWidth * 3;
const canvasHeight = tileHeight * 2;
const composites = [];

for (const [index, [label, svg]] of tiles.entries()) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  const left = column * tileWidth + 12;
  const top = row * tileHeight + 12;
  const image = await sharp(Buffer.from(svg)).resize(tileSize, tileSize).png().toBuffer();
  composites.push({ input: image, left, top });
  composites.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="28"><text x="144" y="20" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#d4d4d4">${label}</text></svg>`
    ),
    left,
    top: top + tileSize + 5
  });
}

await mkdir("dist", { recursive: true });
await sharp({
  create: {
    width: canvasWidth,
    height: canvasHeight,
    channels: 4,
    background: "#232323"
  }
})
  .composite(composites)
  .png()
  .toFile("dist/ui-preview.png");

console.log("Rendered dist/ui-preview.png");
