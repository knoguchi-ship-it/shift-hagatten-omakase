import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  protocol,
  session,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ZodType } from "zod";
import { z } from "zod";
import {
  MonthSchema,
  SaveConditionsSchema,
  SaveConfigurationSchema,
  SaveRoleRequirementsSchema,
  SaveRoleSchema,
  SaveRulesSchema,
  SaveSettingsSchema,
  SaveUnavailableConditionsSchema,
  UpdateCellsSchema,
  ValidateCellsSchema,
} from "./ipc-schemas";
import { Logger } from "./logger";
import { ShiftDatabase } from "./storage";
import { exportWorkbook } from "./workbook";
import {
  APP_PROTOCOL,
  rendererEntryUrl,
  resolveRendererAssetPath,
} from "./app-protocol";
import type {
  Cell,
  MonthlyConstraints,
  NgPair,
  RoleRequirement,
  SequenceRule,
  ShiftType,
  Staff,
  UnavailableCondition,
} from "../shared/types";

let mainWindow: BrowserWindow | undefined;
let database: ShiftDatabase;
let logger: Logger;
const generationJobs = new Map<number, { worker: Worker; cancelSignal: Int32Array }>();
let generationJobCounter = 0;
let rendererHasUnsavedChanges = false;

// `file://` は任意のローカルファイルへの到達面を広げるため使わない。`bypassCSP` は
// 明示せず false を維持し、アプリ配布物だけを配信する安全な標準スキームにする。
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// IPC送信元検証: preload経由の自ウィンドウ以外からの呼び出しを拒否する。
function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (event.senderFrame !== mainWindow?.webContents.mainFrame) {
    throw new Error("不正な呼び出し元です");
  }
}

// tsconfig.main.json は strict: false のため、zod v4 の z.infer をジェネリック越しに使うと
// nullable フィールドの型が正しく伝播しない。Payload は各呼び出し側で明示指定する。
function safeHandle<Payload, Result>(
  channel: string,
  schema: ZodType<unknown>,
  handler: (payload: Payload, event: IpcMainInvokeEvent) => Result,
) {
  ipcMain.handle(channel, (event, payload) => {
    assertTrustedSender(event);
    return handler(schema.parse(payload) as Payload, event);
  });
}

function safeHandleNoArgs<Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent) => Result,
) {
  ipcMain.handle(channel, (event) => {
    assertTrustedSender(event);
    return handler(event);
  });
}

// CSPを本番・開発で分離する（開発時のみVite Dev ServerのHMR接続を許可）。
function applyContentSecurityPolicy() {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const csp = devUrl
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

function registerAppProtocol() {
  const rendererDir = path.join(__dirname, "../renderer");
  protocol.handle(APP_PROTOCOL, (request) => {
    try {
      const file = resolveRendererAssetPath(rendererDir, request.url);
      return new Response(fs.readFileSync(file), {
        headers: { "content-type": contentTypeFor(file) },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function contentTypeFor(file: string) {
  switch (path.extname(file).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function denyAllRendererPermissions() {
  // このアプリはデバイス・位置情報・通知などの権限を必要としない。将来の機能追加時も
  // 個別に設計・許可するまで既定拒否とする。
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
}

function protectUnsavedChanges(window: BrowserWindow) {
  let closeApproved = false;
  let closeDialogOpen = false;
  window.on("close", async (event) => {
    if (closeApproved || !rendererHasUnsavedChanges) return;
    event.preventDefault();
    if (closeDialogOpen) return;
    closeDialogOpen = true;
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      title: "未保存の変更があります",
      message: "保存されていない変更があります。終了すると変更は失われます。",
      buttons: ["キャンセル", "保存せずに終了"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    closeDialogOpen = false;
    if (result.response === 1) {
      rendererHasUnsavedChanges = false;
      closeApproved = true;
      window.close();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadURL(rendererEntryUrl());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  protectUnsavedChanges(mainWindow);
}

function createApplicationMenu() {
  const send = (channel: string) => mainWindow?.webContents.send(channel);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "ファイル",
        submenu: [
          {
            label: "Excelへ出力",
            accelerator: "Ctrl+E",
            click: () => send("menu:export-xlsx"),
          },
          {
            id: "menu-backup",
            label: "データをバックアップ",
            click: async () => {
              const result = await dialog.showSaveDialog(mainWindow!, {
                title: "データをバックアップ",
                defaultPath: "介護シフト_バックアップ.sqlite",
                filters: [{ name: "SQLiteデータ", extensions: ["sqlite"] }],
              });
              if (!result.canceled && result.filePath) {
                await database.backup(result.filePath);
                logger.info(`バックアップを作成しました: ${result.filePath}`);
              }
            },
          },
          {
            id: "menu-restore",
            label: "データを復元",
            click: async () => {
              const result = await dialog.showOpenDialog(mainWindow!, {
                title: "データを復元",
                filters: [{ name: "SQLiteデータ", extensions: ["sqlite"] }],
                properties: ["openFile"],
              });
              if (result.canceled || !result.filePaths[0]) return;
              const confirm = await dialog.showMessageBox(mainWindow!, {
                type: "warning",
                buttons: ["キャンセル", "復元する"],
                defaultId: 0,
                cancelId: 0,
                title: "データを復元",
                message:
                  "現在のデータを選択したバックアップで置き換えます。復元前に現在のデータは自動的にバックアップされます。よろしいですか？",
              });
              if (confirm.response !== 1) return;
              try {
                const r = await database.restore(result.filePaths[0]);
                logger.info(
                  `データを復元しました。復元元: ${result.filePaths[0]} / 復元前バックアップ: ${r.preRestoreBackup}`,
                );
                await dialog.showMessageBox(mainWindow!, {
                  type: "info",
                  title: "復元完了",
                  message: "データを復元しました。アプリを再起動します。",
                });
                app.relaunch();
                app.exit(0);
              } catch (e) {
                logger.error(`データの復元に失敗しました: ${String(e)}`);
                await dialog.showMessageBox(mainWindow!, {
                  type: "error",
                  title: "復元エラー",
                  message: `復元に失敗しました: ${(e as Error).message}`,
                });
              }
            },
          },
          { type: "separator" },
          { label: "終了", accelerator: "Alt+F4", click: () => app.quit() },
        ],
      },
      {
        label: "編集",
        submenu: [
          { label: "元に戻す", role: "undo" },
          { label: "やり直す", role: "redo" },
          { type: "separator" },
          { label: "切り取り", role: "cut" },
          { label: "コピー", role: "copy" },
          { label: "貼り付け", role: "paste" },
        ],
      },
      {
        label: "表示",
        submenu: [
          { label: "再読み込み", role: "reload" },
          { label: "拡大", role: "zoomIn" },
          { label: "縮小", role: "zoomOut" },
          { label: "標準サイズ", role: "resetZoom" },
        ],
      },
      {
        label: "ヘルプ",
        submenu: [
          {
            label: "このアプリについて",
            click: () =>
              dialog.showMessageBox(mainWindow!, {
                type: "info",
                title: "シフトはがってんおまかせ！",
                message: "シフトはがってんおまかせ！",
                detail: "ローカル環境で勤務表を作成・出力するアプリです。",
              }),
          },
        ],
      },
    ]),
  );
}

app.whenReady().then(() => {
  // E2Eテスト等での隔離実行用。本番動作では未設定のため既定のuserDataを使う。
  if (process.env.SHIFTC_USER_DATA_DIR) {
    app.setPath("userData", process.env.SHIFTC_USER_DATA_DIR);
  }
  logger = new Logger(path.join(app.getPath("userData"), "logs"));
  database = new ShiftDatabase(
    path.join(app.getPath("userData"), "database.sqlite"),
  );
  registerAppProtocol();
  denyAllRendererPermissions();
  safeHandleNoArgs("app:get-bootstrap", () => database.bootstrap());
  safeHandle<boolean, void>("app:set-unsaved-changes", z.boolean(), (hasUnsavedChanges) => {
    rendererHasUnsavedChanges = hasUnsavedChanges;
  });
  safeHandle<boolean | undefined, unknown>(
    "app:list-roles",
    z.boolean().optional(),
    (includeDeleted) => database.roles(includeDeleted ?? false),
  );
  safeHandleNoArgs("app:list-staff", () => database.staffIncludingDeleted());
  ipcMain.handle("app:staff-usage", (event, id: number) => {
    assertTrustedSender(event);
    return database.staffUsage(z.number().int().positive().parse(id));
  });
  ipcMain.handle("app:set-staff-deleted", (event, id: number, deleted: boolean) => {
    assertTrustedSender(event);
    return database.setStaffDeleted(z.number().int().parse(id), z.boolean().parse(deleted));
  });
  safeHandle<{ id?: number; name: string; displayOrder?: number }, unknown>(
    "app:save-role",
    SaveRoleSchema,
    (payload) => database.saveRole(payload),
  );
  ipcMain.handle("app:set-role-deleted", (event, id: number, deleted: boolean) => {
    assertTrustedSender(event);
    return database.setRoleDeleted(z.number().int().parse(id), z.boolean().parse(deleted));
  });
  ipcMain.handle("app:role-usage", (event, id: number) => {
    assertTrustedSender(event);
    return database.roleUsageCount(z.number().int().parse(id));
  });
  ipcMain.handle("app:role-requirement-usage", (event, id: number) => {
    assertTrustedSender(event);
    return database.roleRequirementUsageCount(z.number().int().parse(id));
  });
  safeHandleNoArgs("app:list-shift-types", () => database.shiftTypesIncludingDeleted());
  ipcMain.handle("app:shift-type-usage", (event, id: number) => {
    assertTrustedSender(event);
    return database.shiftTypeUsage(z.number().int().positive().parse(id));
  });
  ipcMain.handle("app:set-shift-type-deleted", (event, id: number, deleted: boolean) => {
    assertTrustedSender(event);
    return database.setShiftTypeDeleted(z.number().int().parse(id), z.boolean().parse(deleted));
  });
  safeHandle<{ staff?: Staff[]; shiftTypes?: ShiftType[] }, unknown>(
    "app:save-settings",
    SaveSettingsSchema,
    (payload) => database.saveSettings(payload),
  );
  safeHandle<
    {
      staff: Staff[];
      shiftTypes: ShiftType[];
      ngPairs: NgPair[];
      sequenceRules: SequenceRule[];
      unavailableConditions: UnavailableCondition[];
    },
    unknown
  >("app:save-configuration", SaveConfigurationSchema, (payload) =>
    database.saveConfiguration(payload),
  );
  safeHandle<
    { ngPairs: NgPair[]; sequenceRules: SequenceRule[]; maxConsecutiveDays?: number },
    unknown
  >("app:save-rules", SaveRulesSchema, (payload) => database.saveRules(payload));
  safeHandle<UnavailableCondition[], unknown>(
    "app:save-unavailable-conditions",
    SaveUnavailableConditionsSchema,
    (payload) => database.saveUnavailableConditions(payload),
  );
  safeHandle<{ roleRequirements: RoleRequirement[] }, unknown>(
    "app:save-role-requirements",
    SaveRoleRequirementsSchema,
    (payload) => database.saveRoleRequirements(payload),
  );
  safeHandle<
    {
      roleRequirements: RoleRequirement[];
      changes: {
        targetDate: string;
        staffId: number;
        shiftTypeId: number | null;
        isRequestHoliday?: number;
      }[];
      monthlyConstraints?: MonthlyConstraints;
    },
    unknown
  >("app:save-conditions", SaveConditionsSchema, (payload) => database.saveConditions(payload));
  ipcMain.handle("app:generate-start", (event, month: string) => {
    assertTrustedSender(event);
    MonthSchema.parse(month);
    const jobId = ++generationJobCounter;
    const input = database.getGenerationInput(month);
    // Workerの同期計算中でも、MainからAtomicsで即時に中止要求を伝えられる。
    // postMessageだけではWorkerのイベントループが計算終了まで戻らず、中止できない。
    const cancelSignal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const worker = new Worker(path.join(__dirname, "generation", "worker.js"), {
      workerData: { input, cancelSignal: cancelSignal.buffer },
    });
    generationJobs.set(jobId, { worker, cancelSignal });
    worker.on("message", (msg: { kind: string; [key: string]: unknown }) => {
      if (msg.kind === "progress") {
        mainWindow?.webContents.send("generate:progress", { jobId, ...msg });
      } else if (msg.kind === "done") {
        const result = msg.result as {
          cells: { targetDate: string; staffId: number; shiftTypeId: number | null }[];
          violations: unknown[];
          timedOut: boolean;
        };
        database.applyGeneratedCells(
          result.cells as Parameters<typeof database.applyGeneratedCells>[0],
        );
        mainWindow?.webContents.send("generate:done", {
          jobId,
          ...database.getMonth(month),
          violations: result.violations,
          timedOut: result.timedOut,
        });
        generationJobs.delete(jobId);
        worker.terminate();
      }
    });
    worker.on("error", (err) => {
      logger.error(`自動生成に失敗しました (job ${jobId}): ${String(err)}`);
      mainWindow?.webContents.send("generate:error", {
        jobId,
        message: String(err),
      });
      generationJobs.delete(jobId);
    });
    return jobId;
  });
  ipcMain.handle("app:validate", (event, month: string, cells) => {
    assertTrustedSender(event);
    return database.validateCells(
      MonthSchema.parse(month),
      ValidateCellsSchema.parse(cells) as Cell[],
    );
  });
  ipcMain.handle("app:generate-cancel", (event, jobId: number) => {
    assertTrustedSender(event);
    const job = generationJobs.get(z.number().int().positive().parse(jobId));
    if (job) Atomics.store(job.cancelSignal, 0, 1);
    return true;
  });
  safeHandle<string, unknown>("app:create-month", MonthSchema, (month) =>
    database.createMonth(month),
  );
  safeHandle<string, unknown>("app:get-month", MonthSchema, (month) =>
    database.getMonth(month),
  );
  safeHandle<
    {
      changes: {
        targetDate: string;
        staffId: number;
        shiftTypeId: number | null;
        isRequestHoliday?: number;
      }[];
    },
    unknown
  >("app:update-cell", UpdateCellsSchema, (payload) => database.updateCells(payload));
  ipcMain.handle("app:export-xlsx", async (event, month: string) => {
    assertTrustedSender(event);
    MonthSchema.parse(month);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Excelへ出力",
      defaultPath: `勤務表_${month}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await exportWorkbook(result.filePath, database.getExportData(month));
    return { filePath: result.filePath };
  });
  applyContentSecurityPolicy();
  createApplicationMenu();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
