import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";

async function importBundle(entryPoint) {
  const bundle = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false
  });
  const source = bundle.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const [render, marquee] = await Promise.all([
  importBundle("src/render/svg.ts"),
  importBundle("src/core/marquee.ts")
]);

const previewArtwork = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#f5f5f5"/>
    <path d="M0 292 102 173l83 68 78-142 137 82v219H0z" fill="#111"/>
    <circle cx="250" cy="107" r="88" fill="#3b82c4"/>
    <circle cx="117" cy="157" r="62" fill="#2f75ad"/>
    <path d="M66 333h268" stroke="#f5f5f5" stroke-width="8"/>
    <text x="200" y="366" text-anchor="middle" font-family="Arial,sans-serif" font-size="35" font-weight="800" fill="#f5f5f5">THE LAST OF</text>
  </svg>`
).toString("base64")}`;

const snapshot = {
  sessionId: "preview",
  clientId: "preview",
  origin: "https://music.example.test",
  nebulaVersion: "1",
  visible: true,
  lastActiveAt: 1,
  connectedAt: 1,
  playing: true,
  positionSeconds: 204,
  durationSeconds: 347,
  volume: 0.74,
  muted: false,
  track: {
    id: "track",
    title: "What The People Say — Remastered Version",
    artist: "Tha Dogg Pound featuring a very long guest name",
    album: "The Last Of Tha Pound (Deluxe Edition)",
    artworkDataUrl: previewArtwork
  },
  playlists: []
};

const tiles = [
  ["Now Playing — marquee start", render.nowPlayingSvg(snapshot, 0)],
  ["Now Playing — marquee later", render.nowPlayingSvg(snapshot, 12)],
  ["Volume — active", render.volumeSvg(snapshot)],
  ["Now Playing — idle", render.nowPlayingSvg()],
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

const artwork = await sharp(Buffer.from(previewArtwork.split(",")[1], "base64"))
  .resize(100, 100)
  .png()
  .toBuffer();
const dialTitle = escapeXml(marquee.marqueeText(snapshot.track.title, 13, 7));
const dialArtist = escapeXml(marquee.marqueeText(snapshot.track.artist, 17, 7));
const dialAlbum = escapeXml(marquee.marqueeText(snapshot.track.album, 17, 7));
const dialMetadata = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#0a0a0a"/>
    <text x="8" y="21" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#fafafa">${dialTitle}</text>
    <text x="8" y="42" font-family="Arial,sans-serif" font-size="10" fill="#d4d4d4">${dialArtist}</text>
    <text x="8" y="59" font-family="Arial,sans-serif" font-size="9" fill="#a3a3a3">${dialAlbum}</text>
    <text x="8" y="78" font-family="Arial,sans-serif" font-size="9" fill="#a3a3a3">3:24 / 5:47</text>
    <rect x="8" y="87" width="84" height="4" rx="2" fill="#262626"/>
    <rect x="8" y="87" width="49" height="4" rx="2" fill="#3b82c4"/>
  </svg>`
);
const nowPlayingDial = await sharp({
  create: { width: 200, height: 100, channels: 4, background: "#0a0a0a" }
})
  .composite([
    { input: artwork, left: 0, top: 0 },
    { input: dialMetadata, left: 100, top: 0 }
  ])
  .png()
  .toBuffer();

const volumeDial = await renderSimpleDial({
  icon: render.dialIconSvg("volume"),
  label: "VOLUME",
  value: "74%",
  detail: "Rotate • press to mute",
  progress: 0.74
});
const playlistDial = await renderSimpleDial({
  icon: render.dialIconSvg("playlist"),
  label: "PLAYLIST",
  value: "Night Rotation",
  detail: "3 / 12",
  progress: 0
});

await sharp({
  create: { width: 624, height: 100, channels: 4, background: "#232323" }
})
  .composite([
    { input: nowPlayingDial, left: 0, top: 0 },
    { input: volumeDial, left: 212, top: 0 },
    { input: playlistDial, left: 424, top: 0 }
  ])
  .png()
  .toFile("dist/dial-preview.png");

console.log("Rendered dist/ui-preview.png and dist/dial-preview.png");

async function renderSimpleDial({ icon, label, value, detail, progress }) {
  const iconBuffer = Buffer.from(icon.split(",")[1], "base64");
  const progressWidth = Math.round(128 * progress);
  const text = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect width="200" height="100" fill="#0a0a0a"/>
      <text x="64" y="24" font-family="Arial,sans-serif" font-size="10" font-weight="700" letter-spacing="1" fill="#a3a3a3">${escapeXml(label)}</text>
      <text x="64" y="54" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fafafa">${escapeXml(value)}</text>
      <text x="64" y="74" font-family="Arial,sans-serif" font-size="9" fill="#737373">${escapeXml(detail)}</text>
      <rect x="64" y="86" width="128" height="4" rx="2" fill="#262626"/>
      <rect x="64" y="86" width="${progressWidth}" height="4" rx="2" fill="#3b82c4"/>
    </svg>`
  );
  return sharp(text)
    .composite([{ input: iconBuffer, left: 8, top: 26 }])
    .png()
    .toBuffer();
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
