import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ElectronApplication, Page } from "playwright";

// Windows 11 build 26200 系では、Playwright の Electron loader 経由で Chromium の
// サンドボックス初期化が 0x80000003 で落ちることがある。通常の確認時に利用者の
// 画面へJITダイアログを出さないため、この環境のE2Eは明示指定時だけ起動する。
test.skip(
  process.env.RUN_ELECTRON_E2E !== "1",
  "Electron E2E requires RUN_ELECTRON_E2E=1 on this Windows environment",
);

// マスタ→条件→生成→編集→Excelの主要フローを、隔離したuserDataディレクトリで検証する。
// ビルド成果物（dist/main, dist/renderer）を前提とするため、事前に `npm run build` が必要。

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeEach(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiftc-e2e-"));
  electronApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main", "main.js")],
    env: { ...process.env, SHIFTC_USER_DATA_DIR: userDataDir },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector("text=介護シフト");
});

test.afterEach(async () => {
  await electronApp.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test("マスタ設定→条件設定→自動生成→セル編集→Excel出力→バックアップの主要フローが完走する", async () => {
  // マスタ: 職種と職員を登録する
  await window.click("text=マスタ・ルール設定");
  await window.fill('input[placeholder="例：介護職"]', "介護職");
  await window.click("text=職種マスタ >> .. >> button:has-text('追加')");
  await window.click('button:has-text("職員を追加")');
  await window.fill('input[placeholder="氏名"]', "テスト太郎");
  await window.click('button:has-text("設定を保存")');
  await expect(window.locator("text=設定を保存しました")).toBeVisible();

  // ダッシュボードで対象月を作成する
  await window.click("text=ダッシュボード");
  await window.click('button:has-text("条件設定・シフト編集へ")');
  await expect(window.locator("h2", { hasText: "シフト編集" })).toBeVisible();

  // シフト編集: 自動生成を実行する（必要人数未設定のため即座に完了する）
  await window.click('button:has-text("自動生成")');
  await expect(window.locator("text=保存済み")).toBeVisible({ timeout: 15000 });

  // セル編集: グリッドの先頭セルを手動編集し、未保存→保存済みの状態遷移を確認する
  const firstCell = window.locator('[data-cell="0-0"]');
  await firstCell.click();
  await window.keyboard.press("Enter");
  await firstCell.locator("select").selectOption({ index: 1 });
  await expect(window.locator("text=未保存の変更があります")).toBeVisible();
  await window.click('button:has-text("変更を保存")');
  await expect(window.locator("text=保存済み")).toBeVisible();

  // Excel出力: ネイティブ保存ダイアログをスタブしてファイル生成を確認する
  const exportPath = path.join(userDataDir, "export-test.xlsx");
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, exportPath);
  await window.click('button:has-text("Excelへ出力")');
  await expect(window.locator("text=Excelを出力しました")).toBeVisible({ timeout: 15000 });
  expect(fs.existsSync(exportPath)).toBe(true);

  // バックアップ: アプリケーションメニューから実行し、ネイティブ保存ダイアログをスタブしてファイル生成を確認する
  const backupPath = path.join(userDataDir, "backup-test.sqlite");
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, backupPath);
  await electronApp.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("menu-backup")?.click();
  });
  await expect.poll(() => fs.existsSync(backupPath), { timeout: 15000 }).toBe(true);
});

test("勤務種別マスタの論理削除・復元ができる（第三者評価C-2の回帰確認）", async () => {
  await window.click("text=マスタ・ルール設定");
  const row = window.locator(".form-row", { hasText: "有給" });
  await expect(row).toContainText("有効");

  await row.locator('button:has-text("削除")').click();
  await expect(row).toContainText("削除済み");

  await row.locator('button:has-text("復元")').click();
  await expect(row).toContainText("有効");
});
