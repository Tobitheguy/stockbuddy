import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { SESSION_COOKIE, signSession } from "../src/auth/session";

/**
 * Print a valid session cookie for local testing: `npm run dev-session`
 *
 * Only useful against a server that shares this SESSION_SECRET, so this cannot
 * mint access to the deployed app from a developer machine.
 */
signSession().then((value) => {
  console.log(`${SESSION_COOKIE}=${value}`);
  process.exit(0);
});
