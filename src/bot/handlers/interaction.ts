import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { isAllowedUser } from "../../security/guard.js";
import { sessionManager } from "../../claude/session-manager.js";
import { upsertSession, getProject, getSession, registerProject } from "../../db/database.js";
import { findSessionDir, getLastAssistantMessage, findProjectPathBySessionId } from "../commands/sessions.js";
import { L } from "../../utils/i18n.js";

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!isAllowedUser(interaction.user.id)) {
    await interaction.reply({
      content: L("You are not authorized.", "您没有权限执行此操作。"),
      ephemeral: true,
    });
    return;
  }

  const customId = interaction.customId;
  // Use split with limit to handle session IDs that might contain colons
  const colonIndex = customId.indexOf(":");
  const action = colonIndex === -1 ? customId : customId.slice(0, colonIndex);
  const requestId = colonIndex === -1 ? "" : customId.slice(colonIndex + 1);

  if (!requestId) {
    await interaction.reply({
      content: L("Invalid button interaction.", "无效的按钮交互。"),
      ephemeral: true,
    });
    return;
  }

  // Handle stop button
  if (action === "stop") {
    const channelId = requestId;
    const stopped = await sessionManager.stopSession(channelId);
    await interaction.update({
      content: L("⏹️ Task has been stopped.", "⏹️ 任务已停止。"),
      components: [],
    });
    if (!stopped) {
      await interaction.followUp({
        content: L("No active session.", "没有活动的会话。"),
        ephemeral: true,
      });
    }
    return;
  }

  // Handle queue confirmation
  if (action === "queue-yes") {
    const channelId = requestId;
    const confirmed = sessionManager.confirmQueue(channelId);
    if (!confirmed) {
      await interaction.update({
        content: L("⏳ Queue request has expired.", "⏳ 队列请求已过期。"),
        components: [],
      });
      return;
    }
    const queueSize = sessionManager.getQueueSize(channelId);
    await interaction.update({
      content: L(`📨 Message added to queue (${queueSize}/5). It will be processed after the current task.`, `📨 消息已加入队列（${queueSize}/5），将在当前任务完成后自动处理。`),
      components: [],
    });
    return;
  }

  // Handle queue cancellation
  if (action === "queue-no") {
    const channelId = requestId;
    sessionManager.cancelQueue(channelId);
    await interaction.update({
      content: L("Cancelled.", "已取消。"),
      components: [],
    });
    return;
  }

  // Handle session resume button
  if (action === "session-resume") {
    const sessionId = requestId;
    const channelId = interaction.channelId;
    const { randomUUID } = await import("node:crypto");
    upsertSession(randomUUID(), channelId, sessionId, "idle");

    await interaction.update({
      embeds: [
        {
          title: L("Session Resumed", "会话已恢复"),
          description: L(
            `Session: \`${sessionId.slice(0, 8)}...\`\n\nNext message you send will resume this conversation.`,
            `会话：\`${sessionId.slice(0, 8)}...\`\n\n下一条消息起将继续此对话。`
          ),
          color: 0x00ff00,
        },
      ],
      components: [],
    });
    return;
  }

  // Handle session cancel button
  if (action === "session-cancel") {
    await interaction.update({
      content: L("Cancelled.", "已取消。"),
      embeds: [],
      components: [],
    });
    return;
  }

  // Handle AskUserQuestion option selection
  if (action === "ask-opt") {
    // requestId format: "uuid:optionIndex"
    const lastColon = requestId.lastIndexOf(":");
    const actualRequestId = requestId.slice(0, lastColon);
    const selectedLabel = ("label" in interaction.component ? interaction.component.label : null) ?? "Unknown";

    const resolved = sessionManager.resolveQuestion(actualRequestId, selectedLabel);
    if (!resolved) {
      await interaction.reply({ content: L("This question has expired.", "此问题已过期。"), ephemeral: true });
      return;
    }

    await interaction.update({
      content: L(`✅ Selected: **${selectedLabel}**`, `✅ 已选择：**${selectedLabel}**`),
      embeds: [],
      components: [],
    });
    return;
  }

  // Handle AskUserQuestion custom text input
  if (action === "ask-other") {
    sessionManager.enableCustomInput(requestId, interaction.channelId);

    await interaction.update({
      content: L("✏️ Type your answer...", "✏️ 请输入您的回答..."),
      embeds: [],
      components: [],
    });
    return;
  }

  // Handle queue clear button
  if (action === "queue-clear") {
    const channelId = requestId;
    const cleared = sessionManager.clearQueue(channelId);
    await interaction.update({
      embeds: [
        {
          title: L("Queue Cleared", "队列已清空"),
          description: L(
            `Cleared ${cleared} queued message(s).`,
            `已取消 ${cleared} 条等待中的消息。`
          ),
          color: 0xff6600,
        },
      ],
      components: [],
    });
    return;
  }

  // Handle queue remove individual item button
  if (action === "queue-remove") {
    // requestId format: "channelId:index"
    const lastColon = requestId.lastIndexOf(":");
    const channelId = requestId.slice(0, lastColon);
    const index = parseInt(requestId.slice(lastColon + 1), 10);
    const removed = sessionManager.removeFromQueue(channelId, index);

    if (!removed) {
      await interaction.update({
        content: L("This item is no longer in the queue.", "此消息已不在队列中。"),
        embeds: [],
        components: [],
      });
      return;
    }

    const preview = removed.length > 60 ? removed.slice(0, 60) + "…" : removed;

    // Show updated queue
    const queue = sessionManager.getQueue(channelId);
    if (queue.length === 0) {
      await interaction.update({
        embeds: [
          {
            title: L("Message Removed", "消息已取消"),
            description: L(`Removed: ${preview}\n\nQueue is now empty.`, `已取消：${preview}\n\n队列已清空。`),
            color: 0xff6600,
          },
        ],
        components: [],
      });
      return;
    }

    // Rebuild list and buttons with updated queue
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
    const list = queue
      .map((item: { prompt: string }, idx: number) => {
        const p = item.prompt.length > 100 ? item.prompt.slice(0, 100) + "…" : item.prompt;
        return `**${idx + 1}.** ${p}`;
      })
      .join("\n\n");

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const itemButtons = queue.map((_: unknown, idx: number) =>
      new ButtonBuilder()
        .setCustomId(`queue-remove:${channelId}:${idx}`)
        .setLabel(`❌ ${idx + 1}`)
        .setStyle(ButtonStyle.Secondary)
    );
    const clearButton = new ButtonBuilder()
      .setCustomId(`queue-clear:${channelId}`)
      .setLabel(L("Clear All", "全部取消"))
      .setStyle(ButtonStyle.Danger);

    const allButtons = [...itemButtons.slice(0, 19), clearButton];
    for (let i = 0; i < allButtons.length; i += 5) {
      const chunk = allButtons.slice(i, i + 5);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...chunk));
    }

    await interaction.update({
      embeds: [
        {
          title: L(
            `📋 Message Queue (${queue.length})`,
            `📋 消息队列（${queue.length} 条）`
          ),
          description: `~~${preview}~~ ${L("removed", "已取消")}\n\n${list}`,
          color: 0x5865f2,
        },
      ],
      components: rows,
    });
    return;
  }

  // Handle session delete button
  if (action === "session-delete") {
    const sessionId = requestId;
    const channelId = interaction.channelId;
    const project = getProject(channelId);

    if (!project) {
      await interaction.update({
        content: L("Project not found.", "找不到项目。"),
        embeds: [],
        components: [],
      });
      return;
    }

    const sessionDir = findSessionDir(project.project_path);
    if (sessionDir) {
      const filePath = path.join(sessionDir, `${sessionId}.jsonl`);
      try {
        fs.unlinkSync(filePath);

        // If deleting the currently active session, reset DB so next message creates fresh session
        const dbSession = getSession(channelId);
        if (dbSession?.session_id === sessionId) {
          const { randomUUID } = await import("node:crypto");
          upsertSession(randomUUID(), channelId, null, "idle");
        }

        await interaction.update({
          embeds: [
            {
              title: L("Session Deleted", "会话已删除"),
              description: L(
                `Session \`${sessionId.slice(0, 8)}...\` has been deleted.\nYour next message will start a new conversation.`,
                `会话 \`${sessionId.slice(0, 8)}...\` 已删除。\n下一条消息起将开始新对话。`
              ),
              color: 0xff6b6b,
            },
          ],
          components: [],
        });
      } catch {
        await interaction.update({
          content: L("Failed to delete session file.", "会话文件删除失败。"),
          embeds: [],
          components: [],
        });
      }
    }
    return;
  }

  let decision: "approve" | "deny" | "approve-all";
  if (action === "approve") {
    decision = "approve";
  } else if (action === "deny") {
    decision = "deny";
  } else if (action === "approve-all") {
    decision = "approve-all";
  } else {
    return;
  }

  const resolved = sessionManager.resolveApproval(requestId, decision);
  if (!resolved) {
    await interaction.reply({
      content: L("This approval request has expired.", "此审批请求已过期。"),
      ephemeral: true,
    });
    return;
  }

  const labels: Record<string, string> = {
    approve: L("✅ Approved", "✅ 已批准"),
    deny: L("❌ Denied", "❌ 已拒绝"),
    "approve-all": L("⚡ Auto-approve enabled for this channel", "⚡ 已为此频道启用自动批准"),
  };

  await interaction.update({
    content: labels[decision],
    components: [], // remove buttons
  });
}

export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!isAllowedUser(interaction.user.id)) {
    await interaction.reply({
      content: L("You are not authorized.", "您没有权限执行此操作。"),
      ephemeral: true,
    });
    return;
  }

  // Handle AskUserQuestion multi-select
  if (interaction.customId.startsWith("ask-select:")) {
    const askRequestId = interaction.customId.slice("ask-select:".length);
    const options = (interaction.component as any).options ?? [];
    const selectedLabels = interaction.values.map((val: string) => {
      const opt = options.find((o: any) => o.value === val);
      return opt?.label ?? val;
    });
    const answer = selectedLabels.join(", ");

    const resolved = sessionManager.resolveQuestion(askRequestId, answer);
    if (!resolved) {
      await interaction.reply({ content: L("This question has expired.", "此问题已过期。"), ephemeral: true });
      return;
    }

    await interaction.update({
      content: L(`✅ Selected: **${answer}**`, `✅ 已选择：**${answer}**`),
      embeds: [],
      components: [],
    });
    return;
  }

  if (interaction.customId === "resume-select") {
    const sessionId = interaction.values[0];
    const projectPath = findProjectPathBySessionId(sessionId);

    if (!projectPath) {
      await interaction.reply({
        content: L("Session not found. It may have been deleted.", "找不到会话，可能已被删除。"),
        flags: ["Ephemeral"],
      });
      return;
    }

    const channelId = interaction.channelId;
    const guildId = interaction.guildId ?? "dm";

    registerProject(channelId, projectPath, guildId);
    const { randomUUID } = await import("node:crypto");
    upsertSession(randomUUID(), channelId, sessionId, "idle");

    const projectName = projectPath.split(/[\\/]/).pop() || projectPath;
    await interaction.reply({
      content: L(
        `✅ Switched to \`${projectName}\` (\`${projectPath}\`). Session \`${sessionId.slice(0, 8)}...\` will resume on your next message.`,
        `✅ 已切换到 \`${projectName}\` (\`${projectPath}\`)。下一条消息起将恢复会话 \`${sessionId.slice(0, 8)}...\`。`,
      ),
      flags: ["Ephemeral"],
    });
    return;
  }

  if (interaction.customId === "session-select") {
    const selectedSessionId = interaction.values[0];

    // Handle "New Session" option
    if (selectedSessionId === "__new_session__") {
      const channelId = interaction.channelId;
      const { randomUUID } = await import("node:crypto");
      // Set session_id to null so next message creates a fresh session
      upsertSession(randomUUID(), channelId, null, "idle");

      await interaction.update({
        embeds: [
          {
            title: L("✨ New Session", "✨ 新会话"),
            description: L("New session is ready.\nA new conversation will start from your next message.", "新会话已准备好。\n下一条消息起将开始新对话。"),
            color: 0x00ff00,
          },
        ],
        components: [],
      });
      return;
    }

    // Defer first to avoid 3s timeout while reading JSONL
    await interaction.deferUpdate();

    // Read last assistant message from session file
    const channelId = interaction.channelId;
    const project = getProject(channelId);
    let lastMessage = "";
    if (project) {
      const sessionDir = findSessionDir(project.project_path);
      if (sessionDir) {
        const filePath = path.join(sessionDir, `${selectedSessionId}.jsonl`);
        try {
          lastMessage = await getLastAssistantMessage(filePath);
        } catch {
          // ignore
        }
      }
    }

    // Show Resume / Delete buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`session-resume:${selectedSessionId}`)
        .setLabel(L("Resume", "恢复"))
        .setStyle(ButtonStyle.Success)
        .setEmoji("▶️"),
      new ButtonBuilder()
        .setCustomId(`session-delete:${selectedSessionId}`)
        .setLabel(L("Delete", "删除"))
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
      new ButtonBuilder()
        .setCustomId(`session-cancel:_`)
        .setLabel(L("Cancel", "取消"))
        .setStyle(ButtonStyle.Secondary),
    );

    const preview = lastMessage && lastMessage !== "(no message)"
      ? `\n\n${L("**Last conversation:**", "**上次对话：**")}\n${lastMessage.slice(0, 300)}${lastMessage.length > 300 ? "..." : ""}`
      : "";

    await interaction.editReply({
      embeds: [
        {
          title: L("Session Selected", "已选择会话"),
          description: L(`Session: \`${selectedSessionId.slice(0, 8)}...\`\n\nResume or delete this session?`, `会话：\`${selectedSessionId.slice(0, 8)}...\`\n\n恢复还是删除此会话？`) + preview,
          color: 0x7c3aed,
        },
      ],
      components: [row],
    });
  }
}
