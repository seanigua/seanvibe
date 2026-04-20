// ---------------------------------------------------------------------------
// Deduplication helpers
//
// Normalisation contract (applied to every linkedin_url before any comparison):
//   1. Lowercase the entire URL
//   2. Strip query-string and fragment
//   3. Strip trailing slashes
//   4. Strip www. from the host (linkedin.com == www.linkedin.com)
//
// Leads without a linkedin_url are passed through as-is; they cannot be
// deduplicated by this module and rely on downstream enrichment to acquire one.
// ---------------------------------------------------------------------------

/**
 * Normalise a LinkedIn profile URL to a canonical form suitable for equality
 * checks and storage as a dedup key.
 *
 * Returns null when the value is falsy or does not contain "/in/".
 */
function normaliseLinkedIn(url) {
  if (!url || typeof url !== 'string') return null;
  let s = url.trim().toLowerCase();

  // Strip fragment and query string
  s = s.split('#')[0].split('?')[0];

  // Strip trailing slashes
  s = s.replace(/\/+$/, '');

  // Normalise www. prefix
  s = s.replace('://www.linkedin.com/', '://linkedin.com/');

  return s.includes('/in/') ? s : null;
}

/**
 * Deduplicate `leads` within the batch itself: keep the first occurrence of
 * each normalised linkedin_url. Leads with no linkedin_url are always kept
 * (they may still be valuable; the LLM layer can evaluate them).
 */
function dedupBatch(leads) {
  const seen = new Set();
  const result = [];

  for (const lead of leads) {
    const key = normaliseLinkedIn(lead.linkedin_url);
    if (key === null) {
      result.push(lead);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...lead, linkedin_url: key });   // store normalised form
  }

  return result;
}

/**
 * Cross-check `leads` against the `leads` table in `db`.
 * Returns only leads whose normalised linkedin_url does not already exist.
 *
 * Leads without a linkedin_url are passed through — the caller decides whether
 * to store them (they will be inserted as new rows since there is no key clash).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object[]} leads  - already batch-deduped (run dedupBatch first)
 * @returns {object[]}
 */
function dedupAgainstDb(db, leads) {
  // Separate leads that have a dedup key from those that don't
  const withUrl = leads.filter(l => normaliseLinkedIn(l.linkedin_url) !== null);
  const withoutUrl = leads.filter(l => normaliseLinkedIn(l.linkedin_url) === null);

  if (withUrl.length === 0) return leads;

  // Build a normalised lookup set from the DB in one query using SQLite's
  // LOWER() + TRIM so previously stored non-normalised URLs still match.
  const placeholders = withUrl.map(() => '?').join(',');
  const normKeys = withUrl.map(l => normaliseLinkedIn(l.linkedin_url));

  const existing = db.prepare(`
    SELECT LOWER(TRIM(linkedin_url, '/')) AS key
    FROM   leads
    WHERE  LOWER(TRIM(linkedin_url, '/')) IN (${placeholders})
  `).all(normKeys);

  const existingSet = new Set(existing.map(r => r.key));

  const newLeads = withUrl.filter(l => !existingSet.has(normaliseLinkedIn(l.linkedin_url)));

  return [...newLeads, ...withoutUrl];
}

/**
 * Convenience wrapper: batch-dedup then DB-dedup in one call.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object[]} leads
 * @returns {object[]}
 */
function dedup(db, leads) {
  const batched = dedupBatch(leads);
  return dedupAgainstDb(db, batched);
}

module.exports = { dedup, dedupBatch, dedupAgainstDb, normaliseLinkedIn };
