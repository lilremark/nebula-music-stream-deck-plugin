import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

function findNodeRuntime() {
  if (process.env.STREAMDECK_NODE) return process.env.STREAMDECK_NODE;
  if (process.platform !== "win32" || !process.env.APPDATA) return process.execPath;

  const runtimesDirectory = join(process.env.APPDATA, "Elgato", "StreamDeck", "NodeJS");
  if (!existsSync(runtimesDirectory)) return process.execPath;

  const versions = readdirSync(runtimesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("24."))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

  const streamDeckNode = versions[0] ? join(runtimesDirectory, versions[0], "node.exe") : undefined;
  return streamDeckNode && existsSync(streamDeckNode) ? streamDeckNode : process.execPath;
}

const pluginDirectory = fileURLToPath(
  new URL("../com.lilremark.nebula-music.sdPlugin/", import.meta.url)
);
const pluginPath = join(pluginDirectory, "bin", "plugin.js");
const pluginUuid = "com.lilremark.nebula-music.smoke-test";
const host = new WebSocketServer({ host: "127.0.0.1", port: 0 });

await once(host, "listening");
const address = host.address();
if (typeof address === "string" || address === null) {
  throw new Error("Unable to determine the smoke-test server port.");
}

const streamDeckInfo = {
  application: {
    font: "Arial",
    language: "en",
    platform: process.platform === "darwin" ? "mac" : "windows",
    platformVersion: "smoke-test",
    version: "7.1.0"
  },
  colors: {},
  devicePixelRatio: 1,
  devices: [],
  plugin: {
    uuid: "com.lilremark.nebula-music",
    version: "0.1.0.0"
  }
};

const child = spawn(
  findNodeRuntime(),
  [
    pluginPath,
    "-port",
    String(address.port),
    "-pluginUUID",
    pluginUuid,
    "-registerEvent",
    "registerPlugin",
    "-info",
    JSON.stringify(streamDeckInfo)
  ],
  {
    cwd: pluginDirectory,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  }
);

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        reject(
          new Error(
            `Plugin exited before registration (code ${String(code)}, signal ${String(signal)}).`
          )
        );
      });

      host.once("connection", (socket) => {
        socket.once("message", (data) => {
          try {
            const registration = JSON.parse(data.toString());
            if (registration.event !== "registerPlugin" || registration.uuid !== pluginUuid) {
              reject(new Error("Plugin sent an invalid Stream Deck registration message."));
              return;
            }

            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    }),
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for plugin registration.")),
        10_000
      );
      timeout.unref();
    })
  ]);
} catch (error) {
  const detail = stderr.trim();
  throw new Error(`${error.message}${detail ? `\nPlugin stderr:\n${detail}` : ""}`, {
    cause: error
  });
} finally {
  child.kill();
  await new Promise((resolve) => host.close(resolve));
}

console.log("Plugin runtime smoke test passed.");
