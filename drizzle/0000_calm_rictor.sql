CREATE TYPE "public"."direction" AS ENUM('bullish', 'bearish', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('earnings', 'guidance', 'M&A', 'contract_win', 'product_launch', 'regulatory_policy', 'macro', 'legal', 'management_change', 'capital_raise', 'insider_trade', 'other');--> statement-breakpoint
CREATE TYPE "public"."horizon" AS ENUM('days', 'weeks', 'months');--> statement-breakpoint
CREATE TYPE "public"."llm_stage" AS ENUM('triage', 'score');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('scan', 'process', 'outcomes', 'probe', 'tickers');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'api', 'edgar');--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"canonical_url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body_text" text,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"story_key" text,
	"prefilter_reason" text,
	"processed_at" timestamp with time zone,
	"process_error" text
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"stage" "llm_stage" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_fetch_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"market_date" date NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_fetch_failures_symbol_date_key" UNIQUE("symbol","market_date")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"symbol" text NOT NULL,
	"market_date" date NOT NULL,
	"close" numeric(14, 4) NOT NULL,
	CONSTRAINT "prices_symbol_market_date_pk" PRIMARY KEY("symbol","market_date")
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "run_kind" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"sources_ok" integer DEFAULT 0 NOT NULL,
	"sources_failed" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"items_prefiltered" integer DEFAULT 0 NOT NULL,
	"signals_new" integer DEFAULT 0 NOT NULL,
	"llm_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "signal_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"price_at_signal" numeric(14, 4),
	"price_1d" numeric(14, 4),
	"price_5d" numeric(14, 4),
	"price_20d" numeric(14, 4),
	"return_1d" numeric(8, 4),
	"return_5d" numeric(8, 4),
	"return_20d" numeric(8, 4),
	"direction_correct_5d" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_outcomes_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"symbol" text,
	"sector" text,
	"event_type" "event_type" NOT NULL,
	"direction" "direction" NOT NULL,
	"magnitude" integer NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"horizon" "horizon" NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"rationale" text NOT NULL,
	"key_facts" jsonb,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_item_symbol_sector_key" UNIQUE NULLS NOT DISTINCT("item_id","symbol","sector"),
	CONSTRAINT "signals_magnitude_range" CHECK ("signals"."magnitude" between 1 and 5),
	CONSTRAINT "signals_confidence_range" CHECK ("signals"."confidence" between 0 and 1),
	CONSTRAINT "signals_score_range" CHECK ("signals"."score" between 0 and 100),
	CONSTRAINT "signals_symbol_or_sector" CHECK ("signals"."symbol" is not null or "signals"."sector" is not null)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"poll_interval_sec" integer DEFAULT 300 NOT NULL,
	"quality_weight" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"store_body" boolean DEFAULT false NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"error_streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_name_unique" UNIQUE("name"),
	CONSTRAINT "sources_quality_weight_range" CHECK ("sources"."quality_weight" between 0 and 1),
	CONSTRAINT "sources_poll_interval_positive" CHECK ("sources"."poll_interval_sec" >= 30)
);
--> statement-breakpoint
CREATE TABLE "tickers" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"sector" text,
	"industry" text,
	"market_cap" numeric(20, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickers_symbol_upper" CHECK ("tickers"."symbol" = upper("tickers"."symbol"))
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"symbol" text PRIMARY KEY NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_at_add" numeric(14, 4),
	"price_at_add_at" timestamp with time zone,
	"price_at_add_source" text
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_run_id_scan_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_symbol_tickers_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_outcomes" ADD CONSTRAINT "signal_outcomes_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_symbol_tickers_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_symbol_tickers_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."tickers"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_canonical_url_key" ON "items" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "items_url_hash_idx" ON "items" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "items_content_hash_idx" ON "items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "items_story_key_idx" ON "items" USING btree ("story_key");--> statement-breakpoint
CREATE INDEX "items_published_at_idx" ON "items" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_source_id_idx" ON "items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "items_unprocessed_idx" ON "items" USING btree ("published_at") WHERE "items"."processed_at" is null and "items"."prefilter_reason" is null;--> statement-breakpoint
CREATE INDEX "llm_usage_created_at_idx" ON "llm_usage" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_fetch_failures_open_idx" ON "price_fetch_failures" USING btree ("symbol","market_date") WHERE "price_fetch_failures"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "prices_symbol_date_idx" ON "prices" USING btree ("symbol","market_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scan_runs_started_at_idx" ON "scan_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signal_outcomes_pending_idx" ON "signal_outcomes" USING btree ("updated_at") WHERE "signal_outcomes"."price_1d" is null or "signal_outcomes"."price_5d" is null or "signal_outcomes"."price_20d" is null;--> statement-breakpoint
CREATE INDEX "signals_score_idx" ON "signals" USING btree ("score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signals_symbol_idx" ON "signals" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "signals_created_at_idx" ON "signals" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signals_event_type_idx" ON "signals" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "tickers_is_active_idx" ON "tickers" USING btree ("is_active");