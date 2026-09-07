import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { sendAlertEmailIfConfigured } from "../src/alerts/email";
import { sendDailyDigestIfConfigured } from "../src/alerts/digest";

/**
 * Send pending alerts, and optionally the digest: `npm run alerts [-- --digest]`
 *
 * Production does this inside the cron runs. This exists to verify the email
 * path end to end without waiting for one, and to flush a backlog by hand.
 */
async function main() {
  const a = await sendAlertEmailIfConfigured();
  console.log(
    a.sent > 0
      ? `Alarm-Mail verschickt: ${a.sent} Signal(e)`
      : `Keine Alarm-Mail — ${a.skipped ?? "nichts offen"}`,
  );

  if (process.argv.includes("--digest")) {
    const d = await sendDailyDigestIfConfigured();
    console.log(d.sent ? "Digest verschickt" : `Kein Digest — ${d.skipped}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("send-alerts crashed:", err);
  process.exit(1);
});
