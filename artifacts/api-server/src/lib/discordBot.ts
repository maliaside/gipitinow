import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from "discord.js";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startAutoRegistration } from "./autoRegisterBot.js";
import { fetchRandomProxy } from "./proxyUtils.js";

const DISCORD_TOKEN = "";
const APPLICATION_ID = "";

let discordClient: Client | null = null;

/** Kirim DM ke user Discord. Tidak akan throw — hanya log error. */
export async function sendDiscordDM(userId: string, content: string): Promise<void> {
  if (!discordClient?.isReady()) return;
  try {
    const user = await discordClient.users.fetch(userId);
    await user.send(content);
  } catch (e: any) {
    console.error(`[Discord] Gagal kirim DM ke ${userId}:`, e.message);
  }
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}


const COMMANDS = [
  new SlashCommandBuilder()
    .setName("creategpt")
    .setDescription("Buat akun ChatGPT baru secara otomatis dengan payment Korea proxy")
    .toJSON(),
];

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    starting: "⏳ Memulai...",
    navigating: "🌐 Membuka ChatGPT...",
    filling_email: "📧 Mengisi email...",
    waiting_code: "📬 Menunggu OTP email...",
    filling_profile: "👤 Mengisi profil...",
    registered: "✅ Akun terdaftar — memulai payment...",
    paying: "💳 Proses payment Korea...",
    waiting_human_submit: "⏸️ Form siap — tunggu klik Subscribe",
    success: "✅ Selesai",
    failed: "❌ Gagal",
    cancelled: "🚫 Dibatalkan",
  };
  return map[status] ?? `🔄 ${status}`;
}

type Session = Awaited<ReturnType<typeof startAutoRegistration>>;

function buildProgressEmbed(session: Session, elapsed: number): EmbedBuilder {
  const logs = session.logs.slice(-6);
  const logsText = logs
    .map(l => l.replace(/^\[[\d:.]+\] /, ""))
    .join("\n") || "Memulai...";

  const isWaitingHuman = session.status === "waiting_human_submit";
  const vncUrl = (session as any).vncUrl as string | undefined;

  const embed = new EmbedBuilder()
    .setColor(isWaitingHuman ? Colors.Yellow : Colors.Blue)
    .setTitle(isWaitingHuman
      ? "⏸️ Form Payment Siap — Klik Subscribe di VNC!"
      : "🤖 Auto Register ChatGPT — Sedang Berjalan"
    )
    .addFields(
      { name: "Status", value: statusLabel(session.status), inline: true },
      { name: "Waktu", value: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`, inline: true },
      { name: "Email", value: `\`${session.email || "—"}\``, inline: false },
    );

  if (isWaitingHuman) {
    const displayVncUrl = vncUrl ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}/browser.html`;
    embed.addFields({
      name: "🖥️ VNC Browser — Klik Subscribe!",
      value: `**[➡️ Buka VNC Browser](${displayVncUrl})**\n> CC & alamat Korea sudah terisi — tinggal klik Subscribe!`,
      inline: false,
    });
  }

  embed.addFields(
    { name: "Log Terbaru", value: `\`\`\`\n${logsText.slice(0, 800)}\n\`\`\``, inline: false },
  );

  embed.setFooter({ text: `Session ID: ${session.id} • Update setiap 3 detik` })
    .setTimestamp();

  return embed;
}

function buildSuccessEmbed(session: Session, elapsed: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle("✅ Akun ChatGPT Berhasil Dibuat!")
    .addFields(
      { name: "📧 Email", value: `\`${session.email}\``, inline: false },
      { name: "🔑 Password", value: `\`${session.password}\``, inline: false },
      { name: "⏱️ Waktu Total", value: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`, inline: true },
    )
    .setDescription("⚠️ **Akun tidak disimpan ke database** — simpan kredensial ini sekarang! Kamu juga akan mendapat DM.")
    .setTimestamp();
}

function buildFailedEmbed(session: Session, elapsed: number): EmbedBuilder {
  const lastLogs = session.logs
    .slice(-5)
    .map(l => l.replace(/^\[[\d:.]+\] /, ""))
    .join("\n");
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle("❌ Registrasi Gagal")
    .addFields(
      { name: "Email Dicoba", value: `\`${session.email || "—"}\``, inline: false },
      { name: "⏱️ Waktu", value: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`, inline: true },
      { name: "Log Terakhir", value: `\`\`\`\n${lastLogs.slice(0, 800)}\n\`\`\``, inline: false },
    )
    .setFooter({ text: "Coba lagi dengan /createGPT" })
    .setTimestamp();
}

async function handleCreateGPT(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [proxy, ccNumber] = await Promise.all([
    fetchRandomProxy(),
    getSetting("cc_number").catch(() => null),
  ]);
  const cc = ccNumber ?? undefined;

  let session: Session;
  try {
    session = await startAutoRegistration(proxy, cc, false);
    session.discordUserId = interaction.user.id;
  } catch (e: any) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle("❌ Gagal Memulai Registrasi")
          .setDescription(`\`\`\`${e.message}\`\`\``)
          .setFooter({ text: "Coba lagi dalam beberapa menit" })
          .setTimestamp(),
      ],
    });
    return;
  }

  const startTime = Date.now();
  let vncNotified = false;

  await interaction.editReply({ embeds: [buildProgressEmbed(session, 0)] });

  const progressInterval = setInterval(async () => {
    try {
      if (["success", "failed", "cancelled"].includes(session.status)) {
        clearInterval(progressInterval);
        return;
      }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      await interaction.editReply({ embeds: [buildProgressEmbed(session, elapsed)] });
    } catch {
      clearInterval(progressInterval);
    }
  }, 3000);

  // Tunggu sampai selesai (maks 20 menit — extra untuk waiting_human_submit)
  const maxWait = 20 * 60 * 1000;
  while (!["success", "failed", "cancelled"].includes(session.status)) {
    await new Promise(r => setTimeout(r, 3000));

    // Kirim VNC URL segera saat form payment sudah diisi bot
    if (session.status === "waiting_human_submit" && !vncNotified) {
      vncNotified = true;
      const vncDomain = process.env["REPLIT_DOMAINS"] ?? process.env["REPLIT_DEV_DOMAIN"] ?? "localhost";
      const vncUrl = session.vncUrl ?? `https://${vncDomain}/browser.html`;
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Yellow)
            .setTitle("🔐 hCaptcha Muncul — Selesaikan Manual!")
            .setDescription(
              `🤖 **Bot sudah klik Subscribe secara otomatis.**\n` +
              `⚠️ **hCaptcha muncul — perlu diselesaikan manual.**\n\n` +
              `👇 **Buka VNC browser di bawah dan selesaikan captcha:**\n` +
              `## [🖥️ Buka VNC Browser](${vncUrl})\n\n` +
              `> Setelah captcha selesai, bot akan otomatis verifikasi subscription.\n\n` +
              `📧 Akun: \`${session.email}\``
            )
            .setFooter({ text: "Selesaikan captcha dalam 10 menit sebelum session habis" })
            .setTimestamp(),
        ],
      }).catch(() => {});
    }

    if (Date.now() - startTime > maxWait) {
      session.status = "failed";
      session.logs.push("[Discord] ❌ Timeout 20 menit — dihentikan");
      break;
    }
  }

  clearInterval(progressInterval);

  const elapsed = Math.floor((Date.now() - startTime) / 1000);

  if (session.status === "success") {
    await interaction.editReply({ embeds: [buildSuccessEmbed(session, elapsed)] });

    // Kirim DM sebagai backup
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle("🔐 Kredensial Akun ChatGPT Kamu")
        .addFields(
          { name: "📧 Email", value: `\`${session.email}\``, inline: false },
          { name: "🔑 Password", value: `\`${session.password}\``, inline: false },
        )
        .setDescription("Simpan ini sekarang — akun **tidak disimpan** di database!")
        .setTimestamp();
      if ((session as any).vncUrl) {
        dmEmbed.addFields({ name: "🖥️ VNC Browser", value: (session as any).vncUrl, inline: false });
      }
      await interaction.user.send({ embeds: [dmEmbed] });
    } catch {
      // DM dinonaktifkan — tidak masalah, hasil ada di ephemeral reply
    }
  } else {
    await interaction.editReply({ embeds: [buildFailedEmbed(session, elapsed)] });
  }
}

export async function startDiscordBot(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: COMMANDS });
    console.log("[Discord] Slash commands registered ✅");
  } catch (e: any) {
    console.error("[Discord] Gagal register slash commands:", e.message);
  }

  discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  const client = discordClient;

  client.on("clientReady", (c) => {
    console.log(`[Discord] Bot online: ${c.user.tag} ✅`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "creategpt") {
      // Tangani setiap request secara independen (concurrent)
      handleCreateGPT(interaction as ChatInputCommandInteraction).catch(e =>
        console.error(`[Discord] Error sesi ${interaction.id}:`, e.message)
      );
    }
  });

  client.on("error", (e) => {
    console.error("[Discord] Client error:", e.message);
  });

  client.login(DISCORD_TOKEN).catch(e => {
    console.error("[Discord] Login gagal:", e.message);
  });
}
