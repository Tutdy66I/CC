import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const measurements = {
      doneBytes: [] as number[],
      longTasks: [] as number[],
      longTaskSupported: Boolean(
        PerformanceObserver.supportedEntryTypes?.includes("longtask"),
      ),
    };
    Object.assign(window, { __p1cMeasurements: measurements });
    if (measurements.longTaskSupported) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          measurements.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    }
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (event) => {
          if (
            event.data?.version === "signallab-v15-p1c-worker-1" &&
            event.data.type === "done"
          ) {
            measurements.doneBytes.push(
              new TextEncoder().encode(JSON.stringify(event.data)).byteLength,
            );
          }
        });
      }
      postMessage(message: unknown) {
        const control = window as unknown as { __p1cHoldNextStart?: boolean };
        if (
          control.__p1cHoldNextStart &&
          (message as { version?: string })?.version ===
            "signallab-v15-p1c-worker-1"
        ) {
          control.__p1cHoldNextStart = false;
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto("/#/signallab");
});

test("one and sixteen engineering frames report complete results and measurements", async ({
  page,
}, testInfo) => {
  const panel = page.getByRole("region", { name: "v1.5 同步误差工程对照" });
  await expect(panel).toContainText("engineering-test-only");
  const durations: number[] = [];
  for (const count of [1, 16]) {
    await panel
      .getByLabel("工程帧 ID（1–16 个）")
      .fill(Array.from({ length: count }, (_, i) => i + 101).join(","));
    const start = Date.now();
    await panel.getByRole("button", { name: "运行工程对照" }).click();
    await expect(panel.getByRole("status")).toHaveText("工程对照完成");
    durations.push(Date.now() - start);
    await expect(
      panel.getByRole("heading", { name: "四点受控干预" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "累计配对差及交互界" }),
    ).toBeVisible();
    const rows = panel.locator("table").first().getByRole("row");
    await expect(rows.nth(1)).toContainText("raw");
    await expect(rows.nth(1)).toContainText(String(768 * count));
    await expect(rows.nth(3)).toContainText("ideal");
    await expect(rows.nth(3)).toContainText(String(768 * count));
  }
  await panel.getByLabel("噪声功率").fill("0.2");
  await expect(panel.getByText(/本次结果快照/)).toContainText("噪声功率 0.01");
  await expect(panel.getByText(/当前输入的信道抽头能量/)).toContainText(
    "噪声功率：0.2",
  );
  const measurement = await page.evaluate(
    () =>
      (
        window as unknown as {
          __p1cMeasurements: {
            doneBytes: number[];
            longTasks: number[];
            longTaskSupported: boolean;
          };
        }
      ).__p1cMeasurements,
  );
  expect(measurement.doneBytes).toHaveLength(2);
  expect(Math.max(...measurement.doneBytes)).toBeLessThanOrEqual(
    2 * 1024 * 1024,
  );
  await testInfo.attach("engineering-metrics.json", {
    body: JSON.stringify(
      {
        durationsMs: durations,
        ...measurement,
        memory: "not measured",
        bytesMethod: "UTF-8 JSON serialization of received done message",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  console.log(
    `P1c ${testInfo.project.name}: ${JSON.stringify({ durationsMs: durations, ...measurement })}`,
  );
});

test("cancelled task publishes no result and a new run completes", async ({
  page,
}, testInfo) => {
  const panel = page.getByRole("region", { name: "v1.5 同步误差工程对照" });
  await panel
    .getByLabel("工程帧 ID（1–16 个）")
    .fill(Array.from({ length: 16 }, (_, i) => i + 501).join(","));
  // Hold this one start message so cancellation is tested while the worker is active,
  // independent of how quickly a device finishes all sixteen frames.
  await page.evaluate(() => {
    (window as unknown as { __p1cHoldNextStart: boolean }).__p1cHoldNextStart =
      true;
  });
  await panel.getByRole("button", { name: "运行工程对照" }).click();
  const start = Date.now();
  await panel.getByRole("button", { name: "取消工程对照" }).click();
  await expect(panel.getByRole("status")).toContainText("已取消");
  const cancelMs = Date.now() - start;
  expect(cancelMs).toBeLessThan(1000);
  console.log(`P1c ${testInfo.project.name}: gated cancellation ${cancelMs}ms`);
  await expect(
    panel.getByRole("heading", { name: "累计接收结果" }),
  ).toHaveCount(0);
  await panel.getByLabel("工程帧 ID（1–16 个）").fill("999");
  await panel.getByRole("button", { name: "运行工程对照" }).click();
  await expect(panel.getByRole("status")).toHaveText("工程对照完成");
  await expect(panel).toContainText("999");
  await panel.getByLabel("工程帧 ID（1–16 个）").fill("1,1");
  await panel.getByRole("button", { name: "运行工程对照" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "累计接收结果" }),
  ).toHaveCount(0);
});
