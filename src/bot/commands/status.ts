import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getAllProjects, getSession } from "../../db/database.js";
import { L } from "../../utils/i18n.js";

const STATUS_EMOJI: Record<string, string> = {
  online: "🟢",
  waiting: "🟡",
  idle: "⚪",
  offline: "🔴",
};

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show status of all registered project sessions");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const projects = getAllProjects(guildId);

  if (projects.length === 0) {
    await interaction.editReply({
      content: L("No projects registered. Use `/register` in a channel first.", "没有注册的项目，请先在频道中使用 `/register`。"),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(L("Claude Code Sessions", "Claude Code 会话"))
    .setColor(0x7c3aed)
    .setTimestamp();

  for (const project of projects) {
    const session = getSession(project.channel_id);
    const status = session?.status ?? "offline";
    const emoji = STATUS_EMOJI[status] ?? "🔴";
    const lastActivity = session?.last_activity ?? "never";

    embed.addFields({
      name: `${emoji} <#${project.channel_id}>`,
      value: [
        `\`${project.project_path}\``,
        `${L("Status", "状态")}: **${status}**`,
        `${L("Auto-approve", "自动批准")}: ${project.auto_approve ? L("On", "开启") : L("Off", "关闭")}`,
        `${L("Last activity", "最后活动")}: ${lastActivity}`,
      ].join("\n"),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
