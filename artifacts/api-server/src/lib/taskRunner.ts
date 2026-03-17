import { db, tasksTable, accountsTable, proxiesTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { RegistrationBot } from "./registrationBot.js";
import { fetchRandomProxy } from "./proxyUtils.js";

const activeRunners = new Map<number, RegistrationBot>();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function getActiveProxy() {
  const proxies = await db.select().from(proxiesTable).where(eq(proxiesTable.status, "active"));
  if (proxies.length === 0) return null;
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  return {
    server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
    username: proxy.username ?? undefined,
    password: proxy.password ?? undefined,
  };
}

export async function runTask(taskId: number): Promise<void> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task || task.status !== "running") return;

  const cloudMailBaseUrl = await getSetting("cloudmail_base_url");
  const cloudMailAdminEmail = await getSetting("cloudmail_admin_email");
  const cloudMailAdminPassword = await getSetting("cloudmail_admin_password");
  const cloudMailEmailPassword = await getSetting("cloudmail_email_password");
  const cloudMailEmailPrefix = await getSetting("cloudmail_email_prefix");
  const chatgptPassword = await getSetting("chatgpt_default_password");
  const ccNumber = await getSetting("cc_number");

  if (!cloudMailBaseUrl || !cloudMailAdminEmail || !cloudMailAdminPassword || !cloudMailEmailPassword) {
    await appendLog(taskId, "[Error] Cloud Mail belum dikonfigurasi — silakan atur di halaman Settings");
    await db.update(tasksTable).set({ status: "failed" }).where(eq(tasksTable.id, taskId));
    return;
  }

  const bot = new RegistrationBot();
  activeRunners.set(taskId, bot);
  bot.setLogCallback(async (msg: string) => { await appendLog(taskId, msg); });

  while (true) {
    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
    if (!current || current.status !== "running") break;
    if (current.successCount + current.failedCount >= current.totalAccounts) break;

    // Use active proxy from DB, or fallback to GitHub proxy list
    let proxy = current.useProxy ? await getActiveProxy() : null;
    if (!proxy) {
      const ghProxy = await fetchRandomProxy();
      if (ghProxy) {
        proxy = {
          server: ghProxy.server,
          username: ghProxy.username ?? undefined,
          password: ghProxy.password ?? undefined,
        };
      }
    }

    try {
      const result = await bot.register({
        cloudMail: {
          baseUrl: cloudMailBaseUrl,
          adminEmail: cloudMailAdminEmail,
          adminPassword: cloudMailAdminPassword,
          emailPassword: cloudMailEmailPassword,
          emailPrefix: cloudMailEmailPrefix ?? undefined,
        },
        chatgptPassword: chatgptPassword ?? undefined,
        ccNumber: ccNumber ?? undefined,
        proxy: proxy ?? undefined,
        headless: true,
      });

      if (result.success) {
        try {
          await db.insert(accountsTable).values({
            email: result.email,
            password: result.chatgptPassword,
            status: "active",
            proxyUsed: result.proxyUsed !== "none" ? result.proxyUsed : null,
            notes: `${result.firstName} ${result.lastName}, DOB: ${result.birthday}`,
          });
        } catch { }
        await db.update(tasksTable).set({
          successCount: sql`${tasksTable.successCount} + 1`,
        }).where(eq(tasksTable.id, taskId));
      } else {
        await db.update(tasksTable).set({
          failedCount: sql`${tasksTable.failedCount} + 1`,
        }).where(eq(tasksTable.id, taskId));
      }
    } catch (err: any) {
      await appendLog(taskId, `[Exception] ${err.message}`);
      await db.update(tasksTable).set({
        failedCount: sql`${tasksTable.failedCount} + 1`,
      }).where(eq(tasksTable.id, taskId));
    }

    // Brief pause between registrations
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
  }

  // Mark task completed
  const [final] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (final && final.status === "running") {
    await db.update(tasksTable).set({
      status: "completed",
      completedAt: new Date(),
    }).where(eq(tasksTable.id, taskId));
    await appendLog(taskId, `[Selesai] Task selesai! ✅ Sukses: ${final.successCount} | ❌ Gagal: ${final.failedCount}`);
  }

  activeRunners.delete(taskId);
}

async function appendLog(taskId: number, msg: string) {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) return;
  const logs = (task.logs as string[]) ?? [];
  const trimmed = logs.length > 500 ? logs.slice(-499) : logs;
  await db.update(tasksTable).set({
    logs: [...trimmed, `[${new Date().toISOString()}] ${msg}`],
  }).where(eq(tasksTable.id, taskId));
}

export function stopTask(taskId: number) {
  const bot = activeRunners.get(taskId);
  if (bot) {
    bot.cancel();
    activeRunners.delete(taskId);
  }
}

export function isRunning(taskId: number): boolean {
  return activeRunners.has(taskId);
}
