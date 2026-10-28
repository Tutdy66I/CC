import { expect, test } from "@playwright/test";

test("joint synchronization runs three receivers and restores an isolated local record", async ({
  page,
}) => {
  await page.goto("/#/signallab");
  const panel = page.getByRole("region", {
    name: "OFDM 接收同步",
    exact: true,
  });
  await expect(panel).toBeVisible({ timeout: 2500 });
  await panel.getByLabel("同步试验帧数").fill("4");
  await panel.getByLabel("归一化频偏").fill("0.25");
  await panel.getByLabel("整数定时偏移").fill("4");
  await panel.getByRole("button", { name: "运行同步对照" }).click();
  await expect(panel.getByRole("status")).toContainText("已保存本地", {
    timeout: 15000,
  });
  await expect(panel.getByText("未同步", { exact: true })).toBeVisible();
  await expect(panel.getByText("理想同步", { exact: true })).toBeVisible();
  await expect(panel.getByText("估计同步", { exact: true })).toBeVisible();
  await expect(panel.getByText(/采集失败/)).toBeVisible();
  await page.reload();
  await expect(panel.getByRole("status")).toContainText("已恢复本地记录");
  await panel.getByLabel("同步试验帧数").fill("1000");
  await panel.getByRole("button", { name: "运行同步对照" }).click();
  await panel.getByRole("button", { name: "取消同步计算" }).click();
  await expect(panel.getByRole("status")).toContainText("已取消");
  await page.reload();
  await expect(panel.getByRole("status")).toContainText("已恢复本地记录");
  await expect(panel.getByText(/完成 4 帧/)).toBeVisible();
});

test("joint synchronization 100-frame engineering budget on Edge", async ({
  page,
}) => {
  await page.goto("/#/signallab");
  const panel = page.getByRole("region", {
    name: "OFDM 接收同步",
    exact: true,
  });
  await panel.getByLabel("同步试验帧数").fill("100");
  await panel.getByLabel("同步信道").selectOption("multipath");
  const start = Date.now();
  await panel.getByRole("button", { name: "运行同步对照" }).click();
  await expect(panel.getByRole("status")).toContainText("已保存本地", {
    timeout: 10000,
  });
  const elapsed = Date.now() - start;
  console.log(
    `Edge joint sync end to end: ${elapsed} ms / 100 frames, three-path`,
  );
  expect(elapsed).toBeLessThan(10000);
});
