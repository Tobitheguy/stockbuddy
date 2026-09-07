CREATE TYPE "public"."alert_reason" AS ENUM('rare', 'held_strong');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"reason" "alert_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "alerts_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
CREATE TABLE "earnings_events" (
	"symbol" text NOT NULL,
	"report_date" date NOT NULL,
	"hour" text,
	"eps_estimate" numeric(12, 4),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earnings_events_symbol_report_date_pk" PRIMARY KEY("symbol","report_date")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings_events" ADD CONSTRAINT "earnings_events_symbol_tickers_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at" DESC NULLS LAST);