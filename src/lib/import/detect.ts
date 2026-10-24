import { parseTrakt } from "./trakt";
import { parseTvTimeGdpr } from "./tvtime-gdpr";
import { parseTrackerBackup, BACKUP_FORMAT } from "./backup";
import type { ImportPlan } from "./types";

/**
 * Sniffs the source from the file set (a zip's contents, or a single JSON
 * file) and parses it into a normalized import plan.
 */
export function detectAndParse(files: Map<string, string>): ImportPlan {
  const names = [...files.keys()];
  const has = (pattern: RegExp) => names.some((n) => pattern.test(n));

  if (
    has(/^watched-shows\.json$/) ||
    has(/^watched-movies-\d+\.json$/) ||
    has(/^watched-history-\d+\.json$/)
  ) {
    return { source: "trakt", items: parseTrakt(files) };
  }

  if (has(/^tracking-prod-records-v2\.csv$/) || has(/^seen_episode\.csv$/)) {
    return { source: "tvtime-gdpr", items: parseTvTimeGdpr(files) };
  }

  // Single-file tracker backup
  for (const [, text] of files) {
    if (text.trimStart().startsWith("{") && text.includes(BACKUP_FORMAT)) {
      return { source: "tracker-backup", items: parseTrackerBackup(text) };
    }
  }

  // TV Time Liberator (browser extension) — format not confirmed yet
  if (has(/liberator/i)) {
    throw new Error(
      "TV Time Liberator exports aren't supported yet — send a sample file so support can be added."
    );
  }

  throw new Error(
    "Couldn't recognize this file. Supported: Trakt export zip, TV Time GDPR zip, tracker backup JSON."
  );
}
