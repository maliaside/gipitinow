import { Router, type IRouter } from "express";
import { db, accountsTable, proxiesTable, tasksTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/stats", async (_req, res) => {
  const [accountStats] = await db.select({
    total: count(),
    active: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`.mapWith(Number),
    failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.mapWith(Number),
  }).from(accountsTable);

  const [proxyStats] = await db.select({
    total: count(),
    active: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`.mapWith(Number),
  }).from(proxiesTable);

  const [taskStats] = await db.select({
    running: sql<number>`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`.mapWith(Number),
    totalSuccess: sql<number>`COALESCE(SUM(success_count), 0)`.mapWith(Number),
    totalAttempts: sql<number>`COALESCE(SUM(success_count + failed_count), 0)`.mapWith(Number),
  }).from(tasksTable);

  const total = accountStats?.total ?? 0;
  const active = accountStats?.active ?? 0;
  const failed = accountStats?.failed ?? 0;
  const totalProxies = proxyStats?.total ?? 0;
  const activeProxies = proxyStats?.active ?? 0;
  const runningTasks = taskStats?.running ?? 0;
  const totalAttempts = taskStats?.totalAttempts ?? 0;
  const totalSuccess = taskStats?.totalSuccess ?? 0;
  const successRate = totalAttempts > 0 ? (totalSuccess / totalAttempts) * 100 : 0;

  res.json({
    totalAccounts: total,
    activeAccounts: active,
    failedAccounts: failed,
    totalProxies,
    activeProxies,
    runningTasks,
    successRate: Math.round(successRate * 10) / 10,
  });
});

export default router;
