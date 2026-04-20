const axios = require('axios');
const cheerio = require('cheerio');

const DELAY = () => parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
const MAX_PAGES = 5;

// Known DACH hackathons on Devpost — extend as new editions are published.
const HACKATHONS = [
  { slug: 'hackatum-2024',        name: 'HackaTUM 2024',         location: 'Munich, Germany' },
  { slug: 'hackatum-2023',        name: 'HackaTUM 2023',         location: 'Munich, Germany' },
  { slug: 'cispa-hackathon-2024', name: 'CISPA Hackathon 2024',  location: 'Saarbrücken, Germany' },
  { slug: 'cispa-hackathon-2023', name: 'CISPA Hackathon 2023',  location: 'Saarbrücken, Germany' },
];

const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; founder-tracker/1.0)',
    Accept: 'text/html,application/json',
  },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchProjectsPage(slug, page) {
  const url = `https://devpost.com/hackathons/${slug}/projects.json?page=${page}&per_page=25`;
  const { data } = await http.get(url, { headers: { Accept: 'application/json' } });
  return data;
}

async function scrapeProjectPage(projectUrl, hackathon) {
  const { data } = await http.get(projectUrl);
  const $ = cheerio.load(data);
  const leads = [];

  // Built-with tags become thesis_keywords
  const builtWith = [];
  $('[data-tag], .cp-tag, .software-list-tag').each((_, el) => {
    const t = $(el).text().trim();
    if (t) builtWith.push(t.toLowerCase());
  });

  const tagline = $('p.tagline, .tagline-text').first().text().trim() || null;

  // Team member list — Devpost renders these server-side
  $('#app-team li, .software-team-member, [class*="team-member"]').each((_, el) => {
    const nameEl = $(el).find('.member-username, .name, span').first();
    const name = nameEl.text().trim();
    if (!name) return;

    // LinkedIn may be linked directly on the project page (uncommon but possible)
    const linkedinHref = $(el).find('a[href*="linkedin.com/in/"]').attr('href') || null;

    leads.push({
      name,
      linkedin_url: linkedinHref,
      github_url: $(el).find('a[href*="github.com/"]').attr('href') || null,
      university: null,
      club: null,
      hackathon: hackathon.name,
      location: hackathon.location,
      raw_bio: tagline,
      thesis_keywords: builtWith,
    });
  });

  return leads;
}

async function scrapeHackathon(hackathon) {
  const leads = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    let projects;
    try {
      const data = await fetchProjectsPage(hackathon.slug, page);
      projects = data.software_projects ?? [];
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        // Slug doesn't exist this year — silent skip
        break;
      }
      if (status === 429) {
        console.warn(`[devpost] 429 on ${hackathon.slug} p${page} — skipping hackathon`);
        break;
      }
      console.warn(`[devpost] fetch error ${hackathon.slug} p${page}: ${err.message}`);
      break;
    }

    if (!projects.length) break;

    for (const project of projects) {
      await sleep(DELAY());
      try {
        const projectLeads = await scrapeProjectPage(project.url, hackathon);
        leads.push(...projectLeads);
      } catch (err) {
        const status = err.response?.status;
        if (status === 429) {
          console.warn(`[devpost] 429 on project ${project.url} — backing off`);
          await sleep(DELAY() * 4);
        } else {
          console.warn(`[devpost] skip project ${project.url}: ${err.message}`);
        }
      }
    }

    // Stop if we've reached the last page
    const meta = await fetchProjectsPage(hackathon.slug, page).catch(() => ({}));
    if (page >= (meta.meta?.total_pages ?? page)) break;

    await sleep(DELAY());
  }

  return leads;
}

async function scrape() {
  const leads = [];
  for (const hackathon of HACKATHONS) {
    try {
      const found = await scrapeHackathon(hackathon);
      console.log(`[devpost] ${hackathon.name}: ${found.length} leads`);
      leads.push(...found);
    } catch (err) {
      console.warn(`[devpost] unhandled error for ${hackathon.name}: ${err.message}`);
    }
  }
  return leads;
}

module.exports = { scrape };
