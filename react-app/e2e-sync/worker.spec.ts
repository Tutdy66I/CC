import { expect, test } from "@playwright/test";

test("Edge executes the isolated P1 Worker with versioned results", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const worker = new Worker(
      "/src/workers/ofdmSync.worker.ts?worker_file&type=module",
      { type: "module" },
    );
    const start = performance.now();
    return await new Promise<{
      messages: Array<Record<string, unknown>>;
      elapsed: number;
    }>((resolve, reject) => {
      const messages: Array<Record<string, unknown>> = [];
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Worker timeout"));
      }, 20000);
      worker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(event.message));
      };
      worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
        messages.push(event.data);
        if (event.data.type === "error") {
          clearTimeout(timeout);
          reject(new Error(String(event.data.message)));
        }
        if (event.data.type === "done") {
          clearTimeout(timeout);
          resolve({ messages, elapsed: performance.now() - start });
        }
      };
      worker.postMessage({
        type: "start",
        runId: "edge-p1",
        plan: {
          cp: 16,
        taps: [
          { delay: 0, i: 0.8, q: 0.1 },
          { delay: 1, i: 0.25, q: -0.1 },
          { delay: 3, i: -0.15, q: 0.1 },
          { delay: 7, i: 0.08, q: 0.05 },
        ],
          cfo: 0.1,
          phase: 0,
          ebN0Db: 8,
          energyBasis: "data-eb",
          noiseEnabled: true,
          seed: 20261028,
          trials: 100,
        },
      });
    });
  });
  const ready = result.messages.find((m) => m.type === "ready");
  const done = result.messages.find((m) => m.type === "done");
  expect(ready).toBeTruthy();
  expect(done).toMatchObject({
    runId: "edge-p1",
    engineVersion: "ofdm-sync-v14-p1",
    completed: 100,
  });
  expect(String(done?.protocolHash)).toMatch(/^[a-f0-9]{64}$/);
  expect(String(done?.sourceFingerprint)).toMatch(/^[a-f0-9]{64}$/);
  const trials = result.messages
    .filter((m) => m.type === "batch")
    .flatMap((m) => m.trials as Array<Record<string, unknown>>);
  expect(trials).toHaveLength(100);
  expect(trials[0]).toHaveProperty("raw");
  expect(trials[0]).toHaveProperty("ideal");
  console.log(`Edge P1 Worker: ${result.elapsed.toFixed(0)} ms / 100 frames`);
});
