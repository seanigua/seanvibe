const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Score a lead and generate a one-paragraph investor memo using Claude Haiku.
 * Returns { llm_score, memo }.
 */
async function evaluateLead(lead) {
  const prompt = `You are a VC scout evaluating early-stage founders in the DACH region.

Founder profile:
- Name: ${lead.name}
- Location: ${lead.location ?? 'unknown'}
- University: ${lead.university ?? 'unknown'}
- Hackathons: ${lead.hackathon ?? 'none'}
- Club/org: ${lead.club ?? 'none'}
- GitHub stars: ${lead.github_stars ?? 0} across ${lead.github_repos ?? 0} repos
- Thesis/project keywords: ${lead.thesis_keywords ?? 'none'}
- Raw signal score: ${lead.raw_score}/100

Task:
1. Output a JSON object with two fields:
   - "llm_score": integer 0-100 reflecting founding potential
   - "memo": one concise paragraph (max 120 words) summarising why this person is or isn't worth a coffee chat

Respond with raw JSON only, no markdown.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].text.trim();
  return JSON.parse(text);
}

module.exports = { evaluateLead };
