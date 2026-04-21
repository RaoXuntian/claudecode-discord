import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import path from "node:path";
import { getProject, getSession } from "../../db/database.js";
import { findSessionDir, getLastAssistantMessageFull } from "./sessions.js";
import { splitMessage } from "../../claude/output-formatter.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("last")
  .setDescription("Show the last Claude response from the current session");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L("This channel is not registered to any project. Use `/register` first.", "此频道未注册项目，请先使用 `/register`。"),
    });
    return;
  }

  const session = getSession(channelId);
  if (!session?.session_id) {
    await interaction.editReply({
      content: L("No active session. Select a session from `/sessions`.", "没有活动的会话，请使用 `/sessions` 选择一个。"),
    });
    return;
  }

  const sessionDir = findSessionDir(project.project_path);
  if (!sessionDir) {
    await interaction.editReply({
      content: L("Session directory not found.", "找不到会话目录。"),
    });
    return;
  }

  const filePath = path.join(sessionDir, `${session.session_id}.jsonl`);

  let lastMessage: string;
  try {
    lastMessage = await getLastAssistantMessageFull(filePath);
  } catch {
    await interaction.editReply({
      content: L("Cannot read session file.", "无法读取会话文件。"),
    });
    return;
  }

  if (lastMessage === "(no message)") {
    await interaction.editReply({
      content: L("No Claude response in this session.", "此会话中没有 Claude 的回复。"),
    });
    return;
  }

  // Split into Discord-safe chunks
  const chunks = splitMessage(lastMessage);

  await interaction.editReply({ content: chunks[0] });

  // Send remaining chunks as follow-ups
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({ content: chunks[i] });
  }
}
