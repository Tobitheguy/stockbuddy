CREATE TABLE "ticker_profiles" (
	"symbol" text PRIMARY KEY NOT NULL,
	"industry" text,
	"exchange" text,
	"country" text,
	"website" text,
	"ipo_date" date,
	"market_cap_m" numeric(16, 2),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticker_profiles" ADD CONSTRAINT "ticker_profiles_symbol_tickers_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE cascade ON UPDATE no action;