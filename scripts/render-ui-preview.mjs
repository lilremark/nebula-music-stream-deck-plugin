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

const dialTitle = escapeXml(
  marquee.marqueeText(snapshot.track.title, marquee.DIAL_MARQUEE_LIMITS.title, 7)
);
const dialArtist = escapeXml(
  marquee.marqueeText(snapshot.track.artist, marquee.DIAL_MARQUEE_LIMITS.artist, 7)
);
const dialAlbum = escapeXml(
  marquee.marqueeText(snapshot.track.album, marquee.DIAL_MARQUEE_LIMITS.album, 7)
);
const nowPlayingDial = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
    <rect width="100" height="100" fill="#0a0a0a"/>
    <rect x="100" width="100" height="100" fill="#0a0a0a"/>
    <text x="8" y="17" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#737373">NOW PLAYING</text>
    <text x="192" y="17" text-anchor="end" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#3b82c4">PLAYING</text>
    <text x="8" y="43" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#fafafa">${dialTitle}</text>
    <text x="8" y="61" font-family="Arial,sans-serif" font-size="10" font-weight="600" fill="#d4d4d4">${dialArtist}</text>
    <text x="8" y="76" font-family="Arial,sans-serif" font-size="9" fill="#737373">${dialAlbum}</text>
    <text x="8" y="92" font-family="Arial,sans-serif" font-size="8" font-weight="600" fill="#a3a3a3">3:24 / 5:47</text>
    <rect x="80" y="87" width="112" height="4" rx="2" fill="#262626"/>
    <rect x="80" y="87" width="66" height="4" rx="2" fill="#3b82c4"/>
  </svg>`
);
const volumeDial = dialSvg({
  label: "VOLUME",
  status: "ACTIVE",
  sublabel: "",
  leftValue: "74%",
  hint: "ROTATE · PRESS TO MUTE",
  progress: 0.74
});
const playlistDial = dialSvg({
  label: "PLAYLIST",
  status: "3 / 12",
  sublabel: "SELECTED",
  leftValue: "Night Rotation",
  hint: "ROTATE · PRESS TO PLAY"
});
const tuningDial = dualValueDial();

await sharp({
  create: { width: 836, height: 100, channels: 4, background: "#232323" }
})
  .composite([
    { input: nowPlayingDial, left: 0, top: 0 },
    { input: volumeDial, left: 212, top: 0 },
    { input: playlistDial, left: 424, top: 0 },
    { input: tuningDial, left: 636, top: 0 }
  ])
  .png()
  .toFile("dist/dial-preview.png");

console.log("Rendered dist/ui-preview.png and dist/dial-preview.png");

function dialSvg({ label, status, sublabel, leftValue, hint, progress = 0 }) {
  const progressWidth = Math.round(184 * progress);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect width="200" height="100" fill="#0a0a0a"/>
      <text x="8" y="17" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#737373">${escapeXml(label)}</text>
      <text x="192" y="17" text-anchor="end" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#3b82c4">${escapeXml(status)}</text>
      ${sublabel ? `<text x="8" y="41" font-family="Arial,sans-serif" font-size="9" font-weight="600" fill="#a3a3a3">${escapeXml(sublabel)}</text>` : ""}
      <text x="8" y="${sublabel ? 68 : 61}" font-family="Arial,sans-serif" font-size="${sublabel ? 19 : 30}" font-weight="700" fill="#fafafa">${escapeXml(leftValue)}</text>
      <text x="100" y="80" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#737373">${escapeXml(hint)}</text>
      ${progress ? `<rect x="8" y="87" width="184" height="4" rx="2" fill="#262626"/><rect x="8" y="87" width="${progressWidth}" height="4" rx="2" fill="#3b82c4"/>` : ""}
    </svg>`
  );
}

function dualValueDial() {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect width="200" height="100" fill="#0a0a0a"/>
      <text x="8" y="17" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#737373">SPEED &amp; PITCH</text>
      <text x="192" y="17" text-anchor="end" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#3b82c4">DIGITAL</text>
      <text x="8" y="41" font-family="Arial,sans-serif" font-size="9" font-weight="600" fill="#a3a3a3">SPEED</text>
      <text x="192" y="41" text-anchor="end" font-family="Arial,sans-serif" font-size="9" font-weight="600" fill="#a3a3a3">PITCH</text>
      <text x="8" y="68" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#fafafa">1.2×</text>
      <text x="192" y="68" text-anchor="end" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#fafafa">+2 st</text>
      <text x="100" y="91" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#737373">KNOB · BOTH</text>
    </svg>`
  );
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
