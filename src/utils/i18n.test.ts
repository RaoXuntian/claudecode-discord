import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";

// Must mock fs before importing i18n, since getCurrentLang() reads from disk
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, default: { ...actual, readFileSync: vi.fn() } };
});

// Re-import after mock is set up
const { L } = await import("./i18n.js");

describe("i18n", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("L()", () => {
    it("returns English string when .tray-lang file is missing", () => {
      vi.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("ENOENT"); });
      expect(L("Hello", "你好")).toBe("Hello");
    });

    it("returns Chinese string when .tray-lang contains 'zh'", () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue("zh");
      expect(L("Hello", "你好")).toBe("你好");
    });

    it("returns English string when .tray-lang contains 'en'", () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue("en");
      expect(L("Hello", "你好")).toBe("Hello");
    });

    it("returns English string when .tray-lang contains unknown value", () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue("kr");
      expect(L("Hello", "你好")).toBe("Hello");
    });

    it("trims whitespace from .tray-lang content", () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue("  zh  \n");
      expect(L("Hello", "你好")).toBe("你好");
    });

    it("returns correct string for each call independently", () => {
      const spy = vi.spyOn(fs, "readFileSync");
      spy.mockReturnValueOnce("zh").mockReturnValueOnce("en");
      expect(L("A", "甲")).toBe("甲");
      expect(L("B", "乙")).toBe("B");
    });
  });
});
