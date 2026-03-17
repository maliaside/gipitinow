import app from "./app";
import { startDiscordBot } from "./lib/discordBot.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Start Discord bot hanya pada satu instance (port 8080 = artifact port yang diakses REPLIT_DOMAINS)
// Port 3000 = "Start application" workflow duplikat → jangan start Discord di sana
if (port === 8080) {
  startDiscordBot().catch(e => {
    console.error("[Discord] Gagal start bot:", e.message);
  });
}
