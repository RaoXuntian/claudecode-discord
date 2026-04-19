import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TextChannel, DMChannel, ThreadChannel, Message } from "discord.js";

type BotChannel = TextChannel | DMChannel | ThreadChannel;
import {
  upsertSession,
  updateSessionStatus,
  getProject,
  getSession,
  setAutoApprove,
} from "../db/database.js";
import { getConfig } from "../utils/config.js";
import { L } from "../utils/i18n.js";
import {
  createToolApprovalEmbed,
  createAskUserQuestionEmbed,
  createStopButton,
  splitMessage,
  type AskQuestionData,
} from "./output-formatter.js";

interface ActiveSession {
  queryInstance: Query;
  channelId: string;
  sessionId: string | null; // Claude Agent SDK session ID
  dbId: string;
}

// Pending approval requests: requestId -> resolve function
const pendingApprovals = new Map<
  string,
  {
    resolve: (decision: { behavior: "allow" | "deny"; message?: string }) => void;
    channelId: string;
  }
>();

// Pending AskUserQuestion requests: requestId -> resolve function
const pendingQuestions = new Map<
  string,
  {
    resolve: (answer: string | null) => void;
    channelId: string;
  }
>();

// Pending custom text inputs: channelId -> requestId
const pendingCustomInputs = new Map<string, { requestId: string }>();

class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private static readonly MAX_QUEUE_SIZE = 5;
  private messageQueue = new Map<string, { channel: BotChannel; prompt: string }[]>();
  private pendingQueuePrompts = new Map<string, { channel: BotChannel; prompt: string }>();

  async sendMessage(
    channel: BotChannel,
    prompt: string,
    reactMessage?: Message,
  ): Promise<void> {
    const channelId = channel.id;
    const project = getProject(channelId);
    if (!project) return;

    const existingSession = this.sessions.get(channelId);
    // If no in-memory session, check DB for previous session_id (for bot restart resume)
    const dbSession = !existingSession ? getSession(channelId) : undefined;
    const dbId = existingSession?.dbId ?? dbSession?.id ?? randomUUID();
    const resumeSessionId = existingSession?.sessionId ?? dbSession?.session_id ?? undefined;

    // Update status to online
    upsertSession(dbId, channelId, resumeSessionId ?? null, "online");

    // Typing indicator — shows "Bot is typing…" while Claude works, before text streams
    let typingActive = true;
    const refreshTyping = async () => {
      if (!typingActive) return;
      try { await channel.sendTyping(); } catch {}
    };
    await refreshTyping(); // show immediately before sending the initial message
    const typingInterval = setInterval(refreshTyping, 8_000); // Discord typing lasts ~10s

    // Streaming state
    let responseBuffer = "";
    let lastEditTime = 0;
    const stopRow = createStopButton(channelId);

    // Hermes reply-to mode "first": reply to user's original message so the response is
    // visually anchored to it; fall back to a plain send if the message was deleted.
    let currentMessage: Message;
    try {
      currentMessage = reactMessage
        ? await reactMessage.reply({ content: L("⏳ Thinking...", "⏳ 思考中..."), components: [stopRow] })
        : await channel.send({ content: L("⏳ Thinking...", "⏳ 思考中..."), components: [stopRow] });
    } catch {
      currentMessage = await channel.send({ content: L("⏳ Thinking...", "⏳ 思考中..."), components: [stopRow] });
    }
    const EDIT_INTERVAL = 1500; // ms between edits (Discord rate limit friendly)

    // Activity tracking for progress display
    const startTime = Date.now();
    let lastActivity = L("Thinking...", "思考中...");
    let toolUseCount = 0;
    let hasTextOutput = false;
    let hasResult = false;

    // Thinking / reasoning accumulation (Hermes-style: show reasoning before response)
    let thinkingBuffer = "";
    let thinkingSent = false;

    // Emoji reaction helpers (Hermes-style)
    const addedReactions = new Set<string>();
    const addReaction = async (emoji: string) => {
      if (!reactMessage || addedReactions.has(emoji)) return;
      addedReactions.add(emoji);
      try { await reactMessage.react(emoji); } catch {}
    };
    await addReaction("👀");

    // Heartbeat timer - updates status message every 15s when no text output yet
    const heartbeatInterval = setInterval(async () => {
      if (hasTextOutput) return; // stop heartbeat once real content is streaming
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      try {
        await currentMessage.edit({
          content: `⏳ ${lastActivity} (${timeStr})`,
          components: [stopRow],
        });
      } catch (e) {
        console.warn(`[heartbeat] Failed to edit message for ${channelId}:`, e instanceof Error ? e.message : e);
      }
    }, 15_000);

    try {
      const queryInstance = query({
        prompt,
        options: {
          cwd: project.project_path,
          permissionMode: "default",
          env: { ...process.env, ANTHROPIC_API_KEY: undefined, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
          ...(resumeSessionId ? { resume: resumeSessionId } : {}),
          // Thinking is opt-in: only pass the option when SHOW_THINKING=true
          // (adaptive thinking requires a compatible model; forcing it on unsupported
          //  models causes the query to fail silently and results to disappear)
          ...(getConfig().SHOW_THINKING ? { thinking: { type: "adaptive" } as const } : {}),

          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>,
          ) => {
            toolUseCount++;

            // Tool-specific emoji reactions
            const toolEmojiMap: Record<string, string> = {
              Read: "🛠️", Glob: "🛠️", Grep: "🛠️", TodoWrite: "🛠️",
              Write: "💻", Edit: "💻", Bash: "💻",
              WebSearch: "🌐", WebFetch: "🌐",
              AskUserQuestion: "🧠",
            };
            await addReaction(toolEmojiMap[toolName] ?? "");

            // Tool activity labels for Discord display
            const toolLabels: Record<string, string> = {
              Read: L("Reading files", "正在读取文件"),
              Glob: L("Searching files", "正在搜索文件"),
              Grep: L("Searching code", "正在搜索代码"),
              Write: L("Writing file", "正在写入文件"),
              Edit: L("Editing file", "正在编辑文件"),
              Bash: L("Running command", "正在执行命令"),
              WebSearch: L("Searching web", "正在搜索网络"),
              WebFetch: L("Fetching URL", "正在获取 URL"),
              TodoWrite: L("Updating tasks", "正在更新任务"),
            };
            const filePath = typeof input.file_path === "string"
              ? ` \`${(input.file_path as string).split(/[\\/]/).pop()}\``
              : "";
            lastActivity = `${toolLabels[toolName] ?? `Using ${toolName}`}${filePath}`;

            // Update status message if no text output yet
            if (!hasTextOutput) {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              const timeStr = elapsed > 60
                ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                : `${elapsed}s`;
              try {
                await currentMessage.edit({
                  content: `⏳ ${lastActivity} (${timeStr}) [${toolUseCount} tools used]`,
                  components: [stopRow],
                });
              } catch (e) {
                console.warn(`[tool-status] Failed to edit message for ${channelId}:`, e instanceof Error ? e.message : e);
              }
            }

            // Handle AskUserQuestion with interactive Discord UI
            if (toolName === "AskUserQuestion") {
              const questions = (input.questions as AskQuestionData[]) ?? [];
              if (questions.length === 0) {
                return { behavior: "allow" as const, updatedInput: input };
              }

              const answers: Record<string, string> = {};

              for (let qi = 0; qi < questions.length; qi++) {
                const q = questions[qi];
                const qRequestId = randomUUID();
                const { embed, components } = createAskUserQuestionEmbed(
                  q,
                  qRequestId,
                  qi,
                  questions.length,
                );

                updateSessionStatus(channelId, "waiting");
                await channel.send({ embeds: [embed], components });

                const answer = await new Promise<string | null>((resolve) => {
                  const timeout = setTimeout(() => {
                    pendingQuestions.delete(qRequestId);
                    // Clean up custom input if pending
                    const ci = pendingCustomInputs.get(channelId);
                    if (ci?.requestId === qRequestId) {
                      pendingCustomInputs.delete(channelId);
                    }
                    resolve(null);
                  }, 5 * 60 * 1000);

                  pendingQuestions.set(qRequestId, {
                    resolve: (ans) => {
                      clearTimeout(timeout);
                      pendingQuestions.delete(qRequestId);
                      resolve(ans);
                    },
                    channelId,
                  });
                });

                if (answer === null) {
                  updateSessionStatus(channelId, "online");
                  return {
                    behavior: "deny" as const,
                    message: L("Question timed out", "问题已超时"),
                  };
                }

                answers[q.header] = answer;
              }

              updateSessionStatus(channelId, "online");
              return {
                behavior: "allow" as const,
                updatedInput: { ...input, answers },
              };
            }

            // Auto-approve read-only tools
            const readOnlyTools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"];
            if (readOnlyTools.includes(toolName)) {
              return { behavior: "allow" as const, updatedInput: input };
            }

            // Check auto-approve setting
            const currentProject = getProject(channelId);
            if (currentProject?.auto_approve) {
              return { behavior: "allow" as const, updatedInput: input };
            }

            // Ask user via Discord buttons
            const requestId = randomUUID();
            const { embed, row } = createToolApprovalEmbed(
              toolName,
              input,
              requestId,
            );

            updateSessionStatus(channelId, "waiting");
            await channel.send({
              embeds: [embed],
              components: [row],
            });

            // Wait for user decision (timeout 5 min)
            return new Promise((resolve) => {
              const timeout = setTimeout(() => {
                pendingApprovals.delete(requestId);
                updateSessionStatus(channelId, "online");
                resolve({ behavior: "deny" as const, message: "Approval timed out" });
              }, 5 * 60 * 1000);

              pendingApprovals.set(requestId, {
                resolve: (decision) => {
                  clearTimeout(timeout);
                  pendingApprovals.delete(requestId);
                  updateSessionStatus(channelId, "online");
                  resolve(
                    decision.behavior === "allow"
                      ? { behavior: "allow" as const, updatedInput: input }
                      : { behavior: "deny" as const, message: decision.message ?? "Denied by user" },
                  );
                },
                channelId,
              });
            });
          },
        },
      });

      // Store the active session
      this.sessions.set(channelId, {
        queryInstance,
        channelId,
        sessionId: resumeSessionId ?? null,
        dbId,
      });

      for await (const message of queryInstance) {
        // Capture session ID
        if (
          message.type === "system" &&
          "subtype" in message &&
          message.subtype === "init"
        ) {
          const sdkSessionId = (message as { session_id?: string }).session_id;
          if (sdkSessionId) {
            const active = this.sessions.get(channelId);
            if (active) active.sessionId = sdkSessionId;
            upsertSession(dbId, channelId, sdkSessionId, "online");
          }
        }

        // Handle streaming text (and thinking blocks)
        if (message.type === "assistant" && "content" in message) {
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              // Collect thinking/reasoning blocks (sent to Discord before the main response)
              if (
                typeof block === "object" && block !== null &&
                "type" in block && (block as { type: string }).type === "thinking" &&
                "thinking" in block && typeof (block as { thinking: unknown }).thinking === "string"
              ) {
                thinkingBuffer += (block as { thinking: string }).thinking;
              }

              if ("text" in block && typeof block.text === "string") {
                // Before the first text, flush accumulated thinking to Discord
                if (!thinkingSent && thinkingBuffer.length > 0 && getConfig().SHOW_THINKING) {
                  thinkingSent = true;
                  const raw = thinkingBuffer.length > 1800
                    ? thinkingBuffer.slice(0, 1800) + `\n*(${L("Reasoning truncated (too long)", "推理内容过长，已截断")})*`
                    : thinkingBuffer;
                  // Format as blockquote so it's visually distinct
                  const quoted = raw.split("\n").map((l) => `> ${l}`).join("\n");
                  await channel.send(`-# 🧠 ${L("Reasoning", "推理过程")}\n${quoted}`).catch(() => {});
                }
                responseBuffer += block.text;
                hasTextOutput = true;
                // Stop typing indicator once real text starts streaming
                if (typingActive) {
                  typingActive = false;
                  clearInterval(typingInterval);
                }
              }
            }
          }
          // Throttled message edit
          const now = Date.now();
          if (now - lastEditTime >= EDIT_INTERVAL && responseBuffer.length > 0) {
            lastEditTime = now;
            const chunks = splitMessage(responseBuffer);
            try {
              await currentMessage.edit({ content: chunks[0] || "...", components: [] });
              // Send additional chunks as new messages
              for (let i = 1; i < chunks.length; i++) {
                currentMessage = await channel.send(chunks[i]);
                responseBuffer = chunks.slice(i + 1).join("");
              }
            } catch (e) {
              console.warn(`[stream] Failed to edit message for ${channelId}, sending new:`, e instanceof Error ? e.message : e);
              currentMessage = await channel.send(
                chunks[chunks.length - 1] || "...",
              );
            }
          }
        }

        // Handle result
        if ("result" in message) {
          // Edge case: thinking arrived but no text followed (e.g. pure tool-use turn)
          if (!thinkingSent && thinkingBuffer.length > 0 && getConfig().SHOW_THINKING) {
            thinkingSent = true;
            const raw = thinkingBuffer.length > 1800
              ? thinkingBuffer.slice(0, 1800) + `\n*(${L("Reasoning truncated (too long)", "推理内容过长，已截断")})*`
              : thinkingBuffer;
            const quoted = raw.split("\n").map((l) => `> ${l}`).join("\n");
            await channel.send(`-# 🧠 ${L("Reasoning", "推理过程")}\n${quoted}`).catch(() => {});
          }

          const resultMsg = message as {
            result?: string;
            total_cost_usd?: number;
            duration_ms?: number;
          };
          // Determine response text: prefer streamed buffer, fall back to result.result
          const resultText = resultMsg.result ?? "";
          const displayText = responseBuffer.length > 0 ? responseBuffer : resultText;

          // Flush to Discord
          if (displayText.length > 0) {
            const chunks = splitMessage(displayText);
            try {
              await currentMessage.edit({ content: chunks[0], components: [] });
              for (let i = 1; i < chunks.length; i++) {
                await channel.send(chunks[i]);
              }
            } catch (e) {
              console.warn(`[flush] Failed to edit final message for ${channelId}:`, e instanceof Error ? e.message : e);
              try { await channel.send(chunks[0]); } catch {}
            }
          } else {
            try {
              await currentMessage.edit({ components: [] });
            } catch (e) {
              console.warn(`[complete] Failed to clear buttons for ${channelId}:`, e instanceof Error ? e.message : e);
            }
          }

          // Subtle footer: duration + optional cost (no embed, no "Task Complete" header)
          const durationStr = `${((resultMsg.duration_ms ?? 0) / 1000).toFixed(1)}s`;
          const costStr = getConfig().SHOW_COST && (resultMsg.total_cost_usd ?? 0) > 0
            ? ` · $${(resultMsg.total_cost_usd ?? 0).toFixed(4)}`
            : "";
          await channel.send(`-# ⏱ ${durationStr}${costStr}`).catch(() => {});

          await addReaction("✅");

          // Detect auth/credit errors in result and suggest re-login
          const resultAuthKeywords = ["credit balance", "not authenticated", "unauthorized", "authentication", "login required", "auth token", "expired", "not logged in", "please run /login"];
          const lowerResult = resultText.toLowerCase();
          if (resultAuthKeywords.some((kw) => lowerResult.includes(kw))) {
            await channel.send(L(
              "🔑 Claude Code is not logged in. Please open a terminal on the host PC and run `claude login` to authenticate, then try again.",
              "🔑 Claude Code 未登录，请在主机上打开终端，运行 `claude login` 完成认证后重试。",
            ));
          }

          updateSessionStatus(channelId, "idle");
          hasResult = true;
        }
      }
    } catch (error) {
      // Skip error if result was already delivered (e.g., "Credit balance is too low" + exit code 1)
      if (hasResult) {
        console.warn(`[session] Ignoring post-result error for ${channelId}:`, error instanceof Error ? error.message : error);
        return;
      }
      const rawMsg =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Parse API error JSON to show clean message
      let errMsg = rawMsg;
      const jsonMatch = rawMsg.match(
        /API Error: (\d+)\s*(\{.*\})/s,
      );
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[2]);
          const statusCode = jsonMatch[1];
          const message =
            parsed?.error?.message ?? parsed?.message ?? "Unknown error";
          errMsg = `API Error ${statusCode}: ${message}. Please try again later.`;
        } catch (parseErr) {
          console.warn(`[error-parse] Failed to parse API error JSON for ${channelId}:`, parseErr instanceof Error ? parseErr.message : parseErr);
          // Fall back to extracting just the status code
          errMsg = `API Error ${jsonMatch[1]}. Please try again later.`;
        }
      } else if (rawMsg.includes("process exited with code")) {
        errMsg = `${rawMsg}. The server may be temporarily unavailable — please try again later.`;
      }

      // Detect auth/credit errors and suggest re-login
      const authKeywords = ["credit balance", "not authenticated", "unauthorized", "authentication", "login required", "auth token", "expired", "not logged in", "please run /login"];
      const lowerMsg = rawMsg.toLowerCase();
      if (authKeywords.some((kw) => lowerMsg.includes(kw))) {
        errMsg += L(
          "\n\n🔑 Claude Code is not logged in. Please open a terminal on the host PC and run `claude login` to authenticate, then try again.",
          "\n\n🔑 Claude Code 未登录，请在主机上打开终端，运行 `claude login` 完成认证后重试。",
        );
      }

      await channel.send(`❌ ${errMsg}`);
      await addReaction("❌");
      updateSessionStatus(channelId, "offline");
    } finally {
      typingActive = false;
      clearInterval(typingInterval);
      clearInterval(heartbeatInterval);
      this.sessions.delete(channelId);

      // Clean up any pending approvals/questions for this channel
      for (const [id, entry] of pendingApprovals) {
        if (entry.channelId === channelId) pendingApprovals.delete(id);
      }
      for (const [id, entry] of pendingQuestions) {
        if (entry.channelId === channelId) pendingQuestions.delete(id);
      }
      pendingCustomInputs.delete(channelId);

      // Process next queued message if any
      const queue = this.messageQueue.get(channelId);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        if (queue.length === 0) this.messageQueue.delete(channelId);
        const remaining = queue.length;
        const preview = next.prompt.length > 40 ? next.prompt.slice(0, 40) + "…" : next.prompt;
        const msg = remaining > 0
          ? L(`📨 Processing queued message... (remaining: ${remaining})\n> ${preview}`, `📨 正在处理队列中的消息...（剩余：${remaining}）\n> ${preview}`)
          : L(`📨 Processing queued message...\n> ${preview}`, `📨 正在处理队列中的消息...\n> ${preview}`);
        channel.send(msg).catch(() => {});
        this.sendMessage(next.channel, next.prompt).catch((err) => {
          console.error("Queue sendMessage error:", err);
        });
      }
    }
  }

  async stopSession(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session) return false;

    try {
      await session.queryInstance.interrupt();
    } catch {
      // already stopped
    }

    this.sessions.delete(channelId);

    // Clean up any pending approvals/questions for this channel
    for (const [id, entry] of pendingApprovals) {
      if (entry.channelId === channelId) pendingApprovals.delete(id);
    }
    for (const [id, entry] of pendingQuestions) {
      if (entry.channelId === channelId) pendingQuestions.delete(id);
    }
    pendingCustomInputs.delete(channelId);

    updateSessionStatus(channelId, "offline");
    return true;
  }

  isActive(channelId: string): boolean {
    return this.sessions.has(channelId);
  }

  resolveApproval(
    requestId: string,
    decision: "approve" | "deny" | "approve-all",
  ): boolean {
    const pending = pendingApprovals.get(requestId);
    if (!pending) return false;

    if (decision === "approve-all") {
      // Enable auto-approve for this channel
      setAutoApprove(pending.channelId, true);
      pending.resolve({ behavior: "allow" });
    } else if (decision === "approve") {
      pending.resolve({ behavior: "allow" });
    } else {
      pending.resolve({ behavior: "deny", message: "Denied by user" });
    }

    return true;
  }

  resolveQuestion(requestId: string, answer: string): boolean {
    const pending = pendingQuestions.get(requestId);
    if (!pending) return false;
    pending.resolve(answer);
    return true;
  }

  enableCustomInput(requestId: string, channelId: string): void {
    pendingCustomInputs.set(channelId, { requestId });
  }

  resolveCustomInput(channelId: string, text: string): boolean {
    const ci = pendingCustomInputs.get(channelId);
    if (!ci) return false;
    pendingCustomInputs.delete(channelId);

    const pending = pendingQuestions.get(ci.requestId);
    if (!pending) return false;
    pending.resolve(text);
    return true;
  }

  hasPendingCustomInput(channelId: string): boolean {
    return pendingCustomInputs.has(channelId);
  }

  // --- Message queue ---

  setPendingQueue(channelId: string, channel: BotChannel, prompt: string): void {
    this.pendingQueuePrompts.set(channelId, { channel, prompt });
  }

  confirmQueue(channelId: string): boolean {
    const pending = this.pendingQueuePrompts.get(channelId);
    if (!pending) return false;
    this.pendingQueuePrompts.delete(channelId);
    const queue = this.messageQueue.get(channelId) ?? [];
    queue.push(pending);
    this.messageQueue.set(channelId, queue);
    return true;
  }

  cancelQueue(channelId: string): void {
    this.pendingQueuePrompts.delete(channelId);
  }

  isQueueFull(channelId: string): boolean {
    const queue = this.messageQueue.get(channelId) ?? [];
    return queue.length >= SessionManager.MAX_QUEUE_SIZE;
  }

  getQueueSize(channelId: string): number {
    return (this.messageQueue.get(channelId) ?? []).length;
  }

  hasQueue(channelId: string): boolean {
    return this.pendingQueuePrompts.has(channelId);
  }

  getQueue(channelId: string): { channel: BotChannel; prompt: string }[] {
    return this.messageQueue.get(channelId) ?? [];
  }

  clearQueue(channelId: string): number {
    const queue = this.messageQueue.get(channelId) ?? [];
    const count = queue.length;
    this.messageQueue.delete(channelId);
    this.pendingQueuePrompts.delete(channelId);
    return count;
  }

  removeFromQueue(channelId: string, index: number): string | null {
    const queue = this.messageQueue.get(channelId);
    if (!queue || index < 0 || index >= queue.length) return null;
    const [removed] = queue.splice(index, 1);
    if (queue.length === 0) {
      this.messageQueue.delete(channelId);
      this.pendingQueuePrompts.delete(channelId);
    }
    return removed.prompt;
  }
}

export const sessionManager = new SessionManager();
