import ExcelJS from "exceljs";
import type { ShiftType, Staff } from "../shared/types";

type ExportData = {
  month: string;
  staff: Staff[];
  shiftTypes: ShiftType[];
  cells: { targetDate: string; staffId: number; shiftTypeId: number | null }[];
};

export async function exportWorkbook(file: string, data: ExportData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "介護シフト作成";
  const sheet = workbook.addWorksheet(`${data.month.replace("-", "年")}月`);
  const [year, month] = data.month.split("-").map(Number);
  const dayCount = new Date(year, month, 0).getDate();
  const dates = Array.from(
    { length: dayCount },
    (_, i) => `${data.month}-${String(i + 1).padStart(2, "0")}`,
  );
  const weekday = ["日", "月", "火", "水", "木", "金", "土"];
  const byCell = new Map(
    data.cells.map((c) => [`${c.staffId}/${c.targetDate}`, c.shiftTypeId]),
  );
  const types = new Map(data.shiftTypes.map((t) => [t.id, t]));

  sheet.mergeCells(1, 1, 1, 4 + dayCount);
  sheet.getCell(1, 1).value = `${year}年${month}月　介護勤務表`;
  sheet.getCell(1, 1).font = { bold: true, size: 16 };
  sheet.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;
  const headers = ["NO", "氏名", "職種", "区分"];
  headers.forEach((value, i) => {
    sheet.mergeCells(2, i + 1, 3, i + 1);
    sheet.getCell(2, i + 1).value = value;
  });
  dates.forEach((date, i) => {
    const d = new Date(`${date}T00:00:00`);
    const col = 5 + i;
    sheet.getCell(2, col).value = i + 1;
    sheet.getCell(3, col).value = weekday[d.getDay()];
  });
  const totalStart = 5 + dayCount;
  data.shiftTypes.forEach((type, i) => {
    sheet.mergeCells(2, totalStart + i, 3, totalStart + i);
    sheet.getCell(2, totalStart + i).value =
      type.startTime && type.endTime
        ? `${type.name}\n${type.startTime}–${type.endTime}`
        : type.name;
  });
  sheet.mergeCells(
    2,
    totalStart + data.shiftTypes.length,
    3,
    totalStart + data.shiftTypes.length,
  );
  sheet.getCell(2, totalStart + data.shiftTypes.length).value = "勤務日数";
  for (let row = 2; row <= 3; row++)
    for (let col = 1; col <= totalStart + data.shiftTypes.length; col++) {
      const cell = sheet.getCell(row, col);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "D9EAD3" },
      };
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = thinBorder();
    }
  data.staff.forEach((person, i) => {
    const row = 4 + i;
    const values = [i + 1, person.name, person.roleName, "予定"];
    values.forEach((v, j) => (sheet.getCell(row, j + 1).value = v));
    const counts = new Map<number, number>();
    dates.forEach((date, j) => {
      const cell = sheet.getCell(row, 5 + j);
      const id = byCell.get(`${person.id}/${date}`);
      const type = id ? types.get(id) : undefined;
      cell.value = type?.shortName ?? "";
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (type)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: type.colorCode.replace("#", "").padStart(6, "F") },
        };
    });
    data.shiftTypes.forEach(
      (type, j) =>
        (sheet.getCell(row, totalStart + j).value = counts.get(type.id) ?? 0),
    );
    sheet.getCell(row, totalStart + data.shiftTypes.length).value =
      data.shiftTypes
        .filter((t) => t.countsAsWork)
        .reduce((n, t) => n + (counts.get(t.id) ?? 0), 0);
    for (let col = 1; col <= totalStart + data.shiftTypes.length; col++) {
      const cell = sheet.getCell(row, col);
      cell.border = thinBorder();
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { size: 9 };
    }
    sheet.getCell(row, 2).alignment = {
      horizontal: "left",
      vertical: "middle",
    };
    sheet.getRow(row).height = 20;
  });
  sheet.columns = [
    { width: 5 },
    { width: 16 },
    { width: 14 },
    { width: 8 },
    ...dates.map(() => ({ width: 4.5 })),
    ...data.shiftTypes.map(() => ({ width: 7 })),
    { width: 8 },
  ];
  sheet.views = [{ state: "frozen", xSplit: 4, ySplit: 3 }];
  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.2,
      right: 0.2,
      top: 0.4,
      bottom: 0.4,
      header: 0.1,
      footer: 0.1,
    },
  };
  sheet.pageSetup.printArea = `A1:${sheet.getCell(4 + data.staff.length, totalStart + data.shiftTypes.length).address}`;
  await workbook.xlsx.writeFile(file);
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const s: ExcelJS.Border = { style: "thin", color: { argb: "8C8C8C" } };
  return { top: s, left: s, bottom: s, right: s };
}
