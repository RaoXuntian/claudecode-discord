import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { getProject } from "../../db/database.js";
import { findSessionDir } from "./sessions.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("clear-sessions")
  .setDescription("Delete all Claude Code session files for this project")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L("This channel is not registered to any project. Use `/register` first.", "此频道未注册任何项目，请先使用 `/register`。"),
    });
    return;
  }

  const sessionDir = findSessionDir(project.project_path);
  if (!sessionDir) {
    await interaction.editReply({
      content: L(`No session directory found for \`${project.project_path}\``, `找不到 \`${project.project_path}\` 的会话目录`),
    });
    return;
  }

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) {
    await interaction.editReply({
      content: L("No session files to delete.", "没有可删除的会话文件。"),
    });
    return;
  }

  let deleted = 0;
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(sessionDir, file));
      deleted++;
    } catch {
      // skip files that can't be deleted
    }
  }

  await interaction.editReply({
    embeds: [
      {
        title: L("Sessions Cleared", "会话已清理"),
        description: [
          `Project: \`${project.project_path}\``,
          L(`Deleted **${deleted}** session file(s)`, `已删除 **${deleted}** 个会话文件`),
        ].join("\n"),
        color: 0xff6b6b,
      },
    ],
  });
}
