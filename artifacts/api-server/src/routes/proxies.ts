import { Router, type IRouter } from "express";
import { db, proxiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AddProxyBody,
  DeleteProxyParams,
  AddProxiesBatchBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/proxies", async (_req, res) => {
  const proxies = await db.select().from(proxiesTable).orderBy(proxiesTable.id);
  res.json(proxies.map(p => ({
    id: p.id,
    host: p.host,
    port: p.port,
    username: p.username ?? null,
    password: p.password ?? null,
    protocol: p.protocol,
    status: p.status,
    lastChecked: p.lastChecked ? p.lastChecked.toISOString() : null,
  })));
});

router.post("/proxies", async (req, res) => {
  const body = AddProxyBody.parse(req.body);
  const [proxy] = await db.insert(proxiesTable).values({
    host: body.host,
    port: body.port,
    username: body.username ?? null,
    password: body.password ?? null,
    protocol: body.protocol,
    status: "untested",
  }).returning();
  res.status(201).json({
    id: proxy.id,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username ?? null,
    password: proxy.password ?? null,
    protocol: proxy.protocol,
    status: proxy.status,
    lastChecked: proxy.lastChecked ? proxy.lastChecked.toISOString() : null,
  });
});

router.post("/proxies/batch", async (req, res) => {
  const body = AddProxiesBatchBody.parse(req.body);
  let added = 0;
  let failed = 0;
  for (const proxyStr of body.proxies) {
    try {
      const parts = proxyStr.trim().split(":");
      if (parts.length < 2) { failed++; continue; }
      const host = parts[0];
      const port = parseInt(parts[1]);
      if (!host || isNaN(port)) { failed++; continue; }
      const username = parts[2] ?? null;
      const password = parts[3] ?? null;
      await db.insert(proxiesTable).values({
        host,
        port,
        username,
        password,
        protocol: "http",
        status: "untested",
      });
      added++;
    } catch {
      failed++;
    }
  }
  res.status(201).json({ added, failed });
});

router.delete("/proxies/:id", async (req, res) => {
  const { id } = DeleteProxyParams.parse({ id: parseInt(req.params.id) });
  await db.delete(proxiesTable).where(eq(proxiesTable.id, id));
  res.status(204).send();
});

export default router;
