import { rm } from "node:fs/promises";

await rm("com.lilremark.nebula-music.sdPlugin/bin", { force: true, recursive: true });
