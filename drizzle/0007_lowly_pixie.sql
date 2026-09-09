CREATE TABLE "users" (
	"email" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"receives_alerts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
