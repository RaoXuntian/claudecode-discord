import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { getProject, setAutoApprove } from "../../db/database.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("auto-approve")
  .setDescription("Toggle auto-approve mode for tool use in this channel")
  .addStringOption((opt) =>
    opt
      .setName("mode")
      .setDescription("on or off")
      .setRequired(true)
      .addChoices(
        { name: "on", value: "on" },
        { name: "off", value: "off" },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const mode = interaction.options.getString("mode", true);
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L("This channel is not registered to any project.", "此频道未注册任何项目。"),
    });
    return;
  }

  const enabled = mode === "on";
  setAutoApprove(channelId, enabled);

  await interaction.editReply({
    embeds: [
      {
        title: L(`Auto-approve: ${enabled ? "ON" : "OFF"}`, `自动批准：${enabled ? "开启" : "关闭"}`),
        description: enabled
          ? L("Claude will automatically approve all tool uses (Edit, Write, Bash, etc.)", "Claude 将自动批准所有工具使用（Edit、Write、Bash 等）")
          : L("Claude will ask for approval before using tools", "Claude 在使用工具前将请求批准"),
        color: enabled ? 0x00ff00 : 0xff6600,
      },
    ],
  });
}
