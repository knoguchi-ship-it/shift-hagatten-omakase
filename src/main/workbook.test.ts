import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { exportWorkbook } from "./workbook";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("exportWorkbook", () => {
  it("includes configured shift times in the exported shift type header", async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "shiftc-workbook-test-"));
    const file = path.join(temporaryDirectory, "schedule.xlsx");
    await exportWorkbook(file, {
      month: "2026-10",
      staff: [{ id: 1, name: "匿名職員", roleId: null, roleName: "", employmentType: "常勤", minDays: null, maxDays: null }],
      shiftTypes: [{ id: 1, name: "日勤", shortName: "日", colorCode: "#ffffff", startTime: "08:30", endTime: "17:30", countsAsWork: 1 }],
      cells: [{ targetDate: "2026-10-01", staffId: 1, shiftTypeId: 1 }],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    expect(workbook.worksheets[0].getCell(2, 36).text).toBe("日勤\n08:30–17:30");
  });
});
