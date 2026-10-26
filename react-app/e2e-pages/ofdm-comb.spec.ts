import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("static Pages comb Worker runs, draws signed-frequency interpolation and restores isolated history", async ({
  page,
}) => {
  await page.goto("./#/signallab");
  await page.getByLabel("OFDM 实验模式").selectOption("comb");
  const r = page.getByRole("region", {
    name: "OFDM 梳状导频与插值",
    exact: true,
  });
  await r.getByLabel("OFDM 试验帧数").fill("4");
  await r
    .getByRole("button", { name: "冻结 OFDM 协议并运行", exact: true })
    .click();
  await expect(r.getByRole("status")).toContainText("已保存本地");
  await expect(
    r.getByRole("img", { name: "梳状导频信道频率响应实部" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await r.getByRole("button", { name: "导出 OFDM JSON", exact: true }).click();
  const record = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(record.engineVersion).toBe("ofdm-v13.2");
  expect(record.plan.pilotLayouts).toHaveLength(2);
  await page.reload();
  await expect(r.getByRole("status")).toContainText("已恢复本地完整记录");
  await page.getByLabel("OFDM 实验模式").selectOption("training");
  await expect(
    page.getByRole("region", { name: "OFDM 与频率选择性多径", exact: true }),
  ).toBeAttached();
});
