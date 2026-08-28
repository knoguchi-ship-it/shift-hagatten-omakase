import { describe, expect, it } from "vitest";
import { daysInMonth, dayOfWeek, toDateKey, weekdayLabel } from "./types";

describe("toDateKey", () => {
  it("zero-pads month and day", () => {
    expect(toDateKey(2026, 3, 5)).toBe("2026-03-05");
    expect(toDateKey(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("dayOfWeek / weekdayLabel", () => {
  it("returns the correct weekday for a known date", () => {
    expect(dayOfWeek("2026-08-15")).toBe(6); // 2026-08-15 is a Saturday
    expect(weekdayLabel("2026-08-15")).toBe("土");
  });
});

describe("daysInMonth", () => {
  it("returns every date string for a 31-day month", () => {
    const days = daysInMonth("2026-08");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-08-01");
    expect(days[30]).toBe("2026-08-31");
  });
  it("handles February in a non-leap year", () => {
    expect(daysInMonth("2026-02")).toHaveLength(28);
  });
});
