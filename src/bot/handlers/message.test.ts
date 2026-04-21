import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/i18n.js", () => ({ L: (en: string, _zh: string) => en }));
vi.mock("../../utils/config.js", () => ({
  getConfig: vi.fn(() => ({ BASE_PROJECT_DIR: "/projects", RATE_LIMIT_PER_MINUTE: 10 })),
}));
vi.mock("../../security/guard.js", () => ({
  isAllowedUser: vi.fn(() => true),
  checkRateLimit: vi.fn(() => true),
}));
vi.mock("../../db/database.js", () => ({
  getProject: vi.fn(() => ({ project_path: "/projects/test", auto_approve: false })),
  registerProject: vi.fn(),
}));
vi.mock("../../claude/session-manager.js", () => ({
  sessionManager: {
    sendMessage: vi.fn(),
    isActive: vi.fn(() => false),
    hasPendingCustomInput: vi.fn(() => false),
    hasQueue: vi.fn(() => false),
    isQueueFull: vi.fn(() => false),
    setPendingQueue: vi.fn(),
  },
}));

import { handleMessage } from "./message.js";
import { sessionManager } from "../../claude/session-manager.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let msgIdCounter = 0;
function makeMessage(overrides: Partial<{
  id: string;
  content: string;
  channelId: string;
  authorId: string;
  bot: boolean;
  guild: boolean;
  attachments: Map<string, any>;
}> = {}) {
  const channelId = overrides.channelId ?? "ch-1";
  return {
    id: overrides.id ?? `msg-${++msgIdCounter}`,
    content: overrides.content ?? "hello",
    channelId,
    author: { id: overrides.authorId ?? "user1", bot: overrides.bot ?? false },
    guild: overrides.guild !== false ? { id: "guild-1" } : null,
    attachments: overrides.attachments ?? new Map(),
    channel: {
      id: channelId,
      send: vi.fn().mockResolvedValue({}),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      isThread: () => false,
      isSendable: () => true,
    },
    reply: vi.fn().mockResolvedValue({}),
    react: vi.fn().mockResolvedValue({}),
  } as any;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Bot filter ───

  it("ignores messages from bots", async () => {
    const msg = makeMessage({ bot: true });
    await handleMessage(msg);
    expect(sessionManager.sendMessage).not.toHaveBeenCalled();
  });

  // ─── Deduplication ───

  describe("deduplication", () => {
    it("processes a new message ID", async () => {
      const msg = makeMessage({ id: "dedup-new-1" });
      await handleMessage(msg);
      vi.advanceTimersByTime(1000);
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("skips a duplicate message ID", async () => {
      const msg = makeMessage({ id: "dedup-dup-1" });
      await handleMessage(msg);
      vi.advanceTimersByTime(1000);
      await handleMessage(msg); // same ID again
      vi.advanceTimersByTime(1000);
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("processes different IDs independently", async () => {
      await handleMessage(makeMessage({ id: "dedup-a", channelId: "ch-dedup" }));
      await handleMessage(makeMessage({ id: "dedup-b", channelId: "ch-dedup" }));
      vi.advanceTimersByTime(1000);
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1); // batched into one
    });
  });

  // ─── Batching ───

  describe("message batching", () => {
    it("sends a single message after 800ms", async () => {
      const msg = makeMessage({ id: "batch-single", content: "task A", channelId: "ch-batch-1" });
      await handleMessage(msg);
      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(800);
      expect(sessionManager.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        "task A",
        msg,
      );
    });

    it("merges two rapid messages with --- separator", async () => {
      const ch = "ch-batch-2";
      const msg1 = makeMessage({ id: "batch-m1", content: "part one", channelId: ch });
      const msg2 = makeMessage({ id: "batch-m2", content: "part two", channelId: ch });
      await handleMessage(msg1);
      await handleMessage(msg2);
      vi.advanceTimersByTime(800);
      expect(sessionManager.sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        "part one\n\n---\n\npart two",
        msg1, // firstMessage
      );
    });

    it("resets timer on second message", async () => {
      const ch = "ch-batch-3";
      const msg1 = makeMessage({ id: "batch-r1", content: "first", channelId: ch });
      const msg2 = makeMessage({ id: "batch-r2", content: "second", channelId: ch });
      await handleMessage(msg1);
      vi.advanceTimersByTime(600); // not yet
      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      await handleMessage(msg2);
      vi.advanceTimersByTime(600); // not yet (timer reset)
      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200); // now 800ms since msg2
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Attachment blocking ───

  describe("attachment validation", () => {
    it("blocks dangerous executable attachments", async () => {
      const attachment = {
        name: "malware.exe",
        size: 1000,
        url: "https://cdn.discord.com/malware.exe",
      };
      const msg = makeMessage({
        id: "attach-exe",
        content: "",
        attachments: new Map([["1", attachment]]),
      });
      await handleMessage(msg);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining("malware.exe"),
      );
    });

    it("blocks oversized attachments", async () => {
      const attachment = {
        name: "bigfile.zip",
        size: 26 * 1024 * 1024, // 26MB > 25MB limit
        url: "https://cdn.discord.com/bigfile.zip",
      };
      const msg = makeMessage({
        id: "attach-big",
        content: "",
        attachments: new Map([["1", attachment]]),
      });
      await handleMessage(msg);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining("bigfile.zip"),
      );
    });
  });
});
