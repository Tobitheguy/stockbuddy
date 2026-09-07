import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/auth/password";

/**
 * Generate the two secrets sign-in needs, without either of them touching a
 * file this script writes or a terminal this script echoes.
 *
 * The password is read from stdin rather than argv on purpose: an argument
 * lands in shell history and in the process list, where anything on the
 * machine can read it.
 */

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const password = (await rl.question("Choose a password: ")).trim();
  rl.close();

  if (password.length < 12) {
    console.error(
      "\nToo short. Use at least 12 characters — this is the only thing " +
        "between the open internet and your watchlist.",
    );
    process.exit(1);
  }

  const hash = await hashPassword(password);

  console.log(
    "\nAdd these to .env.local (and to the Vercel project's environment " +
      "variables for the deployed app):\n",
  );
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  if (!process.env.SESSION_SECRET) {
    console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
  }
  console.log(
    "\nThe password itself is not stored anywhere. If you forget it, run " +
      "this again and replace the hash.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
