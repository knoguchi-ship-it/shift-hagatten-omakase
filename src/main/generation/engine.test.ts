import { describe, expect, it } from "vitest";
import type { Cell, GenerationInput, Staff, ShiftType } from "../../shared/types";
import { generate, validateCells } from "./engine";

const workType: ShiftType = {
  id: 1,
  name: "日勤",
  shortName: "日",
  colorCode: "#ffffff",
  countsAsWork: 1,
};
const holidayType: ShiftType = {
  id: 2,
  name: "休み",
  shortName: "休",
  colorCode: "#eeeeee",
  countsAsWork: 0,
};
const staffA: Staff = {
  id: 1,
  name: "Aさん",
  roleId: 10,
  roleName: "介護職",
  employmentType: "full",
  minDays: null,
  maxDays: null,
};
const staffB: Staff = {
  id: 2,
  name: "Bさん",
  roleId: 10,
  roleName: "介護職",
  employmentType: "full",
  minDays: null,
  maxDays: null,
};

function cell(staffId: number, targetDate: string): Cell {
  return { targetDate, staffId, shiftTypeId: null, isRequestHoliday: 0 };
}

describe("generate", () => {
  it("assigns staff to satisfy role-based requirements", () => {
    const input: GenerationInput = {
      month: "2026-08",
      staff: [staffA, staffB],
      shiftTypes: [workType, holidayType],
      cells: [cell(1, "2026-08-01"), cell(2, "2026-08-01")],
      roleRequirements: [
        { targetDate: "2026-08-01", shiftTypeId: workType.id, roleId: 10, requiredCount: 1 },
      ],
      ngPairs: [],
      sequenceRules: [],
      unavailableConditions: [],
      maxConsecutiveDays: 5,
      timeLimitMs: 5000,
    };
    const result = generate(input);
    expect(result.timedOut).toBe(false);
    expect(result.violations).toHaveLength(0);
    const assigned = result.cells.filter((c) => c.shiftTypeId === workType.id);
    expect(assigned).toHaveLength(1);
  });

  it("reports UNASSIGNED when required headcount exceeds available staff", () => {
    const input: GenerationInput = {
      month: "2026-08",
      staff: [staffA],
      shiftTypes: [workType, holidayType],
      cells: [cell(1, "2026-08-01")],
      roleRequirements: [
        { targetDate: "2026-08-01", shiftTypeId: workType.id, roleId: 10, requiredCount: 2 },
      ],
      ngPairs: [],
      sequenceRules: [],
      unavailableConditions: [],
      maxConsecutiveDays: 5,
      timeLimitMs: 5000,
    };
    const result = generate(input);
    expect(result.violations.some((v) => v.type === "UNASSIGNED")).toBe(true);
  });

  it("proactively fills a mandated next-day shift even when it does not count as work (夜勤入り→夜勤明け)", () => {
    const nightShift: ShiftType = {
      id: 3,
      name: "夜勤入り",
      shortName: "入",
      colorCode: "#dbeafe",
      countsAsWork: 1,
    };
    const nightOff: ShiftType = {
      id: 4,
      name: "夜勤明け",
      shortName: "明",
      colorCode: "#e0f2fe",
      countsAsWork: 0,
    };
    const input: GenerationInput = {
      month: "2026-08",
      staff: [staffA],
      shiftTypes: [nightShift, nightOff, holidayType],
      cells: [cell(1, "2026-08-01"), cell(1, "2026-08-02")],
      roleRequirements: [
        { targetDate: "2026-08-01", shiftTypeId: nightShift.id, roleId: 10, requiredCount: 1 },
      ],
      ngPairs: [],
      sequenceRules: [{ firstShiftTypeId: nightShift.id, secondShiftTypeId: nightOff.id }],
      unavailableConditions: [],
      maxConsecutiveDays: 5,
      timeLimitMs: 5000,
    };
    const result = generate(input);
    expect(result.cells.find((c) => c.targetDate === "2026-08-01")?.shiftTypeId).toBe(
      nightShift.id,
    );
    expect(result.cells.find((c) => c.targetDate === "2026-08-02")?.shiftTypeId).toBe(
      nightOff.id,
    );
    expect(result.violations.some((v) => v.type === "SEQUENCE")).toBe(false);
  });

  it("does not assign staff on their requested holiday", () => {
    const requestedHoliday = { ...cell(1, "2026-08-01"), isRequestHoliday: 1 };
    const input: GenerationInput = {
      month: "2026-08",
      staff: [staffA],
      shiftTypes: [workType, holidayType],
      cells: [requestedHoliday],
      roleRequirements: [
        { targetDate: "2026-08-01", shiftTypeId: workType.id, roleId: 10, requiredCount: 1 },
      ],
      ngPairs: [],
      sequenceRules: [],
      unavailableConditions: [],
      maxConsecutiveDays: 5,
      timeLimitMs: 5000,
    };
    const result = generate(input);
    expect(result.cells[0].shiftTypeId).toBe(holidayType.id);
    expect(result.violations.some((v) => v.type === "UNASSIGNED")).toBe(true);
  });

  it("returns the current proposal immediately when cancellation is requested", () => {
    const input: GenerationInput = {
      month: "2026-08",
      staff: [staffA],
      shiftTypes: [workType, holidayType],
      cells: [cell(1, "2026-08-01")],
      roleRequirements: [
        { targetDate: "2026-08-01", shiftTypeId: workType.id, roleId: 10, requiredCount: 1 },
      ],
      ngPairs: [],
      sequenceRules: [],
      unavailableConditions: [],
      maxConsecutiveDays: 5,
      timeLimitMs: 5000,
    };
    const result = generate(input, undefined, () => true);
    expect(result.timedOut).toBe(true);
    expect(result.cells[0].shiftTypeId).toBeNull();
  });
});

describe("validateCells", () => {
  const baseArgs = {
    staff: [staffA, staffB],
    shiftTypes: [workType, holidayType],
    roleRequirements: [],
    unavailableConditions: [],
    maxConsecutiveDays: 2,
  };

  it("detects NG pairs assigned to the same day", () => {
    const cells: Cell[] = [
      { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
      { targetDate: "2026-08-01", staffId: 2, shiftTypeId: workType.id, isRequestHoliday: 0 },
    ];
    const violations = validateCells({
      ...baseArgs,
      cells,
      ngPairs: [{ staffId1: 1, staffId2: 2 }],
      sequenceRules: [],
    });
    expect(violations.some((v) => v.type === "NG_PAIR")).toBe(true);
  });

  it("detects a run longer than the max consecutive days", () => {
    const cells: Cell[] = ["2026-08-01", "2026-08-02", "2026-08-03"].map((d) => ({
      targetDate: d,
      staffId: 1,
      shiftTypeId: workType.id,
      isRequestHoliday: 0,
    }));
    const violations = validateCells({
      ...baseArgs,
      cells,
      ngPairs: [],
      sequenceRules: [],
    });
    expect(violations.some((v) => v.type === "MAX_CONSECUTIVE")).toBe(true);
  });

  it("detects staff who fall short of their minimum monthly work days", () => {
    const shortStaff: Staff = { ...staffA, minDays: 20 };
    const cells: Cell[] = [
      { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
    ];
    const violations = validateCells({
      ...baseArgs,
      staff: [shortStaff],
      cells,
      ngPairs: [],
      sequenceRules: [],
    });
    expect(violations.some((v) => v.type === "MIN_DAYS")).toBe(true);
  });

  it("does not flag MIN_DAYS when minDays is unset or satisfied", () => {
    const satisfiedStaff: Staff = { ...staffA, minDays: 1 };
    const cells: Cell[] = [
      { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
    ];
    const violations = validateCells({
      ...baseArgs,
      staff: [satisfiedStaff],
      cells,
      ngPairs: [],
      sequenceRules: [],
    });
    expect(violations.some((v) => v.type === "MIN_DAYS")).toBe(false);
  });

  it("detects a broken next-day sequence rule", () => {
    const cells: Cell[] = [
      { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
      { targetDate: "2026-08-02", staffId: 1, shiftTypeId: null, isRequestHoliday: 0 },
    ];
    const violations = validateCells({
      ...baseArgs,
      cells,
      ngPairs: [],
      sequenceRules: [{ firstShiftTypeId: workType.id, secondShiftTypeId: holidayType.id }],
    });
    expect(violations.some((v) => v.type === "SEQUENCE")).toBe(true);
  });

  it("detects assignment to an unavailable weekday", () => {
    // 2026-08-01 is a Saturday (weekday 6)
    const cells: Cell[] = [
      { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
    ];
    const violations = validateCells({
      ...baseArgs,
      cells,
      ngPairs: [],
      sequenceRules: [],
      unavailableConditions: [{ staffId: 1, conditionType: "WEEKDAY", value: 6 }],
    });
    expect(violations.some((v) => v.type === "UNAVAILABLE")).toBe(true);
  });

  it("applies a scoped NG pair only when both staff have the selected shift type", () => {
    const secondWorkType: ShiftType = { ...workType, id: 3, name: "遅番", shortName: "遅" };
    const sameType = validateCells({
      ...baseArgs,
      shiftTypes: [workType, secondWorkType, holidayType],
      cells: [
        { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
        { targetDate: "2026-08-01", staffId: 2, shiftTypeId: workType.id, isRequestHoliday: 0 },
      ],
      ngPairs: [{ staffId1: 1, staffId2: 2, shiftTypeId: workType.id }],
      sequenceRules: [],
    });
    const differentType = validateCells({
      ...baseArgs,
      shiftTypes: [workType, secondWorkType, holidayType],
      cells: [
        { targetDate: "2026-08-01", staffId: 1, shiftTypeId: workType.id, isRequestHoliday: 0 },
        { targetDate: "2026-08-01", staffId: 2, shiftTypeId: secondWorkType.id, isRequestHoliday: 0 },
      ],
      ngPairs: [{ staffId1: 1, staffId2: 2, shiftTypeId: workType.id }],
      sequenceRules: [],
    });
    expect(sameType.some((violation) => violation.type === "NG_PAIR")).toBe(true);
    expect(differentType.some((violation) => violation.type === "NG_PAIR")).toBe(false);
  });
});
