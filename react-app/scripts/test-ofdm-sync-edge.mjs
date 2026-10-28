import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

const probe = createServer();
await new Promise((resolve, reject) => {
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) =>
  probe.close((error) => (error ? reject(error) : resolve())),
);
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, AI_API_KEY: "", AI_BASE_URL: "", AI_MODEL: "" },
  },
);
let serverExited = false;
server.on("exit", () => {
  serverExited = true;
});
try {
  let ready = false;
  for (let i = 0; i < 150 && !serverExited; i++) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/`)).ok;
    } catch {
      /* wait for the local server */
    }
    if (ready) break;
    await delay(200);
  }
  if (!ready || serverExited)
    throw new Error("P1 Edge test server failed to start.");
  const test = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config=playwright.sync.config.ts",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, SIGNALLAB_SYNC_PORT: String(port) },
    },
  );
  const code = await new Promise((resolve, reject) => {
    test.on("error", reject);
    test.on("exit", resolve);
  });
  process.exitCode = code === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill();
}
