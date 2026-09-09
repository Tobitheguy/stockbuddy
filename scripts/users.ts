import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createInterface } from "node:readline/promises";
import { listUsers, removeUser, upsertUser } from "../src/auth/users";

/**
 * Account management.
 *
 *   npm run users                       list accounts
 *   npm run users -- add <email>        create or reset, prompts for password
 *   npm run users -- add <email> --no-alerts
 *   npm run users -- remove <email>
 *
 * The password is read from stdin, never from argv: an argument lands in shell
 * history and in the process list, where anything on the machine can read it.
 * It is never printed, and only its scrypt hash is stored.
 */

async function main() {
  const [command, email] = process.argv.slice(2);

  if (!command || command === "list") {
    const rows = await listUsers();
    if (rows.length === 0) {
      console.log(
        "Keine Konten. Anlegen mit:  npm run users -- add name@example.com",
      );
      process.exit(0);
    }
    console.log("KONTEN\n");
    for (const u of rows) {
      console.log(
        `  ${u.email.padEnd(34)}` +
          `${u.receivesAlerts ? "E-Mails: ja " : "E-Mails: nein"}   ` +
          `zuletzt angemeldet: ${
            u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "nie"
          }`,
      );
    }
    process.exit(0);
  }

  if (command === "remove") {
    if (!email) {
      console.error("Nutzung: npm run users -- remove name@example.com");
      process.exit(1);
    }
    const gone = await removeUser(email);
    console.log(gone ? `${email} entfernt.` : `${email} war nicht vorhanden.`);
    process.exit(gone ? 0 : 1);
  }

  if (command !== "add" || !email) {
    console.error(
      "Nutzung:\n" +
        "  npm run users\n" +
        "  npm run users -- add name@example.com [--no-alerts]\n" +
        "  npm run users -- remove name@example.com",
    );
    process.exit(1);
  }

  const receivesAlerts = !process.argv.includes("--no-alerts");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = (await rl.question(`Passwort für ${email}: `)).trim();
  rl.close();

  try {
    const created = await upsertUser(email, password, receivesAlerts);
    console.log(
      `\n${email} ${created ? "angelegt" : "aktualisiert"}. ` +
        `Alarm-E-Mails: ${receivesAlerts ? "ja" : "nein"}.`,
    );
    console.log(
      "Das Passwort wurde nicht gespeichert, nur sein scrypt-Hash. " +
        "Bei Verlust einfach denselben Befehl erneut ausführen.",
    );
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
