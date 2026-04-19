import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { getProject } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop the active Claude Code session in this channel");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L("This channel is not registered to any project.", "此频道未注册任何项目。"),
    });
    return;
  }

  const stopped = await sessionManager.stopSession(channelId);
  if (stopped) {
    await interaction.editReply({
      embeds: [
        {
          title: L("Session Stopped", "会话已停止"),
          description: L(`Stopped Claude Code session for \`${project.project_path}\``, `\`${project.project_path}\` Claude Code 会话已停止`),
          color: 0xff6600,
        },
      ],
    });
  } else {
    await interaction.editReply({
      content: L("No active session in this channel.", "此频道没有活动的会话。"),
    });
  }
}
