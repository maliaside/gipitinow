import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import router from "./routes";
import { DatabaseUnavailableError } from "@workspace/db";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof DatabaseUnavailableError) {
    res.status(503).json({
      error: "Database is not available",
      message: "Set DATABASE_URL to enable database features.",
    });
    return;
  }
  console.error("[server]", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
