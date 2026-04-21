import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { unregisterProject, getProject } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("unregister")
  .setDescription("Unregister this channel from its project")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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

  // Stop active session if any
  await sessionManager.stopSession(channelId);

  unregisterProject(channelId);

  await interaction.editReply({
    embeds: [
      {
        title: L("Project Unregistered", "项目注册已取消"),
        description: L(`Removed link to \`${project.project_path}\``, `\`${project.project_path}\` 连接已断开`),
        color: 0xff0000,
      },
    ],
  });
}
