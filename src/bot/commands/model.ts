import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { getProject } from "../../db/database.js";
import { L } from "../../utils/i18n.js";

export interface ModelChoice {
  id: string; // model ID to pass to Claude Agent SDK (or "default")
  label: string;
  description: string;
}

export const MODEL_CHOICES: ModelChoice[] = [
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Smartest · best for complex reasoning",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Balanced · default for most tasks",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Fastest · cheapest",
  },
  {
    id: "default",
    label: "Default",
    description: "Use Claude Code's default model",
  },
];

export const data = new SlashCommandBuilder()
  .setName("model")
  .setDescription("Switch the Claude model for this channel");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);
  if (!project) {
    await interaction.editReply({
      content: L(
        "This channel is not registered. Use `/register` first.",
        "此频道未注册，请先使用 `/register`。",
      ),
    });
    return;
  }

  const current = project.model ?? "default";

  const options = MODEL_CHOICES.map((m) => ({
    label: m.id === current ? `▶ ${m.label}` : m.label,
    description: m.description,
    value: m.id,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("model-select")
    .setPlaceholder(L("Select a model...", "选择一个模型..."))
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const currentLabel =
    MODEL_CHOICES.find((m) => m.id === current)?.label ?? current;

  await interaction.editReply({
    embeds: [
      {
        title: L("Claude Model", "Claude 模型"),
        description: L(
          `Current model: **${currentLabel}**\n\nSelect a model to switch. Takes effect on the next message.`,
          `当前模型：**${currentLabel}**\n\n选择一个模型以切换。下一条消息生效。`,
        ),
        color: 0x7c3aed,
      },
    ],
    components: [row],
  });
}
