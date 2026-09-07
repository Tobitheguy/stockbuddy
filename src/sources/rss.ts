import Parser from "rss-parser";
import { fetchText } from "./fetch";
import {
  cap,
  MAX_BODY_CHARS,
  MAX_SUMMARY_CHARS,
  parseDate,
  stripHtml,
  type FetchResult,
  type RawItem,
} from "./types";

/**
 * Generic RSS / Atom adapter.
 *
 * Handles both formats — rss-parser normalises them — which covers the wires,
 * the government feeds and the news outlets.
 */

const parser = new Parser({
  timeout: 20_000,
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["dc:date", "dcDate"],
    ],
  },
});

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  dcDate?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
};

export async function fetchRss(
  url: string,
  opts: { storeBody: boolean; sec?: boolean },
): Promise<FetchResult> {
  const xml = await fetchText(url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    sec: opts.sec,
  });

  const feed = await parser.parseString(xml);
  const warnings: string[] = [];
  const items: RawItem[] = [];
  let undated = 0;

  for (const raw of (feed.items ?? []) as FeedItem[]) {
    const item = raw;
    const title = stripHtml(item.title).trim();

    // A link is the item's identity. Without one there is nothing to dedupe
    // on and nothing for the user to click, so it is not ingestible.
    const link = (item.link ?? item.guid ?? "").trim();
    if (!title || !link) continue;

    const { date, guessed } = parseDate(
      item.isoDate ?? item.pubDate ?? item.dcDate,
    );
    if (guessed) undated++;

    const summaryText = stripHtml(
      item.contentSnippet ?? item.summary ?? item.content ?? "",
    );

    // The content rule, enforced here as well as at the call site: full text
    // is only ever kept for sources explicitly marked storeBody.
    const bodyText = opts.storeBody
      ? stripHtml(item.contentEncoded ?? item.content ?? "")
      : "";

    items.push({
      url: link,
      title,
      summary: summaryText ? cap(summaryText, MAX_SUMMARY_CHARS) : null,
      body:
        opts.storeBody && bodyText && bodyText !== summaryText
          ? cap(bodyText, MAX_BODY_CHARS)
          : null,
      publishedAt: date,
    });
  }

  if (undated > 0) {
    warnings.push(
      `${undated} item(s) had no parseable date and were stamped with fetch time`,
    );
  }
  if (items.length === 0) {
    warnings.push("feed parsed but contained no usable items");
  }

  return { items, warnings };
}
