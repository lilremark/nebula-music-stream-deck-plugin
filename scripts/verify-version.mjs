import { readFile } from "node:fs/promises";

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag?.startsWith("v")) throw new Error("Expected a v-prefixed release tag");

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(
  await readFile("com.lilremark.nebula-music.sdPlugin/manifest.json", "utf8")
);
const releaseVersion = tag.slice(1);

if (packageJson.version !== releaseVersion) {
  throw new Error(`Tag ${tag} does not match package version ${packageJson.version}`);
}
if (manifest.Version !== `${releaseVersion}.0`) {
  throw new Error(`Manifest version ${manifest.Version} must be ${releaseVersion}.0`);
}
