import { Router, type IRouter } from "express";
import { db, accountsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  sessions,
  createSession,
  submitCode,
  cancelSession,
  runManualRegistration,
} from "../lib/manualRegistrationBot.js";
import { fetchRandomProxy } from "../lib/proxyUtils.js";

const router: IRouter = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

function sessionToJson(s: ReturnType<typeof createSession>) {
  return {
    id: s.id,
    email: s.email,
    password: s.password,
    status: s.status,
    logs: s.logs,
    createdAt: s.createdAt.toISOString(),
    waitingForCode: s.status === "waiting_code",
  };
}

// POST /api/manual/register — start a new manual registration
router.post("/manual/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const session = createSession(email, password || "");

  // Proxy dari GitHub (random), CC dari settings
  const [proxy, ccNumber] = await Promise.all([
    fetchRandomProxy(),
    getSetting("cc_number"),
  ]);

  // Run in background
  runManualRegistration(session, proxy, ccNumber ?? undefined).then(async () => {
    // If success, save to DB
    if (session.status === "success") {
      try {
        await db.insert(accountsTable).values({
          email: session.email,
          password: session.password,
          status: "active",
          notes: "Manual register",
        });
      } catch { }
    }
  });

  res.json(sessionToJson(session));
});

// GET /api/manual/register/:id — poll session status
router.get("/manual/register/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(sessionToJson(session));
});

// POST /api/manual/register/:id/code — submit verification code
router.post("/manual/register/:id/code", (req, res) => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }
  const ok = submitCode(req.params.id, code.toString().trim());
  if (!ok) {
    res.status(400).json({ error: "Session not waiting for code or not found" });
    return;
  }
  res.json({ success: true });
});

// POST /api/manual/register/:id/cancel — cancel session
router.post("/manual/register/:id/cancel", (req, res) => {
  cancelSession(req.params.id);
  const session = sessions.get(req.params.id);
  res.json(session ? sessionToJson(session) : { status: "cancelled" });
});

// GET /api/manual/sessions — list all recent sessions
router.get("/manual/sessions", (_req, res) => {
  const list = Array.from(sessions.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map(sessionToJson);
  res.json(list);
});

export default router;
