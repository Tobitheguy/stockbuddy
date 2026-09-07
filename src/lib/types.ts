/**
 * Shared vocabulary for signals.
 *
 * These are the values the scorer is constrained to emit and the values the
 * database stores. Defined once here so the Zod schema (Step 4), the Drizzle
 * enums (Step 2) and the UI cannot drift apart.
 */

export const EVENT_TYPES = [
  "earnings",
  "guidance",
  "M&A",
  "contract_win",
  "product_launch",
  "regulatory_policy",
  "macro",
  "legal",
  "management_change",
  "capital_raise",
  "insider_trade",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const HORIZONS = ["days", "weeks", "months"] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Human labels. `M&A` is already correct; the rest need un-snake-casing. */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  earnings: "Earnings",
  guidance: "Guidance",
  "M&A": "M&A",
  contract_win: "Contract win",
  product_launch: "Product launch",
  regulatory_policy: "Regulatory",
  macro: "Macro",
  legal: "Legal",
  management_change: "Management",
  capital_raise: "Capital raise",
  insider_trade: "Insider",
  other: "Other",
};
