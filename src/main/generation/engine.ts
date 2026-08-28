import type {
  Cell,
  GenerationInput,
  GenerationResult,
  NgPair,
  RoleRequirement,
  SequenceRule,
  ShiftType,
  Staff,
  UnavailableCondition,
  Violation,
} from "../../shared/types";

type ValidationInput = {
  staff: Staff[];
  shiftTypes: ShiftType[];
  cells: Cell[];
  roleRequirements: RoleRequirement[];
  ngPairs: NgPair[];
  sequenceRules: SequenceRule[];
  unavailableConditions: UnavailableCondition[];
  maxConsecutiveDays: number;
};

function buildUnavailableIndex(unavailableConditions: UnavailableCondition[]) {
  const unavailableWeekday = new Map<number, Set<number>>();
  const unavailableShiftType = new Map<number, Set<number>>();
  for (const u of unavailableConditions) {
    const target =
      u.conditionType === "WEEKDAY" ? unavailableWeekday : unavailableShiftType;
    if (!target.has(u.staffId)) target.set(u.staffId, new Set());
    target.get(u.staffId)!.add(u.value);
  }
  return {
    isUnavailable: (staffId: number, date: string, shiftTypeId: number) =>
      (unavailableWeekday.get(staffId)?.has(new Date(`${date}T00:00:00`).getDay()) ??
        false) ||
      (unavailableShiftType.get(staffId)?.has(shiftTypeId) ?? false),
  };
}

// DB/Electron 非依存の純粋な制約検証。生成後のチェックと、セル編集後の再検証の両方から呼ぶ。
export function validateCells(
  input: ValidationInput,
  options?: { timedOut?: boolean },
): Violation[] {
  const {
    staff,
    shiftTypes,
    cells,
    roleRequirements,
    ngPairs,
    sequenceRules,
    unavailableConditions,
    maxConsecutiveDays,
  } = input;
  const violations: Violation[] = [];
  const byTypeId = new Map(shiftTypes.map((t) => [t.id, t]));
  const byKey = new Map(cells.map((c) => [`${c.staffId}/${c.targetDate}`, c]));
  const dates = [...new Set(cells.map((c) => c.targetDate))].sort();
  const workTypes = shiftTypes.filter((t) => t.countsAsWork);
  const roleIds = [...new Set(roleRequirements.map((r) => r.roleId))];
  const req = new Map(
    roleRequirements.map((r) => [
      `${r.targetDate}/${r.shiftTypeId}/${r.roleId}`,
      r.requiredCount,
    ]),
  );
  const np = new Set(
    ngPairs.flatMap((p) => [
      `${p.staffId1}/${p.staffId2}`,
      `${p.staffId2}/${p.staffId1}`,
    ]),
  );
  const { isUnavailable } = buildUnavailableIndex(unavailableConditions);

  for (const date of dates) {
    for (const type of workTypes) {
      for (const roleId of roleIds) {
        const needed = req.get(`${date}/${type.id}/${roleId}`) ?? 0;
        if (!needed) continue;
        const filled = staff.filter(
          (s) =>
            s.roleId === roleId &&
            byKey.get(`${s.id}/${date}`)?.shiftTypeId === type.id,
        ).length;
        if (filled < needed)
          violations.push({
            type: "UNASSIGNED",
            targetDate: date,
            shiftTypeId: type.id,
            roleId,
            message: `${type.name}（職種要件）の必要人数を満たせません${options?.timedOut ? "（時間切れ）" : ""}`,
          });
      }
    }
  }

  const maxConsecutive = maxConsecutiveDays || 5;
  for (const person of staff) {
    let run = 0;
    let totalWorkDays = 0;
    for (let di = 0; di < dates.length; di++) {
      const date = dates[di];
      const current = byKey.get(`${person.id}/${date}`);
      if (!current) continue;
      const currentType =
        current.shiftTypeId == null ? undefined : byTypeId.get(current.shiftTypeId);
      if (currentType?.countsAsWork) totalWorkDays += 1;
      run = currentType?.countsAsWork ? run + 1 : 0;
      if (run > maxConsecutive)
        violations.push({
          type: "MAX_CONSECUTIVE",
          targetDate: date,
          staffId: person.id,
          message: `連続勤務が上限（${maxConsecutive}日）を超えています`,
        });
      const rule = sequenceRules.find((r) => r.firstShiftTypeId === current.shiftTypeId);
      if (
        rule &&
        di < dates.length - 1 &&
        byKey.get(`${person.id}/${dates[di + 1]}`)?.shiftTypeId !==
          rule.secondShiftTypeId
      )
        violations.push({
          type: "SEQUENCE",
          targetDate: date,
          staffId: person.id,
          message: "連続勤務ルールに合わない勤務があります",
        });
      if (
        current.shiftTypeId != null &&
        isUnavailable(person.id, date, current.shiftTypeId)
      )
        violations.push({
          type: "UNAVAILABLE",
          targetDate: date,
          staffId: person.id,
          shiftTypeId: current.shiftTypeId,
          message: "勤務不可の曜日または勤務種別に割り当てられています",
        });
    }
    if (dates.length > 0 && person.minDays != null && totalWorkDays < person.minDays)
      violations.push({
        type: "MIN_DAYS",
        targetDate: dates[0],
        staffId: person.id,
        message: `月間勤務日数が下限（${person.minDays}日）に達していません（現在${totalWorkDays}日）`,
      });
    for (const other of staff) {
      if (other.id <= person.id) continue;
      if (!np.has(`${person.id}/${other.id}`)) continue;
      for (const date of dates) {
        const a = byKey.get(`${person.id}/${date}`);
        const b = byKey.get(`${other.id}/${date}`);
        if (
          a?.shiftTypeId != null &&
          b?.shiftTypeId != null &&
          byTypeId.get(a.shiftTypeId)?.countsAsWork &&
          byTypeId.get(b.shiftTypeId)?.countsAsWork
        )
          violations.push({
            type: "NG_PAIR",
            targetDate: date,
            staffId: person.id,
            message: "同日勤務NGペアが同じ日に割り当てられています",
          });
      }
    }
  }
  return violations;
}

// DB/Electron 非依存の純粋な生成エンジン。単体テスト可能で、Workerからも呼び出す。
export function generate(
  input: GenerationInput,
  onProgress?: (p: { assigned: number; total: number; elapsedMs: number }) => void,
  shouldStop?: () => boolean,
): GenerationResult {
  const start = Date.now();
  const {
    staff,
    shiftTypes,
    roleRequirements,
    ngPairs,
    sequenceRules,
    unavailableConditions,
  } = input;
  const cells: Cell[] = input.cells.map((c) => ({ ...c }));
  const byTypeId = new Map(shiftTypes.map((t) => [t.id, t]));
  const holiday =
    shiftTypes.find((t) => t.shortName === "休" || t.name === "休み")?.id ?? null;
  const req = new Map(
    roleRequirements.map((r) => [
      `${r.targetDate}/${r.shiftTypeId}/${r.roleId}`,
      r.requiredCount,
    ]),
  );
  const byKey = new Map(cells.map((c) => [`${c.staffId}/${c.targetDate}`, c]));
  const dates = [...new Set(cells.map((c) => c.targetDate))].sort();
  const workDays = new Map(staff.map((s) => [s.id, 0]));
  const np = new Set(
    ngPairs.flatMap((p) => [
      `${p.staffId1}/${p.staffId2}`,
      `${p.staffId2}/${p.staffId1}`,
    ]),
  );
  const { isUnavailable } = buildUnavailableIndex(unavailableConditions);

  for (const c of cells) c.shiftTypeId = c.isRequestHoliday ? holiday : null;
  const roleIds = [...new Set(roleRequirements.map((r) => r.roleId))];
  const workTypes = shiftTypes.filter((t) => t.countsAsWork);
  let timedOut = false;

  outer: for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    for (const type of workTypes) {
      for (const roleId of roleIds) {
        const needed = req.get(`${date}/${type.id}/${roleId}`) ?? 0;
        for (let slot = 0; slot < needed; slot++) {
          if ((shouldStop?.() ?? false) || Date.now() - start > input.timeLimitMs) {
            timedOut = true;
            break outer;
          }
          const candidate = staff
            .filter((s) => {
              if (s.roleId !== roleId) return false;
              const cell = byKey.get(`${s.id}/${date}`)!;
              if (cell.shiftTypeId !== null || cell.isRequestHoliday) return false;
              if (isUnavailable(s.id, date, type.id)) return false;
              if (s.maxDays !== null && (workDays.get(s.id) ?? 0) >= s.maxDays)
                return false;
              const assigned = staff.filter((o) => {
                const x = byKey.get(`${o.id}/${date}`);
                return (
                  x?.shiftTypeId !== null &&
                  byTypeId.get(x!.shiftTypeId!)?.countsAsWork
                );
              });
              if (assigned.some((o) => np.has(`${s.id}/${o.id}`))) return false;
              const prev = di
                ? byKey.get(`${s.id}/${dates[di - 1]}`)?.shiftTypeId
                : null;
              const mandated = sequenceRules.find((r) => r.firstShiftTypeId === prev);
              return !mandated || mandated.secondShiftTypeId === type.id;
            })
            .sort(
              (a, b) => (workDays.get(a.id) ?? 0) - (workDays.get(b.id) ?? 0),
            )[0];
          if (!candidate) continue;
          const cell = byKey.get(`${candidate.id}/${date}`)!;
          cell.shiftTypeId = type.id;
          workDays.set(candidate.id, (workDays.get(candidate.id) ?? 0) + 1);
          // 翌日制約（例: 夜勤入り→夜勤明け）はハード制約であり、後続の勤務種別が
          // countsAsWork=0（勤務日として数えない）でも生成時に能動的に埋める。
          // これをしないと必要人数の割当対象から外れ、翌日制約が常に事後違反になる。
          let cursorDay = di;
          let cursorType = type.id;
          while (cursorDay + 1 < dates.length) {
            const rule = sequenceRules.find((r) => r.firstShiftTypeId === cursorType);
            if (!rule) break;
            const nextCell = byKey.get(`${candidate.id}/${dates[cursorDay + 1]}`);
            if (!nextCell || nextCell.shiftTypeId !== null || nextCell.isRequestHoliday)
              break;
            nextCell.shiftTypeId = rule.secondShiftTypeId;
            if (byTypeId.get(rule.secondShiftTypeId)?.countsAsWork)
              workDays.set(candidate.id, (workDays.get(candidate.id) ?? 0) + 1);
            cursorDay += 1;
            cursorType = rule.secondShiftTypeId;
          }
          onProgress?.({
            assigned: [...workDays.values()].reduce((a, b) => a + b, 0),
            total: [...req.values()].reduce((a, b) => a + b, 0),
            elapsedMs: Date.now() - start,
          });
        }
      }
    }
  }

  const violations = validateCells(
    {
      staff,
      shiftTypes,
      cells,
      roleRequirements,
      ngPairs,
      sequenceRules,
      unavailableConditions,
      maxConsecutiveDays: input.maxConsecutiveDays,
    },
    { timedOut },
  );

  return { cells, violations, timedOut };
}
