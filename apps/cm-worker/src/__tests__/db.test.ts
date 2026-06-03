import { describe, it, expect } from "vitest";
import { createSupabaseClient, createPgBoss } from "../db.js";

describe("db", () => {
  describe("createSupabaseClient", () => {
    it("throws when env vars are missing", () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(() => createSupabaseClient()).toThrow("Missing Supabase credentials");
    });

    it("creates a supabase client when env vars are present", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      const client = createSupabaseClient();
      expect(client).toBeDefined();
    });
  });

  describe("createPgBoss", () => {
    it("throws when CM_DATABASE_URL is missing", () => {
      delete process.env.CM_DATABASE_URL;
      expect(() => createPgBoss()).toThrow("Missing database connection string");
    });

    it("creates a PgBoss instance when connection string is present", () => {
      process.env.CM_DATABASE_URL = "postgresql://localhost:5432/test";
      const boss = createPgBoss();
      expect(boss).toBeDefined();
    });
  });
});
