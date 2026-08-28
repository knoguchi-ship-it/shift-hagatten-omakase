import { describe, expect, it } from "vitest";
import { createAcceptance50x31Input } from "./fixtures/acceptance-50x31";

describe("50名×31日受入シナリオ", () => {
  it("匿名データと全セル・主要制約を再現可能に提供する", () => {
    const input = createAcceptance50x31Input();

    expect(input.staff).toHaveLength(50);
    expect(input.cells).toHaveLength(50 * 31);
    expect(input.roleRequirements).toHaveLength(6 * 31);
    expect(input.ngPairs).toHaveLength(5);
    expect(input.sequenceRules).toEqual([{ firstShiftTypeId: 4, secondShiftTypeId: 5 }]);
    expect(input.unavailableConditions).toHaveLength(5);
    expect(input.cells.some((cell) => cell.isRequestHoliday === 1)).toBe(true);
  });
});
