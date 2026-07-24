import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

export async function generateIcons() {
  const output = "com.lilremark.nebula-music.sdPlugin/imgs";
  const [pluginSvg, categorySvg] = await Promise.all([
    readFile("assets/plugin.svg"),
    readFile(`${output}/action.svg`)
  ]);
  await mkdir(output, { recursive: true });
  await Promise.all([
    sharp(pluginSvg).resize(256, 256).png().toFile(`${output}/plugin.png`),
    sharp(pluginSvg).resize(512, 512).png().toFile(`${output}/plugin@2x.png`),
    sharp(categorySvg).resize(28, 28).png().toFile(`${output}/category.png`),
    sharp(categorySvg).resize(56, 56).png().toFile(`${output}/category@2x.png`)
  ]);
}

if (process.argv[1]?.endsWith("generate-icons.mjs")) await generateIcons();
