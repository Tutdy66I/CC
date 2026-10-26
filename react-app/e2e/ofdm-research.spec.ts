import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
const name = "OFDM 与频率选择性多径";

test("late checkpoint hashes from repeated cancelled starts cannot replace the current Worker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle),
      releases: (() => void)[] = [];
    Object.assign(window, {
      ofdmHashRace: {
        count: () => releases.length,
        release: () => releases.forEach((fn) => fn()),
      },
    });
    crypto.subtle.digest = async (
      ...args: Parameters<SubtleCrypto["digest"]>
    ) => {
      if (
        new TextDecoder()
          .decode(args[1] as ArrayBuffer)
          .includes('"status":"checkpoint"') &&
        releases.length < 2
      )
        await new Promise<void>((resolve) => releases.push(resolve));
      return digest(...args);
    };
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await r
      .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { ofdmHashRace: { count: () => number } }
          ).ofdmHashRace.count(),
        ),
      )
      .toBe(attempt);
    await r
      .getByRole("button", { name: "取消 OFDM 计算", exact: true })
      .click();
    await expect(r.getByRole("status")).toContainText("已取消");
  }
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText(/计算中.*帧/);
  await page.evaluate(() =>
    (
      window as unknown as { ofdmHashRace: { release: () => void } }
    ).ofdmHashRace.release(),
  );
  await expect(r.getByRole("status")).toContainText("已保存本地", {
    timeout: 10000,
  });
  await expect(r.getByRole("alert")).not.toBeAttached();
});

test("OFDM initialization can be cancelled and a late ready cannot start a new run", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    let hold = true,
      release = () => {},
      terminations = 0;
    Object.assign(window, {
      ofdmInitTest: {
        release: () => {
          hold = false;
          release();
        },
        terminations: () => terminations,
      },
    });
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (!String(args[0]).includes("ofdmResearch.worker")) return;
        const send = this.postMessage.bind(this),
          terminate = this.terminate.bind(this);
        this.postMessage = (payload: unknown) => {
          if (hold && (payload as { type?: unknown })?.type === "init")
            release = () => {
              try {
                send(payload);
              } catch {
                /* terminated old Worker */
              }
            };
          else send(payload);
        };
        this.terminate = () => {
          terminations++;
          terminate();
        };
      }
    };
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r.getByLabel("OFDM 试验帧数").fill("4");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("正在初始化");
  await r.getByRole("button", { name: "取消 OFDM 计算", exact: true }).click();
  await expect(r.getByRole("status")).toContainText("已取消");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { ofdmInitTest: { terminations: () => number } }
      ).ofdmInitTest.terminations(),
    ),
  ).toBeGreaterThan(0);
  await page.evaluate(() =>
    (
      window as unknown as { ofdmInitTest: { release: () => void } }
    ).ofdmInitTest.release(),
  );
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("已保存本地");
});

test("OFDM binds runtime identity to the numerical Worker when the window user agent differs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () => "Window-only test user agent; Worker keeps its native runtime",
    });
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r.getByLabel("OFDM 试验帧数").fill("4");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("已保存本地");
  await expect(r.getByRole("alert")).not.toBeAttached();
});

test("OFDM failed local write keeps the new result exportable and the previous record intact", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, { failOfdmPut: false });
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (
        this.transaction.db.name === "signallab-ofdm-research-v13" &&
        (window as unknown as { failOfdmPut: boolean }).failOfdmPut
      )
        throw new DOMException("Injected quota failure", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r.getByLabel("OFDM 试验帧数").fill("8");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("已保存本地");
  await page.evaluate(() => {
    (window as unknown as { failOfdmPut: boolean }).failOfdmPut = true;
  });
  await r.getByLabel("OFDM 试验帧数").fill("4");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("alert")).toContainText("Injected quota failure");
  const pending = page.waitForEvent("download");
  await r.getByRole("button", { name: "导出 OFDM JSON", exact: true }).click();
  const value = JSON.parse(
    await readFile((await (await pending).path())!, "utf8"),
  );
  expect(value.trials).toHaveLength(4);
  await page.reload();
  await expect(r.getByRole("status")).toContainText("已恢复本地完整记录");
  const old = page.waitForEvent("download");
  await r.getByRole("button", { name: "导出 OFDM JSON", exact: true }).click();
  expect(
    JSON.parse(await readFile((await (await old).path())!, "utf8")).trials,
  ).toHaveLength(8);
});

test("OFDM delayed start is invalidated when the experiment unmounts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle),
      NativeWorker = window.Worker;
    let release: () => void = () => {},
      count = 0,
      held = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      release: () => release(),
      workers: () => count,
      held: () => held,
    };
    Object.assign(window, { ofdmLaunchTest: state });
    crypto.subtle.digest = async (
      ...args: Parameters<SubtleCrypto["digest"]>
    ) => {
      if (
        new TextDecoder().decode(args[1] as ArrayBuffer).includes("ofdm-v13.1")
      ) {
        held++;
        await gate;
      }
      return original(...args);
    };
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (String(args[0]).includes("ofdmResearch.worker")) count++;
      }
    };
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { ofdmLaunchTest: { held: () => number } }
        ).ofdmLaunchTest.held(),
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    location.hash = "#/todos";
  });
  await expect(r).not.toBeAttached();
  // A lazy route may first hide the old Suspense tree; wait for the actual replacement.
  await expect(
    page.getByRole("heading", { name: "Todo", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => {
    const s = (window as unknown as { ofdmLaunchTest: { release: () => void } })
      .ofdmLaunchTest;
    s.release();
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { ofdmLaunchTest: { workers: () => number } }
      ).ofdmLaunchTest.workers(),
    ),
  ).toBe(0);
});

test("OFDM refuses a validly hashed completed record that replaces an accepted prefix", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (!String(args[0]).includes("ofdmResearch.worker")) return;
        Object.defineProperty(this, "onmessage", {
          set: (listener: (event: MessageEvent) => void) => {
            this.addEventListener("message", (event) => {
              void (async () => {
                const data = structuredClone(event.data);
                if (data.type === "done") {
                  data.record.trials[0].cells[0].preview.received[0] += 1;
                  const { integrityHash, ...payload } = data.record;
                  void integrityHash;
                  const canonical = (v: unknown): string =>
                    v === null || typeof v !== "object"
                      ? JSON.stringify(v)
                      : Array.isArray(v)
                        ? `[${v.map(canonical).join(",")}]`
                        : `{${Object.keys(v)
                            .sort()
                            .map(
                              (k) =>
                                `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
                            )
                            .join(",")}}`;
                  const hash = await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(canonical(payload)),
                  );
                  data.record.integrityHash = [...new Uint8Array(hash)]
                    .map((x) => x.toString(16).padStart(2, "0"))
                    .join("");
                }
                listener(new MessageEvent("message", { data }));
              })();
            });
          },
        });
      }
    };
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r.getByLabel("OFDM 试验帧数").fill("4");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("alert")).toContainText("前缀不一致");
  await expect(r.getByRole("status")).toContainText("检查点");
  await expect(
    r.getByRole("table", { name: "OFDM BER 与完整帧区间" }),
  ).not.toBeAttached();
});

test("queued errors from a cancelled OFDM Worker cannot stop the next run", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker,
      workers: Worker[] = [];
    Object.assign(window, { ofdmWorkers: workers });
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (String(args[0]).includes("ofdmResearch.worker")) workers.push(this);
      }
    };
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await r.getByRole("button", { name: "取消 OFDM 计算", exact: true }).click();
  await expect(r.getByRole("status")).toContainText("已取消");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await page.evaluate(() => {
    const first = (window as unknown as { ofdmWorkers: Worker[] })
      .ofdmWorkers[0];
    first.onerror?.call(
      first,
      new ErrorEvent("error", { message: "queued old error" }),
    );
  });
  await expect(r.getByRole("status")).toContainText("已保存本地");
  await expect(r.getByRole("alert")).not.toBeAttached();
});
test("OFDM runs a real isolated Worker, exports validated frames, plots and restores local history", async ({
  page,
}, testInfo) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4175") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await expect(r).toBeAttached();
  await r.getByLabel("OFDM 试验帧数").fill("8");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("实验完成");
  await expect(
    r.getByRole("table", { name: "OFDM BER 与完整帧区间" }),
  ).toBeVisible();
  await expect(r.getByRole("img", { name: "OFDM 信道频率响应" })).toBeVisible();
  const download = page.waitForEvent("download");
  await r.getByRole("button", { name: "导出 OFDM JSON", exact: true }).click();
  const record = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(record.status).toBe("complete");
  expect(record.trials).toHaveLength(8);
  expect(record.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  for (const t of record.trials)
    for (const c of t.cells)
      expect(c.methods["ls-zf"].errors).toBe(c.methods["ls-mmse"].errors);
  await page.reload();
  await expect(r.getByRole("status")).toContainText("已恢复本地完整记录");
  const nav = page.getByRole("navigation", { name: "实验章节" });
  await nav.getByRole("button", { name: "OFDM 研究", exact: true }).click();
  const position = await r
    .getByRole("heading", { name, exact: true })
    .evaluate((node) => ({
      top: node.getBoundingClientRect().top,
      bottom: document
        .querySelector(".signal-section-nav")!
        .getBoundingClientRect().bottom,
    }));
  expect(position.top).toBeGreaterThanOrEqual(position.bottom);
  expect(external).toEqual([]);
  await page.screenshot({
    path: `../output/playwright/ofdm-${testInfo.project.name}.png`,
    fullPage: false,
  });
});
test("OFDM cancellation saves a contiguous prefix and resumes the frozen plan", async ({
  page,
}) => {
  await page.goto("/#/signallab");
  const r = page.getByRole("region", { name, exact: true });
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText(/计算中.*帧/);
  await r.getByRole("button", { name: "取消 OFDM 计算", exact: true }).click();
  await expect(r.getByRole("status")).toContainText("已取消");
  await page.reload();
  await expect(r.getByRole("status")).toContainText("检查点");
  await r
    .getByRole("button", { name: "继续 OFDM 检查点", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("实验完成");
});
