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
import { getProject, getSession } from "../../db/database.js";

interface SessionInfo {
  sessionId: string;
  firstMessage: string;
  timestamp: string;
  fileSize: number;
}

/**
 * Find the Claude session directory for a given project path.
 * Claude Code stores sessions in ~/.claude/projects/<encoded-path>/
 * The encoding isn't just simple "/" -> "-" replacement (also replaces "_" etc.)
 * So we find the correct directory by checking JSONL file contents.
 */
export function findSessionDir(projectPath: string): string | null {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) return null;

  // Try simple conversion first (Claude Code encodes / and _ as -)
  const simpleName = projectPath.replace(/[\\/\_]/g, "-");
  const simplePath = path.join(claudeDir, simpleName);
  if (fs.existsSync(simplePath)) return simplePath;

  // Fallback: scan directories and match by reading JSONL cwd field
  const dirs = fs.readdirSync(claudeDir);
  for (const dir of dirs) {
    const dirPath = path.join(claudeDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const jsonlFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) continue;

    // Read first few lines of the first JSONL to check cwd
    const firstFile = path.join(dirPath, jsonlFiles[0]);
    const content = fs.readFileSync(firstFile, { encoding: "utf-8" });
    const lines = content.split("\n").slice(0, 10);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.cwd === projectPath) return dirPath;
      } catch {
        // skip
      }
    }
  }

  return null;
}

/**
 * Read the first user message from a JSONL session file.
 */
async function getFirstUserMessage(filePath: string): Promise<{ text: string; timestamp: string }> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let timestamp = "";
  let text = "";

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);

      // Grab timestamp from first line
      if (!timestamp && entry.timestamp) {
        timestamp = entry.timestamp;
      }

      // Find first user message with real text content (skip IDE-injected tags)
      if (entry.type === "user" && entry.message?.content) {
        const content = entry.message.content;
        let raw = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              raw = block.text;
              break;
            }
          }
        } else if (typeof content === "string") {
          raw = content;
        }
        // Strip system/IDE tags like <ide_opened_file>...</ide_opened_file>, <system-reminder>...
        const cleaned = raw.replace(/<[^>]+>[^<]*<\/[^>]+>/g, "").replace(/<[^>]+>/g, "").trim();
        if (cleaned) {
          text = cleaned;
          break;
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  rl.close();
  stream.destroy();

  return { text: text || "(empty session)", timestamp };
}

/**
 * List all session JSONL files for a given project path.
 */
async function listSessions(projectPath: string): Promise<SessionInfo[]> {
  const sessionDir = findSessionDir(projectPath);
  if (!sessionDir) return [];

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const stat = fs.statSync(filePath);

    // Skip very small files (likely empty/abandoned sessions)
    if (stat.size < 512) continue;

    const sessionId = file.replace(".jsonl", "");
    const { text } = await getFirstUserMessage(filePath);

    // Skip sessions with no actual user message
    if (text === "(empty session)") continue;

    sessions.push({
      sessionId,
      firstMessage: text.slice(0, 80),
      timestamp: stat.mtime.toISOString(),
      fileSize: stat.size,
    });
  }

  // Sort by most recent first
  sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return sessions;
}

export const data = new SlashCommandBuilder()
  .setName("sessions")
  .setDescription("List and resume existing Claude Code sessions for this project");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: "This channel is not registered to any project. Use `/register` first.",
    });
    return;
  }

  const sessions = await listSessions(project.project_path);

  if (sessions.length === 0) {
    await interaction.editReply({
      content: `No existing sessions found for \`${project.project_path}\``,
    });
    return;
  }

  // Check currently active session for this channel
  const dbSession = getSession(channelId);
  const activeSessionId = dbSession?.session_id ?? null;

  // Build select menu (max 25 options)
  const options = sessions.slice(0, 25).map((s, i) => {
    const date = new Date(s.timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    const timeStr =
      diffMin < 1 ? "방금" :
      diffMin < 60 ? `${diffMin}분 전` :
      diffHr < 24 ? `${diffHr}시간 전` :
      diffDay < 7 ? `${diffDay}일 전` :
      date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });

    const sizeKB = Math.round(s.fileSize / 1024);
    const isActive = s.sessionId === activeSessionId;
    const label = isActive
      ? `▶ ${s.firstMessage.slice(0, 48)}`
      : s.firstMessage.slice(0, 50) || `Session ${i + 1}`;
    const desc = isActive
      ? `사용 중 | ${timeStr} | ${sizeKB}KB`
      : `${timeStr} | ${sizeKB}KB | ${s.sessionId.slice(0, 8)}...`;

    return {
      label,
      description: desc.slice(0, 100),
      value: s.sessionId,
      default: isActive,
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("session-select")
    .setPlaceholder("Select a session to resume...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    embeds: [
      {
        title: "Claude Code Sessions",
        description: [
          `Project: \`${project.project_path}\``,
          `Found **${sessions.length}** session(s)`,
          "",
          "Select a session below to resume or delete it.",
        ].join("\n"),
        color: 0x7c3aed,
      },
    ],
    components: [row],
  });
}
