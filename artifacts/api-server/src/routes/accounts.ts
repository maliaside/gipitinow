import { Router, type IRouter } from "express";
import { db, accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateAccountBody,
  GetAccountParams,
  DeleteAccountParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/accounts", async (_req, res) => {
  const accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
  res.json(accounts.map(a => ({
    id: a.id,
    email: a.email,
    password: a.password,
    status: a.status,
    proxyUsed: a.proxyUsed ?? null,
    notes: a.notes ?? null,
    createdAt: a.createdAt.toISOString(),
  })));
});

router.post("/accounts", async (req, res) => {
  const body = CreateAccountBody.parse(req.body);
  const [account] = await db.insert(accountsTable).values({
    email: body.email,
    password: body.password,
    notes: body.notes ?? null,
    status: "active",
  }).returning();
  res.status(201).json({
    id: account.id,
    email: account.email,
    password: account.password,
    status: account.status,
    proxyUsed: account.proxyUsed ?? null,
    notes: account.notes ?? null,
    createdAt: account.createdAt.toISOString(),
  });
});

router.get("/accounts/export", async (_req, res) => {
  const accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
  const headers = ["id", "email", "password", "status", "proxyUsed", "notes", "createdAt"];
  const rows = accounts.map(a => [
    a.id,
    a.email,
    a.password,
    a.status,
    a.proxyUsed ?? "",
    a.notes ?? "",
    a.createdAt.toISOString(),
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=accounts.csv");
  res.send(csv);
});

router.get("/accounts/:id", async (req, res) => {
  const { id } = GetAccountParams.parse({ id: parseInt(req.params.id) });
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json({
    id: account.id,
    email: account.email,
    password: account.password,
    status: account.status,
    proxyUsed: account.proxyUsed ?? null,
    notes: account.notes ?? null,
    createdAt: account.createdAt.toISOString(),
  });
});

router.delete("/accounts/:id", async (req, res) => {
  const { id } = DeleteAccountParams.parse({ id: parseInt(req.params.id) });
  await db.delete(accountsTable).where(eq(accountsTable.id, id));
  res.status(204).send();
});

export default router;
