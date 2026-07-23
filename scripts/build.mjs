import { context } from "esbuild";
import { generateIcons } from "./generate-icons.mjs";

const watch = process.argv.includes("--watch");
await generateIcons();

const build = await context({
  entryPoints: ["src/plugin.ts"],
  outfile: "com.lilremark.nebula-music.sdPlugin/bin/plugin.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  minify: false,
  logLevel: "info"
});

if (watch) {
  await build.watch();
  console.log("Watching plugin sources...");
} else {
  await build.rebuild();
  await build.dispose();
}
