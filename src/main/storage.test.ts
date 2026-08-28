import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShiftDatabase } from "./storage";

let dir: string;
let opened: ShiftDatabase[];

function open(file: string) {
  const db = new ShiftDatabase(file);
  opened.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiftc-storage-test-"));
  opened = [];
});

afterEach(() => {
  for (const db of opened) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function addStaffWithRole(db: ShiftDatabase, name: string) {
  const roles = db.saveRole({ name: "介護職" });
  const roleId = roles.find((r) => r.name === "介護職")!.id;
  db.saveSettings({
    staff: [
      {
        id: 0,
        name,
        roleId,
        roleName: "",
        employmentType: "full",
        minDays: null,
        maxDays: null,
      },
    ],
  });
}

describe("ShiftDatabase backup/restore", () => {
  it("backs up to a file that a fresh ShiftDatabase can open with the same data", async () => {
    const dbFile = path.join(dir, "main.sqlite");
    const backupFile = path.join(dir, "backup.sqlite");
    const db = open(dbFile);
    addStaffWithRole(db, "Aさん");

    await db.backup(backupFile);

    expect(fs.existsSync(backupFile)).toBe(true);
    const restored = open(backupFile);
    expect(restored.staff().map((s) => s.name)).toEqual(["Aさん"]);
  });

  it("restores a snapshot, replacing current data and creating a pre-restore backup", async () => {
    const dbFile = path.join(dir, "main.sqlite");
    const snapshotFile = path.join(dir, "snapshot.sqlite");
    const db = open(dbFile);
    addStaffWithRole(db, "Aさん");
    await db.backup(snapshotFile);

    // スナップショット取得後に追加したデータは、復元によって失われるはず
    db.saveSettings({
      staff: [
        {
          id: 0,
          name: "Bさん",
          roleId: null,
          roleName: "",
          employmentType: "full",
          minDays: null,
          maxDays: null,
        },
      ],
    });
    expect(db.staff().map((s) => s.name).sort()).toEqual(["Aさん", "Bさん"]);

    const result = await db.restore(snapshotFile);

    expect(db.staff().map((s) => s.name)).toEqual(["Aさん"]);
    expect(fs.existsSync(result.preRestoreBackup)).toBe(true);
  });

  it("rejects restoring an empty file", async () => {
    const dbFile = path.join(dir, "main.sqlite");
    const emptyFile = path.join(dir, "empty.sqlite");
    fs.writeFileSync(emptyFile, "");
    const db = open(dbFile);

    await expect(db.restore(emptyFile)).rejects.toThrow("ファイルが空です");
  });

  it("rejects restoring a sqlite file missing the required tables", async () => {
    const dbFile = path.join(dir, "main.sqlite");
    const junkFile = path.join(dir, "junk.sqlite");
    const junk = new Database(junkFile);
    junk.exec("CREATE TABLE not_a_real_table (id INTEGER)");
    junk.close();
    const db = open(dbFile);

    await expect(db.restore(junkFile)).rejects.toThrow("想定したデータ構造と一致しません");
  });
});

describe("ShiftDatabase logical deletion history", () => {
  it("keeps a deleted shift type available for the month that references it", () => {
    const db = open(path.join(dir, "history.sqlite"));
    const dayShift = db.shiftTypes().find((type) => type.shortName === "日")!;
    const roles = db.saveRole({ name: "介護職" });
    db.saveSettings({
      staff: [
        {
          id: 0,
          name: "Aさん",
          roleId: roles[0].id,
          roleName: "",
          employmentType: "full",
          minDays: null,
          maxDays: null,
        },
      ],
    });
    db.createMonth("2026-10");
    const staff = db.staff()[0];
    db.updateCells({
      changes: [
        {
          targetDate: "2026-10-01",
          staffId: staff.id,
          shiftTypeId: dayShift.id,
          isRequestHoliday: 0,
        },
      ],
    });

    db.setShiftTypeDeleted(dayShift.id, true);

    expect(db.shiftTypes().some((type) => type.id === dayShift.id)).toBe(false);
    expect(db.getMonth("2026-10").shiftTypes).toContainEqual(
      expect.objectContaining({ id: dayShift.id, deletedAt: expect.any(String) }),
    );
  });
});

describe("ShiftDatabase schema migration", () => {
  it("updates a legacy database transactionally and retains its shift history", () => {
    const file = path.join(dir, "legacy.sqlite");
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', employment_type TEXT NOT NULL DEFAULT 'full', min_days INTEGER, max_days INTEGER, deleted_at TEXT, role_id INTEGER);
      CREATE TABLE shift_types (id INTEGER PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL, color_code TEXT NOT NULL, counts_as_work INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
      CREATE TABLE shifts (target_date TEXT NOT NULL, staff_id INTEGER NOT NULL, shift_type_id INTEGER, is_request_holiday INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_date, staff_id));
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE daily_requirements (target_date TEXT NOT NULL, shift_type_id INTEGER NOT NULL, required_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_date, shift_type_id));
      CREATE TABLE ng_pairs (staff_id_1 INTEGER NOT NULL, staff_id_2 INTEGER NOT NULL, PRIMARY KEY(staff_id_1, staff_id_2), CHECK(staff_id_1 < staff_id_2));
      CREATE TABLE shift_sequence_rules (first_shift_type_id INTEGER NOT NULL, second_shift_type_id INTEGER NOT NULL, PRIMARY KEY(first_shift_type_id, second_shift_type_id));
      CREATE TABLE staff_unavailable_conditions (staff_id INTEGER NOT NULL, condition_type TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(staff_id, condition_type, value));
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT);
      CREATE TABLE role_requirements (target_date TEXT NOT NULL, shift_type_id INTEGER NOT NULL, role_id INTEGER NOT NULL, required_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_date, shift_type_id, role_id));
      INSERT INTO roles VALUES(1,'介護職',0,NULL);
      INSERT INTO staff VALUES(1,'Aさん','', 'full',NULL,NULL,NULL,1);
      INSERT INTO shift_types VALUES(1,'日勤','日','#ffffff',1,NULL);
      INSERT INTO shifts VALUES('2026-10-01',1,1,0);
    `);
    legacy.close();

    const db = open(file);
    expect(db.getMonth("2026-10").cells).toContainEqual(
      expect.objectContaining({ staffId: 1, shiftTypeId: 1 }),
    );
    expect(db.shiftTypes()[0]).toEqual(
      expect.objectContaining({ startTime: null, endTime: null }),
    );
  });
});

describe("ShiftDatabase condition saving", () => {
  it("rolls back every condition update when one cell is invalid", () => {
    const db = open(path.join(dir, "conditions.sqlite"));
    const roles = db.saveRole({ name: "介護職" });
    db.saveSettings({
      staff: [
        {
          id: 0,
          name: "Aさん",
          roleId: roles[0].id,
          roleName: "",
          employmentType: "full",
          minDays: null,
          maxDays: null,
        },
      ],
    });
    db.createMonth("2026-10");
    const staff = db.staff()[0];
    const dayShift = db.shiftTypes()[0];

    expect(() =>
      db.saveConditions({
        roleRequirements: [
          {
            targetDate: "2026-10-01",
            shiftTypeId: dayShift.id,
            roleId: roles[0].id,
            requiredCount: 1,
          },
        ],
        changes: [
          {
            targetDate: "2026-10-01",
            staffId: staff.id,
            shiftTypeId: dayShift.id,
            isRequestHoliday: 0,
          },
          {
            targetDate: "2026-10-01",
            staffId: 99999,
            shiftTypeId: dayShift.id,
            isRequestHoliday: 0,
          },
        ],
      }),
    ).toThrow("対象の勤務セルが見つかりません");

    expect(db.getMonth("2026-10").roleRequirements).toHaveLength(0);
    expect(db.getMonth("2026-10").cells.find((cell) => cell.staffId === staff.id)?.shiftTypeId).toBeNull();
  });
});

describe("ShiftDatabase configuration saving", () => {
  it("rolls back master changes when a rule references an unknown staff member", () => {
    const db = open(path.join(dir, "configuration.sqlite"));
    const originalName = db.shiftTypes()[0].name;
    const types = db.shiftTypes().map((type, index) =>
      index === 0 ? { ...type, name: "変更後の日勤" } : type,
    );

    expect(() =>
      db.saveConfiguration({
        staff: [],
        shiftTypes: types,
        ngPairs: [{ staffId1: 1, staffId2: 2 }],
        sequenceRules: [],
        unavailableConditions: [],
      }),
    ).toThrow("職員が見つからないか、削除済みです");

    expect(db.shiftTypes()[0].name).toBe(originalName);
  });

  it("resolves new master temporary IDs before saving the rules that reference them", () => {
    const db = open(path.join(dir, "configuration-temporary-ids.sqlite"));
    const existingType = db.shiftTypes()[0];

    const updated = db.saveConfiguration({
      staff: [
        { id: -1, name: "Aさん", roleId: null, roleName: "", employmentType: "常勤", minDays: null, maxDays: null },
        { id: -2, name: "Bさん", roleId: null, roleName: "", employmentType: "非常勤", minDays: null, maxDays: null },
      ],
      shiftTypes: [
        ...db.shiftTypes(),
        { id: -3, name: "研修", shortName: "研", colorCode: "#eeeeee", startTime: "09:00", endTime: "17:00", countsAsWork: 1 },
      ],
      ngPairs: [{ staffId1: -1, staffId2: -2 }],
      sequenceRules: [{ firstShiftTypeId: existingType.id, secondShiftTypeId: -3 }],
      unavailableConditions: [{ staffId: -1, conditionType: "SHIFT_TYPE", value: -3 }],
    });

    const a = updated.staff.find((staff) => staff.name === "Aさん")!;
    const b = updated.staff.find((staff) => staff.name === "Bさん")!;
    const training = updated.shiftTypes.find((type) => type.name === "研修")!;
    expect(updated.ngPairs).toContainEqual({ staffId1: Math.min(a.id, b.id), staffId2: Math.max(a.id, b.id) });
    expect(updated.sequenceRules).toContainEqual({ firstShiftTypeId: existingType.id, secondShiftTypeId: training.id });
    expect(updated.unavailableConditions).toContainEqual({ staffId: a.id, conditionType: "SHIFT_TYPE", value: training.id });
  });
});
