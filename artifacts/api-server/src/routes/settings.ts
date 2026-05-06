import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CloudMailClient } from "../lib/cloudMailClient.js";

const router: IRouter = Router();

const SETTING_KEYS = [
  "cloudmail_base_url",
  "cloudmail_admin_email",
  "cloudmail_admin_password",
  "cloudmail_email_password",
  "cloudmail_email_prefix",
  "chatgpt_default_password",
  "cc_number",
];

router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  // Mask passwords in response
  const masked: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    masked[key] = settings[key] || "";
  }
  res.json(masked);
});

router.post("/settings", async (req, res) => {
  const data = req.body as Record<string, string>;
  for (const key of SETTING_KEYS) {
    if (data[key] !== undefined) {
      const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
      if (existing.length > 0) {
        await db.update(settingsTable).set({ value: data[key] }).where(eq(settingsTable.key, key));
      } else {
        await db.insert(settingsTable).values({ key, value: data[key] });
      }
    }
  }
  res.json({ success: true });
});

router.post("/settings/test-cloudmail", async (req, res) => {
  const { baseUrl, adminEmail, adminPassword } = req.body;
  if (!baseUrl || !adminEmail || !adminPassword) {
    res.status(400).json({ success: false, message: "Isi semua field yang diperlukan" });
    return;
  }
  try {
    const client = new CloudMailClient({ baseUrl, adminEmail, adminPassword });
    const ok = await client.testConnection();
    if (ok) {
      res.json({ success: true, message: "Koneksi berhasil! Cloud Mail server normal" });
    } else {
      res.status(400).json({ success: false, message: "Koneksi gagal, periksa konfigurasi" });
    }
  } catch (err: any) {
    res.status(400).json({ success: false, message: `Error koneksi: ${err.message}` });
  }
});

export default router;
