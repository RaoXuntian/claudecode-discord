import { Message, TextChannel, DMChannel, ThreadChannel, Attachment, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getProject, registerProject } from "../../db/database.js";
import { getConfig } from "../../utils/config.js";
import { isAllowedUser, checkRateLimit } from "../../security/guard.js";
import { sessionManager } from "../../claude/session-manager.js";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { L } from "../../utils/i18n.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// Dangerous executable extensions that should not be downloaded
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
  ".dll", ".sys", ".drv",
  ".vbs", ".vbe", ".wsf", ".wsh",
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Discord free tier limit)

// ── Hermes patterns ──────────────────────────────────────────────────────────

// 1. Message deduplication — Discord WebSocket RESUME events can replay recent
//    messages; track processed IDs to ignore replays (Hermes: MessageDeduplicator)
const processedMessageIds = new Set<string>();
const DEDUP_MAX_SIZE = 500;

// 2. Text message batching — buffer rapid-fire messages and merge them into one
//    prompt before sending to Claude (Hermes: _pending_text_batches / 0.6s delay)
const TEXT_BATCH_DELAY_MS = 800;
interface BatchEntry {
  prompts: string[];
  firstMessage: Message;
  channel: TextChannel | DMChannel | ThreadChannel;
  timer: ReturnType<typeof setTimeout>;
}
const pendingBatches = new Map<string, BatchEntry>();

// ─────────────────────────────────────────────────────────────────────────────

async function downloadAttachment(
  attachment: Attachment,
  projectPath: string,
): Promise<{ filePath: string; isImage: boolean } | { skipped: string } | null> {
  const ext = path.extname(attachment.name ?? "").toLowerCase();

  // Block dangerous executables
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { skipped: L(`Blocked: \`${attachment.name}\` (dangerous file type)`, `已拦截：\`${attachment.name}\`（危险文件类型）`) };
  }

  // Skip files that are too large
  if (attachment.size > MAX_FILE_SIZE) {
    const sizeMB = (attachment.size / 1024 / 1024).toFixed(1);
    return { skipped: L(`Skipped: \`${attachment.name}\` (${sizeMB}MB exceeds 25MB limit)`, `已跳过：\`${attachment.name}\`（${sizeMB}MB，超过 25MB 限制）`) };
  }

  const uploadDir = path.join(projectPath, ".claude-uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const fileName = `${Date.now()}-${attachment.name}`;
  const filePath = path.join(uploadDir, fileName);

  try {
    const response = await fetch(attachment.url);
    if (!response.ok || !response.body) {
      return { skipped: L(`Failed to download: \`${attachment.name}\``, `下载失败：\`${attachment.name}\``) };
    }

    const fileStream = fs.createWriteStream(filePath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);
  } catch (e) {
    console.warn(`[download] Failed to download attachment ${attachment.name}:`, e instanceof Error ? e.message : e);
    return { skipped: L(`Failed to download: \`${attachment.name}\``, `下载失败：\`${attachment.name}\``) };
  }

  return { filePath, isImage: IMAGE_EXTENSIONS.has(ext) };
}

export async function handleMessage(message: Message): Promise<void> {
  // Ignore bots
  if (message.author.bot) return;

  // Deduplication: skip messages already processed (Discord RESUME can replay them)
  if (processedMessageIds.has(message.id)) return;
  if (processedMessageIds.size >= DEDUP_MAX_SIZE) {
    processedMessageIds.delete(processedMessageIds.values().next().value!);
  }
  processedMessageIds.add(message.id);

  const isDM = !message.guild;

  // Auth check
  if (!isAllowedUser(message.author.id)) {
    await message.reply(L("You are not authorized to use this bot.", "您没有使用此机器人的权限。"));
    return;
  }

  if (isDM) {
    // Auto-register DM channel with BASE_PROJECT_DIR on first message
    if (!getProject(message.channelId)) {
      const { BASE_PROJECT_DIR } = getConfig();
      registerProject(message.channelId, BASE_PROJECT_DIR, "dm");
    }
  } else {
    // If this is a thread, join it (so the bot can send messages) and inherit the parent's project
    if (message.channel.isThread()) {
      const thread = message.channel;
      // Join the thread so we have send permission; safe to call even if already a member
      try { await thread.join(); } catch {}

      const parentId = thread.parentId;
      if (parentId && !getProject(message.channelId)) {
        const parentProject = getProject(parentId);
        if (parentProject) {
          registerProject(message.channelId, parentProject.project_path, message.guildId!);
        }
      }
    }
    // Check if guild channel (or auto-registered thread) is registered
    if (!getProject(message.channelId)) return;
  }

  // Rate limit
  if (!checkRateLimit(message.author.id)) {
    await message.reply(L("Rate limit exceeded. Please wait a moment.", "请求过于频繁，请稍后重试。"));
    return;
  }

  // Check for pending custom text input (AskUserQuestion "direct text input")
  if (sessionManager.hasPendingCustomInput(message.channelId)) {
    const text = message.content.trim();
    if (text) {
      sessionManager.resolveCustomInput(message.channelId, text);
      await message.react("✅");
    }
    return;
  }

  let prompt = message.content.trim();

  const project = getProject(message.channelId)!;

  // Download attachments (images, documents, code files, etc.)
  const imagePaths: string[] = [];
  const filePaths: string[] = [];
  const skippedMessages: string[] = [];

  for (const [, attachment] of message.attachments) {
    const result = await downloadAttachment(attachment, project.project_path);
    if (!result) continue;
    if ("skipped" in result) {
      skippedMessages.push(result.skipped);
      continue;
    }
    if (result.isImage) {
      imagePaths.push(result.filePath);
    } else {
      filePaths.push(result.filePath);
    }
  }

  if (skippedMessages.length > 0) {
    await message.reply(skippedMessages.join("\n"));
  }

  if (imagePaths.length > 0) {
    prompt += `\n\n[Attached images - use Read tool to view these files]\n${imagePaths.join("\n")}`;
  }
  if (filePaths.length > 0) {
    prompt += `\n\n[Attached files - use Read tool to read these files]\n${filePaths.join("\n")}`;
  }

  if (!prompt) return;

  const channel = message.channel as TextChannel | DMChannel | ThreadChannel;

  // If session is active, offer to queue the message
  if (sessionManager.isActive(message.channelId)) {
    if (sessionManager.hasQueue(message.channelId)) {
      await message.reply(L("⏳ A message is already waiting to be queued. Please press the button first.", "⏳ 已有消息等待加入队列，请先点击按钮。"));
      return;
    }
    if (sessionManager.isQueueFull(message.channelId)) {
      await message.reply(L("⏳ Queue is full (max 5). Please wait for the current task to finish.", "⏳ 队列已满（最多 5 条），请等待当前任务完成。"));
      return;
    }

    sessionManager.setPendingQueue(message.channelId, channel, prompt);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue-yes:${message.channelId}`)
        .setLabel(L("Add to Queue", "加入队列"))
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setCustomId(`queue-no:${message.channelId}`)
        .setLabel(L("Cancel", "取消"))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌"),
    );

    await message.reply({
      content: L("⏳ A previous task is in progress. Process this automatically when done?", "⏳ 上一个任务正在进行中，完成后自动处理此消息？"),
      components: [row],
    });
    return;
  }

  // Show typing indicator immediately — before the batch delay and before sendMessage,
  // so the user sees "is typing…" right away instead of 800ms of silence.
  channel.sendTyping().catch(() => {});

  // Text batching: accumulate rapid messages and flush as one combined prompt after
  // TEXT_BATCH_DELAY_MS of silence (Hermes pattern). Each new message resets the timer.
  const existing = pendingBatches.get(message.channelId);
  if (existing) {
    existing.prompts.push(prompt);
    clearTimeout(existing.timer);
  } else {
    pendingBatches.set(message.channelId, {
      prompts: [prompt],
      firstMessage: message,
      channel,
      timer: null!,
    });
  }
  const batch = pendingBatches.get(message.channelId)!;
  batch.timer = setTimeout(async () => {
    pendingBatches.delete(message.channelId);
    // Join multiple rapid messages with a separator so Claude sees them as distinct parts
    const combined = batch.prompts.length > 1
      ? batch.prompts.join("\n\n---\n\n")
      : batch.prompts[0];
    try {
      await sessionManager.sendMessage(batch.channel, combined, batch.firstMessage);
    } catch (err) {
      console.error("[batch] sendMessage error:", err);
    }
  }, TEXT_BATCH_DELAY_MS);
}
