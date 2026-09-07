/**
 * Risk context, computed from the price history we already store.
 *
 * These are FACTS about how the stock has behaved — not a judgement about
 * whether to buy it. The tool's rule is that it never answers "should I
 * invest"; what it can honestly do is put numbers on the question "how rough
 * is the ride on this one", because a 60% annualized volatility changes what
 * any signal about the stock means in practice.
 */

export type RiskContext = {
  /** Annualized volatility of daily returns, percent. ~15-25 is market-like. */
  annualVolPct: number;
  /** Where today sits between the 52-week low (0) and high (100). */
  rangePositionPct: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  /** Worst peak-to-trough fall over the last year, percent (negative). */
  maxDrawdownPct: number;
  tradingDays: number;
};

export function riskContext(
  closes: Array<{ marketDate: string; close: number }>,
): RiskContext | null {
  // Need a few months of data before any of these numbers mean anything.
  if (closes.length < 60) return null;

  const year = closes.slice(-252);
  const prices = year.map((c) => c.close);

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(prices[i] / prices[i - 1] - 1);
  }
  if (returns.length < 30) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const annualVolPct = Math.sqrt(variance) * Math.sqrt(252) * 100;

  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const last = prices[prices.length - 1];
  const rangePositionPct =
    high === low ? 50 : ((last - low) / (high - low)) * 100;

  let peak = prices[0];
  let maxDrawdownPct = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = (p / peak - 1) * 100;
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;
  }

  return {
    annualVolPct,
    rangePositionPct,
    fiftyTwoWeekHigh: high,
    fiftyTwoWeekLow: low,
    maxDrawdownPct,
    tradingDays: year.length,
  };
}

/** Plain words for a volatility number, calibrated against the S&P's ~15-20%. */
export function volatilityLabel(annualVolPct: number): {
  label: string;
  note: string;
} {
  if (annualVolPct < 20)
    return { label: "calm", note: "moves about like the overall market" };
  if (annualVolPct < 35)
    return { label: "moderate", note: "noticeably swingier than the market" };
  if (annualVolPct < 60)
    return {
      label: "volatile",
      note: "large daily moves are routine for this stock",
    };
  return {
    label: "extremely volatile",
    note: "double-digit daily moves happen; position sizes matter enormously here",
  };
}
