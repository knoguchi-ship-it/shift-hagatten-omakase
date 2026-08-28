import { daysInMonth, type Cell, type GenerationInput, type Role, type ShiftType, type Staff } from "../types";

/**
 * 受入確認用の匿名・再現可能な50名×31日シナリオ。
 * 実DBや個人情報を使わず、後続のE2E/性能テストで同じ入力を使う。
 */
export const ACCEPTANCE_MONTH = "2026-10";

const roles: Role[] = [
  { id: 1, name: "介護職", displayOrder: 1, deletedAt: null },
  { id: 2, name: "看護職", displayOrder: 2, deletedAt: null },
  { id: 3, name: "支援職", displayOrder: 3, deletedAt: null },
];

const shiftTypes: ShiftType[] = [
  { id: 1, name: "早番", shortName: "早", colorCode: "#fde2e4", countsAsWork: 1 },
  { id: 2, name: "日勤", shortName: "日", colorCode: "#ffffff", countsAsWork: 1 },
  { id: 3, name: "遅番", shortName: "遅", colorCode: "#fff1cc", countsAsWork: 1 },
  { id: 4, name: "夜勤入り", shortName: "入", colorCode: "#dbeafe", countsAsWork: 1 },
  { id: 5, name: "夜勤明け", shortName: "明", colorCode: "#e0f2fe", countsAsWork: 0 },
  { id: 6, name: "休み", shortName: "休", colorCode: "#e5e7eb", countsAsWork: 0 },
];

function createStaff(roleId: number, roleName: string, count: number, startId: number): Staff[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    name: `${roleName}${String(index + 1).padStart(2, "0")}`,
    roleId,
    roleName,
    employmentType: "full",
    minDays: 15,
    maxDays: 22,
    deletedAt: null,
  }));
}

const staff = [
  ...createStaff(1, "介護職員", 30, 1),
  ...createStaff(2, "看護職員", 10, 31),
  ...createStaff(3, "支援職員", 10, 41),
];

export function createAcceptance50x31Input(): GenerationInput {
  const dates = daysInMonth(ACCEPTANCE_MONTH);
  const cells: Cell[] = dates.flatMap((targetDate, dateIndex) =>
    staff.map((member) => ({
      targetDate,
      staffId: member.id,
      shiftTypeId: null,
      isRequestHoliday: (member.id + dateIndex) % 11 === 0 ? 1 : 0,
    })),
  );

  return {
    month: ACCEPTANCE_MONTH,
    staff,
    shiftTypes,
    cells,
    roleRequirements: dates.flatMap((targetDate) => [
      { targetDate, shiftTypeId: 1, roleId: 1, requiredCount: 4 },
      { targetDate, shiftTypeId: 2, roleId: 1, requiredCount: 8 },
      { targetDate, shiftTypeId: 3, roleId: 1, requiredCount: 4 },
      { targetDate, shiftTypeId: 4, roleId: 1, requiredCount: 2 },
      { targetDate, shiftTypeId: 2, roleId: 2, requiredCount: 3 },
      { targetDate, shiftTypeId: 2, roleId: 3, requiredCount: 2 },
    ]),
    ngPairs: [
      { staffId1: 1, staffId2: 2 },
      { staffId1: 7, staffId2: 8 },
      { staffId1: 15, staffId2: 16 },
      { staffId1: 31, staffId2: 32 },
      { staffId1: 41, staffId2: 42 },
    ],
    sequenceRules: [{ firstShiftTypeId: 4, secondShiftTypeId: 5 }],
    unavailableConditions: [
      { staffId: 3, conditionType: "WEEKDAY", value: 0 },
      { staffId: 12, conditionType: "WEEKDAY", value: 6 },
      { staffId: 25, conditionType: "SHIFT_TYPE", value: 4 },
      { staffId: 34, conditionType: "WEEKDAY", value: 0 },
      { staffId: 47, conditionType: "SHIFT_TYPE", value: 1 },
    ],
    maxConsecutiveDays: 5,
    timeLimitMs: 180_000,
  };
}

export const acceptanceRoles = roles;
export const acceptanceShiftTypes = shiftTypes;
export const acceptanceStaff = staff;
