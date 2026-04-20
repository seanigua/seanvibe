// ---------------------------------------------------------------------------
// Signal definitions — each is a pure boolean predicate on a Lead object.
// Order matches the documented signal numbering (1–8).
// ---------------------------------------------------------------------------

const THESIS_KEYWORDS = [
  'vertical AI', 'B2B', 'compliance', 'regtech', 'fintech', 'insurtech',
  'enterprise', 'workflow automation', 'LLM', 'RAG', 'AI agent',
  'data pipeline', 'API-first', 'SaaS',
];

const DACH_TERMS = [
  'Germany', 'Austria', 'Switzerland',
  'München', 'Berlin', 'Frankfurt', 'Zürich', 'Wien',
  'Hamburg', 'Stuttgart', 'Cologne', 'Düsseldorf',
];

const ELITE_UNIVERSITIES = [
  'TU Munich', 'TUM', 'ETH', 'RWTH', 'KIT', 'Humboldt',
  'FU Berlin', 'Frankfurt School', 'HPI', 'Mannheim', 'LMU', 'WHU',
];

const TOP_CLUBS = [
  'TUM.ai', 'CDTM', 'ETH', 'CISPA', 'HPI', 'mainexist', 'HTGF', 'Backbone',
];

// Case-insensitive substring match against a list of terms
function matchesAny(text, terms) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return terms.some(t => lower.includes(t.toLowerCase()));
}

// Normalise thesis_keywords to a single searchable string regardless of whether
// the scraper stored it as an array, a JSON string, or a plain comma-list.
function keywordsToString(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.join(' ');
  // Stored as JSON array in DB ("["foo","bar"]")
  if (typeof value === 'string' && value.trimStart().startsWith('[')) {
    try { return JSON.parse(value).join(' '); } catch { /* fall through */ }
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// The 8 binary signals
// ---------------------------------------------------------------------------

const SIGNALS = {
  has_linkedin_url(lead) {
    return typeof lead.linkedin_url === 'string' && lead.linkedin_url.includes('/in/');
  },

  has_github(lead) {
    return typeof lead.github_url === 'string' && lead.github_url.length > 0;
  },

  thesis_keyword_match(lead) {
    const haystack = [
      lead.raw_bio ?? '',
      keywordsToString(lead.thesis_keywords),
    ].join(' ');
    return matchesAny(haystack, THESIS_KEYWORDS);
  },

  dach_location(lead) {
    return matchesAny(lead.location, DACH_TERMS);
  },

  elite_university(lead) {
    return matchesAny(lead.university, ELITE_UNIVERSITIES);
  },

  top_club(lead) {
    return lead.club != null && matchesAny(lead.club, TOP_CLUBS);
  },

  hackathon_participant(lead) {
    return lead.hackathon != null && String(lead.hackathon).trim().length > 0;
  },

  // Placeholder until GitHub enrichment runs; any github_url counts as active.
  recent_github_activity(lead) {
    return typeof lead.github_url === 'string' && lead.github_url.length > 0;
  },
};

const SIGNAL_NAMES = Object.keys(SIGNALS);
const MIN_SCORE = 4;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score every lead and return only those meeting the minimum threshold.
 * Each returned ScoredLead gains:
 *   - signals: { has_linkedin_url: 0|1, has_github: 0|1, ... }
 *   - raw_score: integer 0–8
 *
 * Leads below MIN_SCORE (4) are dropped entirely.
 */
function scoreLeads(leads) {
  const results = [];

  for (const lead of leads) {
    const signals = {};
    let raw_score = 0;

    for (const name of SIGNAL_NAMES) {
      const hit = SIGNALS[name](lead) ? 1 : 0;
      signals[name] = hit;
      raw_score += hit;
    }

    if (raw_score >= MIN_SCORE) {
      results.push({ ...lead, signals, raw_score });
    }
  }

  return results;
}

module.exports = { scoreLeads, SIGNALS, SIGNAL_NAMES, MIN_SCORE };
