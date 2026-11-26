import { describe, expect, it } from "vitest";
import { dayOriginIso, localDateString, startOfDayInTz } from "@/lib/time";

describe("timezone helpers", () => {
  it("start of day in Riyadh (UTC+3)", () => {
    expect(startOfDayInTz(new Date("2026-03-01T10:00:00Z"), "Asia/Riyadh").toISOString()).toBe("2026-02-28T21:00:00.000Z");
    // 22:30 UTC is already the next day in Riyadh
    expect(startOfDayInTz(new Date("2026-03-01T22:30:00Z"), "Asia/Riyadh").toISOString()).toBe("2026-03-01T21:00:00.000Z");
    expect(localDateString(new Date("2026-03-01T22:30:00Z"), "Asia/Riyadh")).toBe("2026-03-02");
  });
  it("handles DST zones", () => {
    expect(startOfDayInTz(new Date("2026-07-01T12:00:00Z"), "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(startOfDayInTz(new Date("2026-01-01T12:00:00Z"), "UTC").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("origin", () => {
    expect(dayOriginIso("Asia/Riyadh")).toBe("2000-01-02T21:00:00.000Z");
  });
});
