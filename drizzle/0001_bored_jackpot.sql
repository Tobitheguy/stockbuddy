ALTER TABLE "tickers" ADD COLUMN "cik" text;--> statement-breakpoint
CREATE INDEX "tickers_cik_idx" ON "tickers" USING btree ("cik");