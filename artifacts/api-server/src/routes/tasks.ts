import { Router, type IRouter } from "express";
import { db, tasksTable, accountsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runTask, stopTask } from "../lib/taskRunner.js";
import {
  CreateTaskBody,
  GetTaskParams,
  DeleteTaskParams,
  StartTaskParams,
  StopTaskParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function formatTask(t: typeof tasksTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    totalAccounts: t.totalAccounts,
    successCount: t.successCount,
    failedCount: t.failedCount,
    useProxy: t.useProxy,
    emailDomain: t.emailDomain ?? null,
    logs: (t.logs as string[]) ?? [],
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
  };
}

router.get("/tasks", async (_req, res) => {
  const tasks = await db.select().from(tasksTable).orderBy(tasksTable.createdAt);
  res.json(tasks.map(formatTask));
});

router.post("/tasks", async (req, res) => {
  const body = CreateTaskBody.parse(req.body);
  const [task] = await db.insert(tasksTable).values({
    name: body.name,
    totalAccounts: body.totalAccounts,
    useProxy: body.useProxy,
    emailDomain: body.emailDomain ?? null,
    status: "idle",
  }).returning();
  res.status(201).json(formatTask(task));
});

router.get("/tasks/:id", async (req, res) => {
  const { id } = GetTaskParams.parse({ id: parseInt(req.params.id) });
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(formatTask(task));
});

router.post("/tasks/:id/start", async (req, res) => {
  const { id } = StartTaskParams.parse({ id: parseInt(req.params.id) });
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) return res.status(404).json({ error: "Task not found" });

  await db.update(tasksTable).set({
    status: "running",
    startedAt: new Date(),
    logs: [],
  }).where(eq(tasksTable.id, id));

  // Run the real bot in the background
  runTask(id).catch(async (err) => {
    console.error(`Task ${id} failed:`, err);
    await db.update(tasksTable).set({ status: "failed" }).where(eq(tasksTable.id, id));
  });

  const [updated] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  res.json(formatTask(updated));
});

router.post("/tasks/:id/stop", async (req, res) => {
  const { id } = StopTaskParams.parse({ id: parseInt(req.params.id) });
  stopTask(id);
  await db.update(tasksTable).set({ status: "paused" }).where(eq(tasksTable.id, id));
  const [updated] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  res.json(formatTask(updated));
});

router.delete("/tasks/:id", async (req, res) => {
  const { id } = DeleteTaskParams.parse({ id: parseInt(req.params.id) });
  stopTask(id);
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
});

export default router;
