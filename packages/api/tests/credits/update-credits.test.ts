import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module before importing the mutation
vi.mock("@turbostarter/db/server", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("@turbostarter/shared/utils", () => ({
  generateId: vi.fn(() => "test-transaction-id"),
  HttpException: class HttpException extends Error {
    constructor(public statusCode: number, public body?: { code: string; message?: string }) {
      super(body?.message ?? "HttpException");
    }
  },
}));

import { db } from "@turbostarter/db/server";

import { updateCustomerCredits } from "../../src/modules/admin/customers/mutations";

describe("updateCustomerCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("action: add", () => {
    it("should add credits to customer balance", async () => {
      const mockCustomer = { id: "cust-1", credits: 100 };
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockCustomer]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method
      vi.mocked(db.transaction).mockImplementation((callback) => callback(mockTx as any));

      const result = await updateCustomerCredits(
        "cust-1",
        { action: "add", amount: 50 },
        "admin-1"
      );

      expect(result).toEqual({
        previousBalance: 100,
        newBalance: 150,
        action: "add",
        amount: 50,
      });
      expect(mockTx.insert).toHaveBeenCalled();
    });
  });

  describe("action: deduct", () => {
    it("should deduct credits from customer balance", async () => {
      const mockCustomer = { id: "cust-1", credits: 100 };
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockCustomer]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method
      vi.mocked(db.transaction).mockImplementation((callback) => callback(mockTx as any));

      const result = await updateCustomerCredits(
        "cust-1",
        { action: "deduct", amount: 30 },
        "admin-1"
      );

      expect(result).toEqual({
        previousBalance: 100,
        newBalance: 70,
        action: "deduct",
        amount: 30,
      });
    });

    it("should throw error when deducting more than available", async () => {
      const mockCustomer = { id: "cust-1", credits: 20 };
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockCustomer]),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method
      vi.mocked(db.transaction).mockImplementation((callback) => callback(mockTx as any));

      await expect(
        updateCustomerCredits("cust-1", { action: "deduct", amount: 50 }, "admin-1")
      ).rejects.toThrow();
    });
  });

  describe("action: set", () => {
    it("should set credits to exact amount (increase)", async () => {
      const mockCustomer = { id: "cust-1", credits: 100 };
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockCustomer]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method
      vi.mocked(db.transaction).mockImplementation((callback) => callback(mockTx as any));

      const result = await updateCustomerCredits(
        "cust-1",
        { action: "set", amount: 200 },
        "admin-1"
      );

      expect(result).toEqual({
        previousBalance: 100,
        newBalance: 200,
        action: "set",
        amount: 200,
      });
    });

    it("should set credits to exact amount (decrease)", async () => {
      const mockCustomer = { id: "cust-1", credits: 100 };
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockCustomer]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method
      vi.mocked(db.transaction).mockImplementation((callback) => callback(mockTx as any));

      const result = await updateCustomerCredits(
        "cust-1",
        { action: "set", amount: 50 },
        "admin-1"
      );

      expect(result).toEqual({
        previousBalance: 100,
        newBalance: 50,
        action: "set",
        amount: 50,
      });
    });
  });

  describe("error cases", () => {
    it("should throw when customer not found", async () => {
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method
      vi.mocked(db.transaction).mockImplementation((callback) => callback(mockTx as any));

      await expect(
        updateCustomerCredits("nonexistent", { action: "add", amount: 100 }, "admin-1")
      ).rejects.toThrow();
    });
  });
});
