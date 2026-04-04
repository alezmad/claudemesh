import { describe, it, expect } from "vitest";

import { updateCreditsSchema, getTransactionsSchema } from "../../src/schema/admin";

describe("updateCreditsSchema", () => {
  describe("action field", () => {
    it("should accept 'set' action", () => {
      const result = updateCreditsSchema.safeParse({
        action: "set",
        amount: 100,
      });
      expect(result.success).toBe(true);
    });

    it("should accept 'add' action", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 100,
      });
      expect(result.success).toBe(true);
    });

    it("should accept 'deduct' action", () => {
      const result = updateCreditsSchema.safeParse({
        action: "deduct",
        amount: 100,
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid action", () => {
      const result = updateCreditsSchema.safeParse({
        action: "invalid",
        amount: 100,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("amount field", () => {
    it("should accept positive integers", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 500,
      });
      expect(result.success).toBe(true);
    });

    it("should reject zero", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative numbers", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: -100,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-integers", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 10.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("reason field", () => {
    it("should accept optional reason", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 100,
        reason: "Promotional credit",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBe("Promotional credit");
      }
    });

    it("should accept missing reason", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 100,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBeUndefined();
      }
    });

    it("should reject reason over 500 characters", () => {
      const result = updateCreditsSchema.safeParse({
        action: "add",
        amount: 100,
        reason: "a".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("getTransactionsSchema", () => {
  it("should require customerId", () => {
    const result = getTransactionsSchema.safeParse({
      page: 1,
      perPage: 20,
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid input with defaults", () => {
    const result = getTransactionsSchema.safeParse({
      customerId: "cust-123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.perPage).toBe(20);
    }
  });

  it("should accept pagination parameters", () => {
    const result = getTransactionsSchema.safeParse({
      customerId: "cust-123",
      page: 3,
      perPage: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.perPage).toBe(50);
    }
  });

  it("should reject perPage over 100", () => {
    const result = getTransactionsSchema.safeParse({
      customerId: "cust-123",
      perPage: 150,
    });
    expect(result.success).toBe(false);
  });

  describe("type filter", () => {
    const validTypes = [
      "signup",
      "purchase",
      "usage",
      "admin_grant",
      "admin_deduct",
      "refund",
      "promo",
      "referral",
      "expiry",
    ] as const;

    validTypes.forEach((type) => {
      it(`should accept type '${type}'`, () => {
        const result = getTransactionsSchema.safeParse({
          customerId: "cust-123",
          type,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid type", () => {
      const result = getTransactionsSchema.safeParse({
        customerId: "cust-123",
        type: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });
});
