import { z } from "zod";

const DateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形式が不正です");
const PositiveIdSchema = z.number().int().positive();
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻の形式が不正です");

export const StaffSchema = z.object({
  id: z.number().int(),
  name: z.string().max(100),
  roleId: PositiveIdSchema.nullable(),
  roleName: z.string().max(100),
  employmentType: z.string().max(100),
  minDays: z.number().int().nonnegative().nullable(),
  maxDays: z.number().int().nonnegative().nullable(),
  deletedAt: z.string().nullable().optional(),
});
export const ShiftTypeSchema = z.object({
  id: z.number().int(),
  name: z.string().max(100),
  shortName: z.string().max(20),
  colorCode: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  startTime: TimeSchema.nullable().optional(),
  endTime: TimeSchema.nullable().optional(),
  countsAsWork: z.union([z.literal(0), z.literal(1)]),
  deletedAt: z.string().nullable().optional(),
});
export const SaveSettingsSchema = z.object({
  staff: z.array(StaffSchema).optional(),
  shiftTypes: z.array(ShiftTypeSchema).optional(),
});
export const NgPairSchema = z.object({
  staffId1: PositiveIdSchema,
  staffId2: PositiveIdSchema,
}).refine((pair) => pair.staffId1 !== pair.staffId2, "同じ職員はNGペアにできません");
export const SequenceRuleSchema = z.object({
  firstShiftTypeId: PositiveIdSchema,
  secondShiftTypeId: PositiveIdSchema,
});
export const SaveRulesSchema = z.object({
  ngPairs: z.array(NgPairSchema),
  sequenceRules: z.array(SequenceRuleSchema),
  maxConsecutiveDays: z.number().optional(),
});
export const UnavailableConditionSchema = z.object({
  staffId: PositiveIdSchema,
  conditionType: z.enum(["WEEKDAY", "SHIFT_TYPE"]),
  value: z.number().int().nonnegative(),
});
export const SaveUnavailableConditionsSchema = z.array(UnavailableConditionSchema);
export const SaveConfigurationSchema = z.object({
  staff: z.array(StaffSchema),
  shiftTypes: z.array(ShiftTypeSchema),
  ngPairs: z.array(NgPairSchema),
  sequenceRules: z.array(SequenceRuleSchema),
  unavailableConditions: z.array(UnavailableConditionSchema),
});
export const RoleRequirementSchema = z.object({
  targetDate: DateKeySchema,
  shiftTypeId: PositiveIdSchema,
  roleId: PositiveIdSchema,
  requiredCount: z.number().int().min(0),
});
export const SaveRoleRequirementsSchema = z.object({
  roleRequirements: z.array(RoleRequirementSchema),
});
export const CellChangeSchema = z.object({
  targetDate: DateKeySchema,
  staffId: PositiveIdSchema,
  shiftTypeId: PositiveIdSchema.nullable(),
  isRequestHoliday: z.union([z.literal(0), z.literal(1)]).optional(),
});
export const UpdateCellsSchema = z.object({ changes: z.array(CellChangeSchema) });
export const SaveConditionsSchema = z.object({
  roleRequirements: z.array(RoleRequirementSchema),
  changes: z.array(CellChangeSchema),
});
export const CellSchema = z.object({
  targetDate: DateKeySchema,
  staffId: PositiveIdSchema,
  shiftTypeId: PositiveIdSchema.nullable(),
  isRequestHoliday: z.union([z.literal(0), z.literal(1)]),
});
export const ValidateCellsSchema = z.array(CellSchema);
export const SaveRoleSchema = z.object({
  id: PositiveIdSchema.optional(),
  name: z.string().trim().min(1).max(100),
  displayOrder: z.number().int().nonnegative().optional(),
});
export const MonthSchema = z.string().regex(/^\d{4}-\d{2}$/, "月の形式が不正です");
export const IdSchema = z.number().int();
