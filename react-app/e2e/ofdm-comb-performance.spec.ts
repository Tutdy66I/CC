import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("measure default OFDM latency, synchronous message handlers and Worker managed heap", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "chromium",
    "Desktop Chromium engineering measurement",
  );
  await page.addInitScript(() => {
    const Native = window.Worker,
      durations: number[] = [];
    Object.assign(window, { ofdmHandlerDurations: durations });
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (!String(args[0]).includes("ofdmCombResearch.worker")) return;
        Object.defineProperty(this, "onmessage", {
          set: (listener: (event: MessageEvent) => void) =>
            this.addEventListener("message", (event) => {
              const t = performance.now();
              listener(event);
              durations.push(performance.now() - t);
            }),
        });
      }
    };
  });
  const cdp = await page.context().newCDPSession(page),
    heap: {
      usedSize: number;
      totalSize: number;
      backingStorageSize?: number;
    }[] = [];
  let workerSession = "",
    id = 0;
  cdp.on("Target.attachedToTarget", (event) => {
    if (
      event.targetInfo.type === "worker" &&
      event.targetInfo.url.includes("ofdmCombResearch.worker")
    )
      workerSession = event.sessionId;
  });
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId === workerSession) {
      const v = JSON.parse(event.message);
      if (v.result?.usedSize) heap.push(v.result);
    }
  });
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  const sampler = setInterval(() => {
    if (workerSession)
      void cdp
        .send("Target.sendMessageToTarget", {
          sessionId: workerSession,
          message: JSON.stringify({ id: ++id, method: "Runtime.getHeapUsage" }),
        })
        .catch(() => {});
  }, 50);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("signallab-ofdm-mode", "comb"),
    );
    await page.goto("/#/signallab");
    const r = page.getByRole("region", {
      name: "OFDM 梳状导频与插值",
      exact: true,
    });
    await expect(
      r.getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true }),
    ).toBeEnabled();
    const started = Date.now();
    await r
      .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
      .click();
    await expect(r.getByRole("status")).toContainText("已保存本地", {
      timeout: 10000,
    });
    const elapsed = Date.now() - started,
      handlerDurations = await page.evaluate(
        () =>
          (window as unknown as { ofdmHandlerDurations: number[] })
            .ofdmHandlerDurations,
      );
    const sorted = [...handlerDurations].sort((a, b) => a - b),
      p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    const result = {
      project: testInfo.project.name,
      userAgent: await page.evaluate(() => navigator.userAgent),
      elapsedMs: elapsed,
      synchronousMessageHandlerP95Ms: p95,
      heapSamples: heap.length,
      peakUsedHeapAndBackingMiB: heap.length
        ? Math.max(
            ...heap.map(
              (s) => (s.usedSize + (s.backingStorageSize ?? 0)) / 1024 ** 2,
            ),
          )
        : null,
      limitation:
        "CDP managed heap/backing-store samples, not peak native/OS Worker working set. Synchronous handlers exclude asynchronous continuations.",
    };
    await testInfo.attach("ofdm-performance.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    await mkdir("../output/signallab-v13-validation", { recursive: true });
    await writeFile(
      "../output/signallab-v13-validation/comb-browser-performance.json",
      JSON.stringify(result, null, 2),
    );
    expect(elapsed).toBeLessThan(5000);
    expect(p95).toBeLessThan(50);
    expect(heap.length).toBeGreaterThan(0);
  } finally {
    clearInterval(sampler);
    await cdp.detach();
  }
});
