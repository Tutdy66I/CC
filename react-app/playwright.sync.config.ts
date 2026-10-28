import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-sync",
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${process.env.SIGNALLAB_SYNC_PORT || "4178"}`,
    browserName: "chromium",
    channel: "msedge",
    headless: true,
  },
});
