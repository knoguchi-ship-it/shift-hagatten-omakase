import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  Boot,
  Cell,
  GenerationInput,
  MonthData,
  NgPair,
  Role,
  RoleRequirement,
  SequenceRule,
  ShiftType,
  Staff,
  UnavailableCondition,
} from "../shared/types";
import { validateCells as validateCellsPure } from "./generation/engine";

const STAFF_SELECT = `SELECT s.id AS id, s.name AS name, s.role_id AS roleId, COALESCE(r.name,'') AS roleName,
  s.employment_type AS employmentType, s.min_days AS minDays, s.max_days AS maxDays, s.deleted_at AS deletedAt
  FROM staff s LEFT JOIN roles r ON r.id = s.role_id`;

const REQUIRED_TABLES = [
  "staff",
  "shift_types",
  "shifts",
  "roles",
  "role_requirements",
  "ng_pairs",
  "shift_sequence_rules",
];
const MAX_RESTORE_BYTES = 500 * 1024 * 1024;
const LATEST_SCHEMA_VERSION = 2;

export class ShiftDatabase {
  private db: Database.Database;
  private file: string;
  constructor(file: string) {
    this.file = file;
    this.db = new Database(file);
    this.migrate();
    this.seed();
  }
  private migrate() {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = OFF");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const hasStaff = Boolean(
      this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='staff'")
        .get(),
    );
    const versionRow = this.db
      .prepare("SELECT value FROM schema_meta WHERE key='schema_version'")
      .get() as { value: string } | undefined;
    const version = Number(versionRow?.value ?? 0);

    if (!hasStaff) {
      this.createLatestSchema();
      this.setSchemaVersion(LATEST_SCHEMA_VERSION);
    } else if (version < LATEST_SCHEMA_VERSION) {
      this.migrateLegacySchema();
    }
    this.db.pragma("foreign_keys = ON");
    const violations = this.db.pragma("foreign_key_check") as { table: string; rowid: number }[];
    if (violations.length)
      throw new Error("データの参照整合性を確認できません。復元前バックアップを確認してください");
  }
  private setSchemaVersion(version: number) {
    this.db
      .prepare(
        "INSERT INTO schema_meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(version));
  }
  private createLatestSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS shift_types (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        color_code TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        counts_as_work INTEGER NOT NULL DEFAULT 1 CHECK(counts_as_work IN (0,1)),
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        role_id INTEGER REFERENCES roles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        employment_type TEXT NOT NULL DEFAULT 'full',
        min_days INTEGER,
        max_days INTEGER,
        deleted_at TEXT,
        CHECK(min_days IS NULL OR min_days >= 0),
        CHECK(max_days IS NULL OR max_days >= 0),
        CHECK(min_days IS NULL OR max_days IS NULL OR min_days <= max_days)
      );
      CREATE TABLE IF NOT EXISTS shifts (
        target_date TEXT NOT NULL,
        staff_id INTEGER NOT NULL REFERENCES staff(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        shift_type_id INTEGER REFERENCES shift_types(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        is_request_holiday INTEGER NOT NULL DEFAULT 0 CHECK(is_request_holiday IN (0,1)),
        PRIMARY KEY(target_date, staff_id),
        CHECK(NOT (is_request_holiday = 1 AND shift_type_id IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS daily_requirements (
        target_date TEXT NOT NULL,
        shift_type_id INTEGER NOT NULL REFERENCES shift_types(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        required_count INTEGER NOT NULL DEFAULT 0 CHECK(required_count >= 0),
        PRIMARY KEY(target_date, shift_type_id)
      );
      CREATE TABLE IF NOT EXISTS ng_pairs (
        staff_id_1 INTEGER NOT NULL REFERENCES staff(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        staff_id_2 INTEGER NOT NULL REFERENCES staff(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        PRIMARY KEY(staff_id_1, staff_id_2),
        CHECK(staff_id_1 < staff_id_2)
      );
      CREATE TABLE IF NOT EXISTS shift_sequence_rules (
        first_shift_type_id INTEGER NOT NULL REFERENCES shift_types(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        second_shift_type_id INTEGER NOT NULL REFERENCES shift_types(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        PRIMARY KEY(first_shift_type_id, second_shift_type_id)
      );
      CREATE TABLE IF NOT EXISTS staff_unavailable_conditions (
        staff_id INTEGER NOT NULL REFERENCES staff(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        condition_type TEXT NOT NULL CHECK(condition_type IN ('WEEKDAY','SHIFT_TYPE')),
        value INTEGER NOT NULL,
        PRIMARY KEY(staff_id, condition_type, value),
        CHECK((condition_type = 'WEEKDAY' AND value BETWEEN 0 AND 6) OR condition_type = 'SHIFT_TYPE')
      );
      CREATE TABLE IF NOT EXISTS role_requirements (
        target_date TEXT NOT NULL,
        shift_type_id INTEGER NOT NULL REFERENCES shift_types(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        required_count INTEGER NOT NULL DEFAULT 0 CHECK(required_count >= 0),
        PRIMARY KEY(target_date, shift_type_id, role_id)
      );
    `);
  }
  private migrateLegacySchema() {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE roles_new (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
          display_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
        );
        INSERT INTO roles_new SELECT id,name,display_order,deleted_at FROM roles;
        CREATE TABLE shift_types_new (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL,
          color_code TEXT NOT NULL, start_time TEXT, end_time TEXT,
          counts_as_work INTEGER NOT NULL DEFAULT 1 CHECK(counts_as_work IN (0,1)), deleted_at TEXT
        );
        INSERT INTO shift_types_new(id,name,short_name,color_code,counts_as_work,deleted_at)
          SELECT id,name,short_name,color_code,counts_as_work,deleted_at FROM shift_types;
        CREATE TABLE staff_new (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
          role_id INTEGER REFERENCES roles_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          employment_type TEXT NOT NULL DEFAULT 'full', min_days INTEGER, max_days INTEGER, deleted_at TEXT,
          CHECK(min_days IS NULL OR min_days >= 0), CHECK(max_days IS NULL OR max_days >= 0),
          CHECK(min_days IS NULL OR max_days IS NULL OR min_days <= max_days)
        );
        INSERT INTO staff_new(id,name,role,role_id,employment_type,min_days,max_days,deleted_at)
          SELECT id,name,role,role_id,employment_type,min_days,max_days,deleted_at FROM staff;
        CREATE TABLE shifts_new (
          target_date TEXT NOT NULL,
          staff_id INTEGER NOT NULL REFERENCES staff_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          shift_type_id INTEGER REFERENCES shift_types_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          is_request_holiday INTEGER NOT NULL DEFAULT 0 CHECK(is_request_holiday IN (0,1)),
          PRIMARY KEY(target_date, staff_id),
          CHECK(NOT (is_request_holiday = 1 AND shift_type_id IS NOT NULL))
        );
        INSERT INTO shifts_new SELECT target_date,staff_id,shift_type_id,is_request_holiday FROM shifts;
        CREATE TABLE daily_requirements_new (
          target_date TEXT NOT NULL,
          shift_type_id INTEGER NOT NULL REFERENCES shift_types_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          required_count INTEGER NOT NULL DEFAULT 0 CHECK(required_count >= 0),
          PRIMARY KEY(target_date, shift_type_id)
        );
        INSERT INTO daily_requirements_new SELECT target_date,shift_type_id,required_count FROM daily_requirements;
        CREATE TABLE ng_pairs_new (
          staff_id_1 INTEGER NOT NULL REFERENCES staff_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          staff_id_2 INTEGER NOT NULL REFERENCES staff_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          PRIMARY KEY(staff_id_1, staff_id_2), CHECK(staff_id_1 < staff_id_2)
        );
        INSERT INTO ng_pairs_new SELECT staff_id_1,staff_id_2 FROM ng_pairs;
        CREATE TABLE shift_sequence_rules_new (
          first_shift_type_id INTEGER NOT NULL REFERENCES shift_types_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          second_shift_type_id INTEGER NOT NULL REFERENCES shift_types_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          PRIMARY KEY(first_shift_type_id, second_shift_type_id)
        );
        INSERT INTO shift_sequence_rules_new SELECT first_shift_type_id,second_shift_type_id FROM shift_sequence_rules;
        CREATE TABLE staff_unavailable_conditions_new (
          staff_id INTEGER NOT NULL REFERENCES staff_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          condition_type TEXT NOT NULL CHECK(condition_type IN ('WEEKDAY','SHIFT_TYPE')),
          value INTEGER NOT NULL, PRIMARY KEY(staff_id, condition_type, value),
          CHECK((condition_type = 'WEEKDAY' AND value BETWEEN 0 AND 6) OR condition_type = 'SHIFT_TYPE')
        );
        INSERT INTO staff_unavailable_conditions_new SELECT staff_id,condition_type,value FROM staff_unavailable_conditions;
        CREATE TABLE role_requirements_new (
          target_date TEXT NOT NULL,
          shift_type_id INTEGER NOT NULL REFERENCES shift_types_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          role_id INTEGER NOT NULL REFERENCES roles_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          required_count INTEGER NOT NULL DEFAULT 0 CHECK(required_count >= 0),
          PRIMARY KEY(target_date, shift_type_id, role_id)
        );
        INSERT INTO role_requirements_new SELECT target_date,shift_type_id,role_id,required_count FROM role_requirements;
      `);
      const violations = this.db.pragma("foreign_key_check") as { table: string; rowid: number }[];
      if (violations.length)
        throw new Error("既存データに参照不整合があるため、安全に更新できません");
      this.db.exec(`
        DROP TABLE role_requirements; DROP TABLE staff_unavailable_conditions;
        DROP TABLE shift_sequence_rules; DROP TABLE ng_pairs; DROP TABLE daily_requirements;
        DROP TABLE shifts; DROP TABLE staff; DROP TABLE shift_types; DROP TABLE roles;
        ALTER TABLE roles_new RENAME TO roles;
        ALTER TABLE shift_types_new RENAME TO shift_types;
        ALTER TABLE staff_new RENAME TO staff;
        ALTER TABLE shifts_new RENAME TO shifts;
        ALTER TABLE daily_requirements_new RENAME TO daily_requirements;
        ALTER TABLE ng_pairs_new RENAME TO ng_pairs;
        ALTER TABLE shift_sequence_rules_new RENAME TO shift_sequence_rules;
        ALTER TABLE staff_unavailable_conditions_new RENAME TO staff_unavailable_conditions;
        ALTER TABLE role_requirements_new RENAME TO role_requirements;
      `);
      this.setSchemaVersion(LATEST_SCHEMA_VERSION);
    });
    tx();
  }
  private seed() {
    if (
      (
        this.db.prepare("SELECT count(*) AS n FROM shift_types").get() as {
          n: number;
        }
      ).n
    )
      return;
    const add = this.db.prepare(
      "INSERT INTO shift_types (name,short_name,color_code,start_time,end_time,counts_as_work) VALUES (?,?,?,?,?,?)",
    );
    [
      ["日勤", "日", "#ffffff", "08:30", "17:30", 1],
      ["早番", "早", "#fde2e4", "07:00", "16:00", 1],
      ["遅番", "遅", "#fff1cc", "10:00", "19:00", 1],
      ["夜勤入り", "入", "#dbeafe", "16:30", "09:30", 1],
      ["夜勤明け", "明", "#e0f2fe", null, null, 0],
      ["休み", "休", "#e5e7eb", null, null, 0],
      ["有給", "有", "#dcfce7", null, null, 0],
    ].forEach((x) => add.run(...(x as [string, string, string, string | null, string | null, number])));
  }
  bootstrap(): Boot {
    return {
      staff: this.staff(),
      shiftTypes: this.shiftTypes(),
      months: this.months(),
      settings: this.settings(),
      ngPairs: this.ngPairs(),
      sequenceRules: this.sequenceRules(),
      roles: this.roles(),
      unavailableConditions: this.unavailableConditions(),
    };
  }
  staff(): Staff[] {
    return this.db
      .prepare(`${STAFF_SELECT} WHERE s.deleted_at IS NULL ORDER BY s.id`)
      .all() as Staff[];
  }
  staffIncludingDeleted(): Staff[] {
    return this.db.prepare(`${STAFF_SELECT} ORDER BY s.id`).all() as Staff[];
  }
  setStaffDeleted(id: number, deleted: boolean) {
    this.db
      .prepare("UPDATE staff SET deleted_at=? WHERE id=?")
      .run(deleted ? new Date().toISOString() : null, id);
    return this.staffIncludingDeleted();
  }
  staffUsage(id: number) {
    return {
      shifts: (this.db.prepare("SELECT count(*) AS n FROM shifts WHERE staff_id=?").get(id) as { n: number }).n,
      ngPairs: (this.db.prepare("SELECT count(*) AS n FROM ng_pairs WHERE staff_id_1=? OR staff_id_2=?").get(id, id) as { n: number }).n,
      unavailableConditions: (this.db.prepare("SELECT count(*) AS n FROM staff_unavailable_conditions WHERE staff_id=?").get(id) as { n: number }).n,
    };
  }
  roles(includeDeleted = false): Role[] {
    return this.db
      .prepare(
        `SELECT id,name,display_order AS displayOrder,deleted_at AS deletedAt FROM roles ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY display_order,id`,
      )
      .all() as Role[];
  }
  roleUsageCount(id: number): number {
    return (
      this.db
        .prepare(
          "SELECT count(*) AS n FROM staff WHERE role_id=? AND deleted_at IS NULL",
        )
        .get(id) as { n: number }
    ).n;
  }
  roleRequirementUsageCount(id: number): number {
    return (
      this.db
        .prepare("SELECT count(*) AS n FROM role_requirements WHERE role_id=?")
        .get(id) as { n: number }
    ).n;
  }
  saveRole(payload: { id?: number; name: string; displayOrder?: number }) {
    const name = payload.name.trim();
    if (!name) throw new Error("職種名を入力してください");
    if (payload.id)
      this.db
        .prepare(
          "UPDATE roles SET name=?,display_order=COALESCE(?,display_order),deleted_at=NULL WHERE id=?",
        )
        .run(name, payload.displayOrder ?? null, payload.id);
    else
      this.db
        .prepare("INSERT INTO roles(name,display_order) VALUES(?,?)")
        .run(name, payload.displayOrder ?? 0);
    return this.roles(true);
  }
  setRoleDeleted(id: number, deleted: boolean) {
    this.db
      .prepare("UPDATE roles SET deleted_at=? WHERE id=?")
      .run(deleted ? new Date().toISOString() : null, id);
    return this.roles(true);
  }
  shiftTypes(): ShiftType[] {
    return this.db
      .prepare(
        "SELECT id,name,short_name AS shortName,color_code AS colorCode,start_time AS startTime,end_time AS endTime,counts_as_work AS countsAsWork,deleted_at AS deletedAt FROM shift_types WHERE deleted_at IS NULL ORDER BY id",
      )
      .all() as ShiftType[];
  }
  shiftTypesIncludingDeleted(): ShiftType[] {
    return this.db
      .prepare(
        "SELECT id,name,short_name AS shortName,color_code AS colorCode,start_time AS startTime,end_time AS endTime,counts_as_work AS countsAsWork,deleted_at AS deletedAt FROM shift_types ORDER BY id",
      )
      .all() as ShiftType[];
  }
  shiftTypesForMonth(month: string): ShiftType[] {
    return this.db
      .prepare(
        `SELECT id,name,short_name AS shortName,color_code AS colorCode,start_time AS startTime,end_time AS endTime,counts_as_work AS countsAsWork,deleted_at AS deletedAt
         FROM shift_types
         WHERE deleted_at IS NULL
           OR id IN (
             SELECT DISTINCT shift_type_id FROM shifts
             WHERE target_date LIKE ? AND shift_type_id IS NOT NULL
           )
         ORDER BY id`,
      )
      .all(`${month}%`) as ShiftType[];
  }
  shiftTypeUsage(id: number) {
    const shifts = (
      this.db.prepare("SELECT count(*) AS n FROM shifts WHERE shift_type_id=?").get(id) as {
        n: number;
      }
    ).n;
    const requirements = (
      this.db
        .prepare("SELECT count(*) AS n FROM role_requirements WHERE shift_type_id=?")
        .get(id) as { n: number }
    ).n;
    const sequenceRules = (
      this.db
        .prepare(
          "SELECT count(*) AS n FROM shift_sequence_rules WHERE first_shift_type_id=? OR second_shift_type_id=?",
        )
        .get(id, id) as { n: number }
    ).n;
    return { shifts, requirements, sequenceRules };
  }
  setShiftTypeDeleted(id: number, deleted: boolean) {
    this.db
      .prepare("UPDATE shift_types SET deleted_at=? WHERE id=?")
      .run(deleted ? new Date().toISOString() : null, id);
    return this.shiftTypesIncludingDeleted();
  }
  settings() {
    const rows = this.db
      .prepare("SELECT key,value FROM app_settings")
      .all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  }
  months() {
    return this.db
      .prepare(
        "SELECT substr(target_date,1,7) AS month FROM shifts GROUP BY month ORDER BY month DESC",
      )
      .all() as { month: string }[];
  }
  saveSettings(payload: { staff?: Staff[]; shiftTypes?: ShiftType[] }) {
    const tx = this.db.transaction(() => {
      if (payload.staff) {
        const add = this.db.prepare(
          "INSERT INTO staff(name,role_id,employment_type,min_days,max_days) VALUES(?,?,?,?,?)",
        );
        const edit = this.db.prepare(
          "UPDATE staff SET name=?,role_id=?,employment_type=?,min_days=?,max_days=? WHERE id=?",
        );
        payload.staff
          .filter((s) => s.name.trim())
          .forEach((s) =>
            s.id > 0
              ? edit.run(
                  s.name,
                  s.roleId,
                  s.employmentType,
                  s.minDays,
                  s.maxDays,
                  s.id,
                )
              : add.run(
                  s.name,
                  s.roleId,
                  s.employmentType,
                  s.minDays,
                  s.maxDays,
                ),
          );
      }
      if (payload.shiftTypes) {
        const add = this.db.prepare(
          "INSERT INTO shift_types(name,short_name,color_code,start_time,end_time,counts_as_work) VALUES(?,?,?,?,?,?)",
        );
        const edit = this.db.prepare(
          "UPDATE shift_types SET name=?,short_name=?,color_code=?,start_time=?,end_time=?,counts_as_work=? WHERE id=?",
        );
        payload.shiftTypes
          .filter((s) => s.name.trim() && s.shortName.trim())
          .forEach((s) =>
            s.id
              ? edit.run(s.name, s.shortName, s.colorCode, s.startTime, s.endTime, s.countsAsWork, s.id)
              : add.run(s.name, s.shortName, s.colorCode, s.startTime, s.endTime, s.countsAsWork),
          );
      }
    });
    tx();
    return this.bootstrap();
  }
  saveConfiguration(payload: {
    staff: Staff[];
    shiftTypes: ShiftType[];
    ngPairs: NgPair[];
    sequenceRules: SequenceRule[];
    unavailableConditions: UnavailableCondition[];
  }) {
    const tx = this.db.transaction(() => {
      const addStaff = this.db.prepare(
        "INSERT INTO staff(name,role_id,employment_type,min_days,max_days) VALUES(?,?,?,?,?)",
      );
      const editStaff = this.db.prepare(
        "UPDATE staff SET name=?,role_id=?,employment_type=?,min_days=?,max_days=? WHERE id=?",
      );
      const staffIds = new Map<number, number>();
      payload.staff
        .filter((staff) => staff.name.trim())
        .forEach((staff) => {
          if (staff.minDays != null && staff.maxDays != null && staff.minDays > staff.maxDays)
            throw new Error("月間勤務日数の下限は上限以下にしてください");
          if (staff.id > 0) {
            editStaff.run(
                staff.name,
                staff.roleId,
                staff.employmentType,
                staff.minDays,
                staff.maxDays,
                staff.id,
              );
          } else {
            const result = addStaff.run(
                staff.name,
                staff.roleId,
                staff.employmentType,
                staff.minDays,
                staff.maxDays,
              );
            staffIds.set(staff.id, Number(result.lastInsertRowid));
          }
        });
      const addShiftType = this.db.prepare(
        "INSERT INTO shift_types(name,short_name,color_code,start_time,end_time,counts_as_work) VALUES(?,?,?,?,?,?)",
      );
      const editShiftType = this.db.prepare(
        "UPDATE shift_types SET name=?,short_name=?,color_code=?,start_time=?,end_time=?,counts_as_work=? WHERE id=?",
      );
      const shiftTypeIds = new Map<number, number>();
      payload.shiftTypes
        .filter((type) => type.name.trim() && type.shortName.trim())
        .forEach((type) => {
          if (Boolean(type.startTime) !== Boolean(type.endTime))
            throw new Error("勤務種別の開始時刻と終了時刻は両方入力してください");
          if (type.id > 0) {
            editShiftType.run(type.name, type.shortName, type.colorCode, type.startTime, type.endTime, type.countsAsWork, type.id);
          } else {
            const result = addShiftType.run(type.name, type.shortName, type.colorCode, type.startTime, type.endTime, type.countsAsWork);
            shiftTypeIds.set(type.id, Number(result.lastInsertRowid));
          }
        });

      const activeStaff = this.db.prepare("SELECT 1 FROM staff WHERE id=? AND deleted_at IS NULL");
      const activeShiftType = this.db.prepare(
        "SELECT 1 FROM shift_types WHERE id=? AND deleted_at IS NULL",
      );
      const persistedStaffId = (id: number) => staffIds.get(id) ?? id;
      const persistedShiftTypeId = (id: number) => shiftTypeIds.get(id) ?? id;
      const assertStaff = (id: number) => {
        if (!activeStaff.get(id)) throw new Error("職員が見つからないか、削除済みです");
      };
      const assertShiftType = (id: number) => {
        if (!activeShiftType.get(id)) throw new Error("勤務種別が見つからないか、削除済みです");
      };

      this.db.exec("DELETE FROM ng_pairs; DELETE FROM shift_sequence_rules; DELETE FROM staff_unavailable_conditions;");
      const pair = this.db.prepare(
        "INSERT INTO ng_pairs(staff_id_1,staff_id_2) VALUES(?,?)",
      );
      payload.ngPairs.forEach((item) => {
        const first = persistedStaffId(item.staffId1);
        const second = persistedStaffId(item.staffId2);
        assertStaff(first);
        assertStaff(second);
        pair.run(Math.min(first, second), Math.max(first, second));
      });
      const sequence = this.db.prepare(
        "INSERT INTO shift_sequence_rules(first_shift_type_id,second_shift_type_id) VALUES(?,?)",
      );
      payload.sequenceRules.forEach((item) => {
        const first = persistedShiftTypeId(item.firstShiftTypeId);
        const second = persistedShiftTypeId(item.secondShiftTypeId);
        assertShiftType(first);
        assertShiftType(second);
        sequence.run(first, second);
      });
      const unavailable = this.db.prepare(
        "INSERT INTO staff_unavailable_conditions(staff_id,condition_type,value) VALUES(?,?,?)",
      );
      payload.unavailableConditions.forEach((item) => {
        const staffId = persistedStaffId(item.staffId);
        const value = item.conditionType === "SHIFT_TYPE" ? persistedShiftTypeId(item.value) : item.value;
        assertStaff(staffId);
        if (item.conditionType === "WEEKDAY" && (item.value < 0 || item.value > 6))
          throw new Error("勤務不可曜日は0（日）から6（土）で指定してください");
        if (item.conditionType === "SHIFT_TYPE") assertShiftType(value);
        unavailable.run(staffId, item.conditionType, value);
      });
    });
    tx();
    return this.bootstrap();
  }
  ngPairs(): NgPair[] {
    return this.db
      .prepare(
        "SELECT staff_id_1 AS staffId1, staff_id_2 AS staffId2 FROM ng_pairs",
      )
      .all() as NgPair[];
  }
  sequenceRules(): SequenceRule[] {
    return this.db
      .prepare(
        "SELECT first_shift_type_id AS firstShiftTypeId, second_shift_type_id AS secondShiftTypeId FROM shift_sequence_rules",
      )
      .all() as SequenceRule[];
  }
  unavailableConditions(): UnavailableCondition[] {
    return this.db
      .prepare(
        "SELECT staff_id AS staffId, condition_type AS conditionType, value FROM staff_unavailable_conditions",
      )
      .all() as UnavailableCondition[];
  }
  saveUnavailableConditions(conditions: UnavailableCondition[]) {
    const tx = this.db.transaction(() => {
      this.db.exec("DELETE FROM staff_unavailable_conditions;");
      const q = this.db.prepare(
        "INSERT OR IGNORE INTO staff_unavailable_conditions(staff_id,condition_type,value) VALUES(?,?,?)",
      );
      conditions.forEach((c) => q.run(c.staffId, c.conditionType, c.value));
    });
    tx();
    return this.unavailableConditions();
  }
  saveRules(payload: {
    ngPairs: NgPair[];
    sequenceRules: SequenceRule[];
    maxConsecutiveDays?: number;
  }) {
    const tx = this.db.transaction(() => {
      this.db.exec("DELETE FROM ng_pairs; DELETE FROM shift_sequence_rules;");
      const np = this.db.prepare(
        "INSERT OR IGNORE INTO ng_pairs(staff_id_1,staff_id_2) VALUES(?,?)",
      );
      payload.ngPairs
        .filter((p) => p.staffId1 !== p.staffId2)
        .forEach((p) =>
          np.run(
            Math.min(p.staffId1, p.staffId2),
            Math.max(p.staffId1, p.staffId2),
          ),
        );
      const sr = this.db.prepare(
        "INSERT OR IGNORE INTO shift_sequence_rules(first_shift_type_id,second_shift_type_id) VALUES(?,?)",
      );
      payload.sequenceRules.forEach((r) =>
        sr.run(r.firstShiftTypeId, r.secondShiftTypeId),
      );
      if (payload.maxConsecutiveDays)
        this.db
          .prepare(
            "INSERT INTO app_settings(key,value) VALUES('maxConsecutiveDays',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(JSON.stringify(payload.maxConsecutiveDays));
    });
    tx();
    return this.bootstrap();
  }
  createMonth(month: string) {
    const [y, m] = month.split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    const staff = this.staff();
    const q = this.db.prepare(
      "INSERT OR IGNORE INTO shifts(target_date,staff_id) VALUES (?,?)",
    );
    const tx = this.db.transaction(() => {
      for (let d = 1; d <= days; d++)
        for (const s of staff)
          q.run(`${month}-${String(d).padStart(2, "0")}`, s.id);
    });
    tx();
    return this.getMonth(month);
  }
  getMonth(month: string): MonthData {
    return {
      ...this.bootstrap(),
      // 削除済みでも当月のセルが参照する勤務種別は、履歴表示・Excel出力用に返す。
      // 編集UI側は deletedAt を見て新規割当候補から除外する。
      shiftTypes: this.shiftTypesForMonth(month),
      cells: this.db
        .prepare(
          "SELECT target_date AS targetDate,staff_id AS staffId,shift_type_id AS shiftTypeId,is_request_holiday AS isRequestHoliday FROM shifts WHERE target_date LIKE ?",
        )
        .all(`${month}%`) as Cell[],
      roleRequirements: this.db
        .prepare(
          "SELECT target_date AS targetDate,shift_type_id AS shiftTypeId,role_id AS roleId,required_count AS requiredCount FROM role_requirements WHERE target_date LIKE ?",
        )
        .all(`${month}%`) as RoleRequirement[],
    };
  }
  updateCells(payload: {
    changes: {
      targetDate: string;
      staffId: number;
      shiftTypeId: number | null;
      isRequestHoliday?: number;
    }[];
  }) {
    const q = this.db.prepare(
      "UPDATE shifts SET shift_type_id=?,is_request_holiday=COALESCE(?,is_request_holiday) WHERE target_date=? AND staff_id=?",
    );
    const activeShiftType = this.db.prepare(
      "SELECT 1 FROM shift_types WHERE id=? AND deleted_at IS NULL",
    );
    const tx = this.db.transaction(() => {
      payload.changes.forEach((c) => {
        if (c.shiftTypeId != null && !activeShiftType.get(c.shiftTypeId))
          throw new Error("勤務種別が見つからないか、削除済みです");
        if (c.isRequestHoliday && c.shiftTypeId != null)
          throw new Error("希望休と勤務の同時設定はできません");
        if (
          q.run(c.shiftTypeId, c.isRequestHoliday ?? null, c.targetDate, c.staffId)
            .changes !== 1
        )
          throw new Error("対象の勤務セルが見つかりません");
      });
    });
    tx();
    return { status: "success" };
  }
  saveRoleRequirements(payload: { roleRequirements: RoleRequirement[] }) {
    const tx = this.db.transaction(() => {
      const q = this.db.prepare(
        "INSERT INTO role_requirements(target_date,shift_type_id,role_id,required_count) VALUES(?,?,?,?) ON CONFLICT(target_date,shift_type_id,role_id) DO UPDATE SET required_count=excluded.required_count",
      );
      payload.roleRequirements.forEach((r) =>
        q.run(r.targetDate, r.shiftTypeId, r.roleId, r.requiredCount),
      );
    });
    tx();
    return { status: "success" };
  }
  saveConditions(payload: {
    roleRequirements: RoleRequirement[];
    changes: {
      targetDate: string;
      staffId: number;
      shiftTypeId: number | null;
      isRequestHoliday?: number;
    }[];
  }) {
    const tx = this.db.transaction(() => {
      const activeRole = this.db.prepare("SELECT 1 FROM roles WHERE id=? AND deleted_at IS NULL");
      const activeShiftType = this.db.prepare(
        "SELECT 1 FROM shift_types WHERE id=? AND deleted_at IS NULL",
      );
      const requirement = this.db.prepare(
        "INSERT INTO role_requirements(target_date,shift_type_id,role_id,required_count) VALUES(?,?,?,?) ON CONFLICT(target_date,shift_type_id,role_id) DO UPDATE SET required_count=excluded.required_count",
      );
      const update = this.db.prepare(
        "UPDATE shifts SET shift_type_id=?,is_request_holiday=COALESCE(?,is_request_holiday) WHERE target_date=? AND staff_id=?",
      );
      for (const item of payload.roleRequirements) {
        if (!activeRole.get(item.roleId)) throw new Error("職種が見つからないか、削除済みです");
        if (!activeShiftType.get(item.shiftTypeId))
          throw new Error("勤務種別が見つからないか、削除済みです");
        requirement.run(item.targetDate, item.shiftTypeId, item.roleId, item.requiredCount);
      }
      for (const item of payload.changes) {
        if (item.shiftTypeId != null && !activeShiftType.get(item.shiftTypeId))
          throw new Error("勤務種別が見つからないか、削除済みです");
        if (item.isRequestHoliday && item.shiftTypeId != null)
          throw new Error("希望休と勤務の同時設定はできません");
        if (update.run(
          item.shiftTypeId,
          item.isRequestHoliday ?? null,
          item.targetDate,
          item.staffId,
        ).changes !== 1)
          throw new Error("対象の勤務セルが見つかりません");
      }
    });
    tx();
    return { status: "success" };
  }
  getGenerationInput(month: string): GenerationInput {
    const data = this.getMonth(month);
    return {
      month,
      staff: data.staff,
      // 削除済み勤務種別は履歴表示専用であり、自動生成の候補にしない。
      shiftTypes: this.shiftTypes(),
      cells: data.cells,
      roleRequirements: data.roleRequirements,
      ngPairs: data.ngPairs,
      sequenceRules: data.sequenceRules,
      unavailableConditions: data.unavailableConditions,
      maxConsecutiveDays: Number(data.settings.maxConsecutiveDays ?? 5),
      timeLimitMs: 180000,
    };
  }
  validateCells(month: string, cells: Cell[]) {
    const input = this.getGenerationInput(month);
    return validateCellsPure({
      staff: input.staff,
      shiftTypes: input.shiftTypes,
      cells,
      roleRequirements: input.roleRequirements,
      ngPairs: input.ngPairs,
      sequenceRules: input.sequenceRules,
      unavailableConditions: input.unavailableConditions,
      maxConsecutiveDays: input.maxConsecutiveDays,
    });
  }
  applyGeneratedCells(cells: Cell[]) {
    const q = this.db.prepare(
      "UPDATE shifts SET shift_type_id=? WHERE target_date=? AND staff_id=?",
    );
    const tx = this.db.transaction(() =>
      cells.forEach((c) => q.run(c.shiftTypeId, c.targetDate, c.staffId)),
    );
    tx();
    return { status: "success" };
  }
  backup(file: string) {
    return this.db.backup(file);
  }
  close() {
    this.db.close();
  }
  async restore(sourceFile: string): Promise<{ preRestoreBackup: string }> {
    const stat = fs.statSync(sourceFile);
    if (stat.size === 0) throw new Error("ファイルが空です");
    if (stat.size > MAX_RESTORE_BYTES)
      throw new Error("ファイルサイズが上限（500MB）を超えています");
    const check = new Database(sourceFile, { readonly: true });
    try {
      const integrity = check.pragma("integrity_check", { simple: true });
      if (integrity !== "ok")
        throw new Error("バックアップファイルの整合性チェックに失敗しました");
      const tables = (
        check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string;
        }[]
      ).map((r) => r.name);
      const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
      if (missing.length)
        throw new Error(
          `想定したデータ構造と一致しません（不足テーブル: ${missing.join(", ")}）`,
        );
    } finally {
      check.close();
    }
    const dir = path.dirname(this.file);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const preRestoreBackup = path.join(dir, `restore-前バックアップ_${stamp}.sqlite`);
    // 生ファイルコピーはWALモード時に直近コミットを取りこぼす恐れがあるため、
    // SQLite Backup APIでチェックポイント済みの一貫したスナップショットを作る。
    await this.db.backup(preRestoreBackup);
    this.db.close();
    // WALサイドカーが残っていると復元後のファイルと整合しない可能性があるため削除する。
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${this.file}${suffix}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
    fs.copyFileSync(sourceFile, this.file);
    this.db = new Database(this.file);
    this.migrate();
    return { preRestoreBackup };
  }
  getExportData(month: string) {
    return {
      month,
      staff: this.staff(),
      shiftTypes: this.shiftTypes(),
      cells: this.getMonth(month).cells as {
        targetDate: string;
        staffId: number;
        shiftTypeId: number | null;
      }[],
    };
  }
}
