import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { L } from "../../utils/i18n.js";

interface ResumeSessionInfo {
  sessionId: string;
  projectPath: string;
  firstMessage: string;
  timestamp: string;
  fileSize: number;
}

async function getSessionMeta(filePath: string): Promise<{ text: string; timestamp: string; cwd: string }> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let timestamp = "";
  let text = "";
  let cwd = "";

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (!cwd && entry.cwd) cwd = entry.cwd as string;
      if (!timestamp && entry.timestamp) timestamp = entry.timestamp as string;
      if (!text && entry.type === "user" && entry.message?.content) {
        const content = entry.message.content;
        let raw = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) { raw = block.text as string; break; }
          }
        } else if (typeof content === "string") {
          raw = content;
        }
        const cleaned = raw.replace(/<[^>]+>[^<]*<\/[^>]+>/g, "").replace(/<[^>]+>/g, "").trim();
        if (cleaned) text = cleaned;
      }
      if (cwd && timestamp && text) break;
    } catch {}
  }

  rl.close();
  stream.destroy();

  return { text: text || "(empty session)", timestamp, cwd };
}

async function listAllSessions(): Promise<ResumeSessionInfo[]> {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) return [];

  const allSessions: ResumeSessionInfo[] = [];
  const dirs = fs.readdirSync(claudeDir);

  for (const dir of dirs) {
    const dirPath = path.join(claudeDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const jsonlFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    for (const file of jsonlFiles) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat.size < 512) continue;

      const sessionId = file.replace(".jsonl", "");
      const { text, timestamp, cwd } = await getSessionMeta(filePath);
      if (text === "(empty session)" || !cwd) continue;

      allSessions.push({
        sessionId,
        projectPath: cwd,
        firstMessage: text.slice(0, 80),
        timestamp: timestamp || stat.mtime.toISOString(),
        fileSize: stat.size,
      });
    }
  }

  allSessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return allSessions;
}

export const data = new SlashCommandBuilder()
  .setName("resume")
  .setDescription("Resume any Claude Code session from this machine (including CLI-started sessions)");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sessions = await listAllSessions();

  if (sessions.length === 0) {
    await interaction.editReply({
      content: L(
        "No Claude Code sessions found on this machine.",
        "이 머신에서 Claude Code 세션을 찾을 수 없습니다.",
      ),
    });
    return;
  }

  const options = sessions.slice(0, 25).map((s, i) => {
    const date = new Date(s.timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    const timeStr =
      diffMin < 1 ? L("just now", "방금") :
      diffMin < 60 ? L(`${diffMin}m ago`, `${diffMin}분 전`) :
      diffHr < 24 ? L(`${diffHr}h ago`, `${diffHr}시간 전`) :
      diffDay < 7 ? L(`${diffDay}d ago`, `${diffDay}일 전`) :
      date.toLocaleDateString(L("en-US", "ko-KR"), { month: "short", day: "numeric" });

    const projectName = s.projectPath.split(/[\\/]/).pop() || s.projectPath;
    const label = (s.firstMessage.slice(0, 50) || `Session ${i + 1}`);
    const desc = `${projectName} | ${timeStr} | ${s.sessionId.slice(0, 8)}...`;

    return {
      label,
      description: desc.slice(0, 100),
      value: s.sessionId,
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("resume-select")
    .setPlaceholder(L("Select a session to resume...", "재개할 세션을 선택하세요..."))
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    embeds: [
      {
        title: L("Resume Claude Code Session", "Claude Code 세션 재개"),
        description: [
          L(
            `Found **${sessions.length}** session(s) across all projects on this machine.`,
            `이 머신의 모든 프로젝트에서 **${sessions.length}**개의 세션을 찾았습니다.`,
          ),
          "",
          L(
            "Select a session to resume it in this channel. The channel's project will be updated to match.",
            "세션을 선택하면 이 채널에서 재개됩니다. 채널의 프로젝트도 해당 세션의 프로젝트로 업데이트됩니다.",
          ),
        ].join("\n"),
        color: 0x0099ff,
      },
    ],
    components: [row],
  });
}
