import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

export async function generateIcons() {
  const svg = await readFile("assets/plugin.svg");
  const output = "com.lilremark.nebula-music.sdPlugin/imgs";
  await mkdir(output, { recursive: true });
  await Promise.all([
    sharp(svg).resize(256, 256).png().toFile(`${output}/plugin.png`),
    sharp(svg).resize(512, 512).png().toFile(`${output}/plugin@2x.png`)
  ]);
}

if (process.argv[1]?.endsWith("generate-icons.mjs")) await generateIcons();
