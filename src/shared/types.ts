// Node/Electron 非依存の純粋な型・共有ロジック。UI・Main・生成エンジンで共有する。

export type Id = number;

export type Role = {
  id: Id;
  name: string;
  displayOrder: number;
  deletedAt: string | null;
};

export type ShiftType = {
  id: Id;
  name: string;
  shortName: string;
  colorCode: string;
  startTime?: string | null;
  endTime?: string | null;
  countsAsWork: number;
  deletedAt?: string | null;
};

export type Staff = {
  id: Id;
  name: string;
  roleId: Id | null;
  roleName: string;
  employmentType: string;
  minDays: number | null;
  maxDays: number | null;
  deletedAt?: string | null;
};

/** shiftTypeId が未指定なら、勤務種別を問わず同日に勤務不可。 */
export type NgPair = { staffId1: Id; staffId2: Id; shiftTypeId?: Id | null };

export type SequenceRule = {
  firstShiftTypeId: Id;
  secondShiftTypeId: Id;
};

export type RoleRequirement = {
  targetDate: string;
  shiftTypeId: Id;
  roleId: Id;
  requiredCount: number;
};

/** 新しい月を作成するときだけ展開する、曜日別の必要人数既定値。 */
export type WeeklyRoleRequirement = {
  weekday: number;
  shiftTypeId: Id;
  roleId: Id;
  requiredCount: number;
};

export type UnavailableConditionType = "WEEKDAY" | "SHIFT_TYPE";

export type UnavailableCondition = {
  staffId: Id;
  conditionType: UnavailableConditionType;
  value: number;
};

export type MonthlyConstraints = {
  ngPairs: NgPair[];
  sequenceRules: SequenceRule[];
  unavailableConditions: UnavailableCondition[];
};

export type ViolationType =
  | "UNASSIGNED"
  | "NG_PAIR"
  | "SEQUENCE"
  | "MAX_CONSECUTIVE"
  | "UNAVAILABLE"
  | "MIN_DAYS";

export type Violation = {
  type: ViolationType;
  targetDate: string;
  staffId?: Id;
  shiftTypeId?: Id;
  roleId?: Id;
  message: string;
};

export type Cell = {
  targetDate: string;
  staffId: Id;
  shiftTypeId: Id | null;
  isRequestHoliday: number;
};

export type Boot = {
  staff: Staff[];
  shiftTypes: ShiftType[];
  months: { month: string }[];
  settings: Record<string, unknown>;
  ngPairs: NgPair[];
  sequenceRules: SequenceRule[];
  roles: Role[];
  unavailableConditions: UnavailableCondition[];
  weeklyRoleRequirements: WeeklyRoleRequirement[];
};

export type MonthData = Boot & {
  cells: Cell[];
  roleRequirements: RoleRequirement[];
  monthlyConstraints: MonthlyConstraints;
};

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export const toDateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export const dayOfWeek = (date: string) =>
  new Date(`${date}T00:00:00`).getDay();

export const weekdayLabel = (date: string) => WEEKDAY_LABELS[dayOfWeek(date)];

export type GenerationInput = {
  month: string;
  staff: Staff[];
  shiftTypes: ShiftType[];
  cells: Cell[];
  roleRequirements: RoleRequirement[];
  ngPairs: NgPair[];
  sequenceRules: SequenceRule[];
  unavailableConditions: UnavailableCondition[];
  maxConsecutiveDays: number;
  timeLimitMs: number;
};

export type GenerationProgress = {
  assigned: number;
  total: number;
  elapsedMs: number;
};

export type GenerationResult = {
  cells: Cell[];
  violations: Violation[];
  timedOut: boolean;
};

export const daysInMonth = (month: string): string[] => {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};
