/**
 * Deterministic scoring of a raw lead.
 * Returns a raw_score integer (0–100) based on signal strength.
 */
function scoreLead(lead) {
  let score = 0;

  if (lead.github_stars > 100)  score += 20;
  else if (lead.github_stars > 20) score += 10;

  if (lead.github_repos > 10) score += 10;
  else if (lead.github_repos > 3) score += 5;

  if (lead.hackathon)   score += 20;
  if (lead.university)  score += 15;
  if (lead.club)        score += 10;

  const dachLocations = ['germany', 'austria', 'switzerland', 'berlin', 'munich',
    'vienna', 'zurich', 'hamburg', 'frankfurt', 'stuttgart'];
  if (lead.location && dachLocations.some(l => lead.location.toLowerCase().includes(l))) {
    score += 15;
  }

  if (lead.thesis_keywords) {
    const techKeywords = ['ai', 'ml', 'saas', 'deeptech', 'biotech', 'climate', 'fintech'];
    const hits = techKeywords.filter(k => lead.thesis_keywords.toLowerCase().includes(k));
    score += Math.min(hits.length * 5, 15);
  }

  return Math.min(score, 100);
}

/**
 * Filter leads that meet the minimum bar for LLM enrichment.
 */
function filterLeads(leads, minScore = 30) {
  return leads
    .map(l => ({ ...l, raw_score: scoreLead(l) }))
    .filter(l => l.raw_score >= minScore);
}

module.exports = { scoreLead, filterLeads };
