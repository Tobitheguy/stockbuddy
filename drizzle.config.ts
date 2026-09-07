import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so it does not get .env.local loaded for
// it. Load it explicitly, then fall back to .env for CI.
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * `drizzle-kit generate` only reads the schema file and needs no database, so
 * it must work before any key exists — that is the whole point of being able
 * to review the migration at CP2. Only `migrate` and `push` actually connect,
 * and those fail with a clear error from the driver if this placeholder is
 * still in play.
 */
const url =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

if (!process.env.DATABASE_URL) {
  console.warn(
    "[drizzle] DATABASE_URL is not set. `generate` works offline; " +
      "`migrate` and `push` will fail until you paste the Neon pooled " +
      "connection string into .env.local.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // Fail loudly on a destructive change rather than silently dropping a column
  // that holds recorded outcomes.
  strict: true,
  verbose: true,
});
