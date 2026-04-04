import { describe, it, expect } from "vitest";

import {
  Credits,
  hasEnoughCredits,
  getCreditsLevel,
  getCreditsProgress,
} from "@turbostarter/ai/credits/utils";

describe("Credits constants", () => {
  it("should have default balance of 100", () => {
    expect(Credits.BALANCE).toBe(100);
  });

  it("should have FREE cost of 0", () => {
    expect(Credits.COST.FREE).toBe(0);
  });

  it("should have DEFAULT cost of 5", () => {
    expect(Credits.COST.DEFAULT).toBe(5);
  });

  it("should have HIGH cost of 10", () => {
    expect(Credits.COST.HIGH).toBe(10);
  });
});

describe("hasEnoughCredits", () => {
  it("should return true when credits are sufficient", () => {
    expect(hasEnoughCredits(100, 50)).toBe(true);
    expect(hasEnoughCredits(50, 50)).toBe(true);
    expect(hasEnoughCredits(100, 0)).toBe(true);
  });

  it("should return false when credits are insufficient", () => {
    expect(hasEnoughCredits(50, 100)).toBe(false);
    expect(hasEnoughCredits(0, 1)).toBe(false);
    expect(hasEnoughCredits(99, 100)).toBe(false);
  });

  it("should handle edge cases", () => {
    expect(hasEnoughCredits(0, 0)).toBe(true);
    expect(hasEnoughCredits(1, 1)).toBe(true);
  });
});

describe("getCreditsLevel", () => {
  it("should return 'high' when credits > 50%", () => {
    expect(getCreditsLevel(60, 100)).toBe("high");
    expect(getCreditsLevel(100, 100)).toBe("high");
    expect(getCreditsLevel(51, 100)).toBe("high");
  });

  it("should return 'medium' when credits between 15% and 50%", () => {
    expect(getCreditsLevel(50, 100)).toBe("medium");
    expect(getCreditsLevel(16, 100)).toBe("medium");
    expect(getCreditsLevel(30, 100)).toBe("medium");
  });

  it("should return 'low' when credits <= 15%", () => {
    expect(getCreditsLevel(15, 100)).toBe("low");
    expect(getCreditsLevel(10, 100)).toBe("low");
    expect(getCreditsLevel(0, 100)).toBe("low");
    expect(getCreditsLevel(1, 100)).toBe("low");
  });

  it("should use default max of 100 when not specified", () => {
    expect(getCreditsLevel(60)).toBe("high");
    expect(getCreditsLevel(30)).toBe("medium");
    expect(getCreditsLevel(10)).toBe("low");
  });
});

describe("getCreditsProgress", () => {
  it("should calculate correct progress ratio", () => {
    expect(getCreditsProgress(50, 100)).toBe(0.5);
    expect(getCreditsProgress(25, 100)).toBe(0.25);
    expect(getCreditsProgress(100, 100)).toBe(1);
    expect(getCreditsProgress(0, 100)).toBe(0);
  });

  it("should use default max of 100", () => {
    expect(getCreditsProgress(50)).toBe(0.5);
    expect(getCreditsProgress(100)).toBe(1);
  });

  it("should handle custom max values", () => {
    expect(getCreditsProgress(500, 1000)).toBe(0.5);
    expect(getCreditsProgress(250, 500)).toBe(0.5);
  });
});
