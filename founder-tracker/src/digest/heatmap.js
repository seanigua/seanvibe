'use strict';
require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../../data/heatmaps');

// ── axes ───────────────────────────────────────────────────────────────────

const CITIES  = ['Berlin', 'Munich', 'Frankfurt', 'Zurich', 'Vienna', 'Hamburg', 'Cologne'];
const CATS    = ['Vertical AI', 'B2B Fintech', 'Compliance/Regtech', 'Other'];
const SOURCES = ['HackaTUM', 'CISPA', 'MLH', 'TUM.ai', 'ETH clubs', 'GitHub', 'Other'];
const TIERS   = ['Elite (7–8)', 'Strong (5–6)', 'Marginal (3–4)'];

// Thresholds — adjust if llm_score scale changes (currently 0–100 from Haiku)
const LLM_MAP1_MIN   = 6;   // Map 1: leads visible in heatmap
const LLM_MAP3_CONV  = 7;   // Map 3: "converted" threshold
const RAW_MAP3_MIN   = 5;   // Map 3: minimum raw_score to appear

// ── colour ─────────────────────────────────────────────────────────────────

const C0 = [239, 246, 255];   // #EFF6FF  (zero / empty)
const C1 = [ 37,  99, 235];   // #2563EB  (maximum)

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function heatColor(v, max) {
  if (!max || !v) return '#EFF6FF';
  const t = Math.min(v / max, 1);
  const [r, g, b] = C0.map((lo, i) => lerp(lo, C1[i], t));
  return `rgb(${r},${g},${b})`;
}

function rateColor(rate) {
  const t = Math.min(Math.max(rate, 0), 1);
  const [r, g, b] = C0.map((lo, i) => lerp(lo, C1[i], t));
  return `rgb(${r},${g},${b})`;
}

function inkOn(v, max) {
  return (!max || v / max < 0.55) ? '#1e293b' : '#ffffff';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── classification ─────────────────────────────────────────────────────────

function allText(lead) {
  let kw = lead.thesis_keywords ?? '';
  if (typeof kw === 'string' && kw.trimStart().startsWith('[')) {
    try { kw = JSON.parse(kw).join(' '); } catch {}
  } else if (Array.isArray(kw)) { kw = kw.join(' '); }
  return [kw, lead.raw_bio ?? '', lead.linkedin_headline ?? '', lead.linkedin_summary ?? '']
    .join(' ').toLowerCase();
}

function classifyCity(location) {
  if (!location) return null;
  const l = location.toLowerCase();
  const MAP = [
    [['berlin'], 'Berlin'],
    [['munich', 'münchen', 'munchen'], 'Munich'],
    [['frankfurt'], 'Frankfurt'],
    [['zürich', 'zurich'], 'Zurich'],
    [['vienna', 'wien'], 'Vienna'],
    [['hamburg'], 'Hamburg'],
    [['cologne', 'köln', 'koeln'], 'Cologne'],
  ];
  for (const [terms, city] of MAP)
    if (terms.some(t => l.includes(t))) return city;
  return null;
}

function classifyCategory(lead) {
  const t = allText(lead);
  if (['compliance', 'regtech', 'regulatory', 'aml', 'kyc', 'gdpr'].some(k => t.includes(k)))
    return 'Compliance/Regtech';
  if (['vertical ai', 'llm', 'rag', 'ai agent', 'generative', 'machine learning', 'nlp'].some(k => t.includes(k)))
    return 'Vertical AI';
  if (['fintech', 'b2b', 'saas', 'payment', 'banking', 'finance', 'insurtech'].some(k => t.includes(k)))
    return 'B2B Fintech';
  return 'Other';
}

function classifySource(lead) {
  const h = (lead.hackathon ?? '').toLowerCase();
  if (h.includes('hackatum'))          return 'HackaTUM';
  if (h.includes('cispa'))             return 'CISPA';
  if (h.includes('mlh'))               return 'MLH';
  const c = (lead.club ?? '').toLowerCase();
  if (c.includes('tum.ai') || (c.includes('tum') && !c.includes('eth'))) return 'TUM.ai';
  if (c.includes('eth'))               return 'ETH clubs';
  if (lead.github_url)                 return 'GitHub';
  return 'Other';
}

function classifyTier(rawScore) {
  if (rawScore >= 7) return 'Elite (7–8)';
  if (rawScore >= 5) return 'Strong (5–6)';
  if (rawScore >= 3) return 'Marginal (3–4)';
  return null;
}

// ── data computation ───────────────────────────────────────────────────────

function buildEcosystemMatrix(leads) {
  const m = Object.fromEntries(CATS.map(c => [c, Object.fromEntries(CITIES.map(ci => [ci, 0]))]));
  for (const l of leads) {
    if ((l.llm_score ?? 0) < LLM_MAP1_MIN) continue;
    const city = classifyCity(l.location);
    if (!city) continue;
    m[classifyCategory(l)][city]++;
  }
  return m;
}

function buildSourceMatrix(leads) {
  const m = Object.fromEntries(TIERS.map(t => [t, Object.fromEntries(SOURCES.map(s => [s, 0]))]));
  for (const l of leads) {
    const tier = classifyTier(l.raw_score ?? 0);
    if (!tier) continue;
    m[tier][classifySource(l)]++;
  }
  return m;
}

function buildUniBars(leads) {
  const acc = {};
  for (const l of leads) {
    if ((l.raw_score ?? 0) < RAW_MAP3_MIN || !l.university?.trim()) continue;
    if (!acc[l.university]) acc[l.university] = { total: 0, conv: 0 };
    acc[l.university].total++;
    if ((l.llm_score ?? 0) >= LLM_MAP3_CONV) acc[l.university].conv++;
  }
  return Object.entries(acc)
    .map(([uni, d]) => ({ uni, total: d.total, conv: d.conv, rate: d.conv / d.total }))
    .sort((a, b) => b.total - a.total);
}

// ── SVG: heat-map grid ─────────────────────────────────────────────────────

function svgHeatmap(rows, cols, matrix, opts = {}) {
  const CW  = opts.cellW   ?? 88;
  const CH  = opts.cellH   ?? 48;
  const LW  = opts.labelW  ?? 178;   // left label column width
  const TH  = opts.topH    ?? 70;    // top label row height
  const PAD = 24;                    // right / bottom padding
  const W = LW + cols.length * CW + PAD;
  const H = TH + rows.length * CH + 52;   // 52 = legend area

  let max = 0;
  rows.forEach(r => cols.forEach(c => { max = Math.max(max, matrix[r]?.[c] ?? 0); }));

  const uid = `g${rows.length}${cols.length}`;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block">`);
  o.push(`<defs><linearGradient id="${uid}"><stop offset="0%" stop-color="#EFF6FF"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs>`);
  o.push(`<rect width="${W}" height="${H}" fill="#f8fafc" rx="8"/>`);

  // Cell backgrounds (white base)
  rows.forEach((_, i) => cols.forEach((_, j) => {
    const x = LW + j * CW, y = TH + i * CH;
    o.push(`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="#fff" stroke="#e2e8f0" stroke-width="1"/>`);
  }));

  // Colored fills + count labels
  rows.forEach((row, i) => cols.forEach((col, j) => {
    const x = LW + j * CW, y = TH + i * CH;
    const v = matrix[row]?.[col] ?? 0;
    const bg = heatColor(v, max);
    const fg = inkOn(v, max);
    o.push(`<rect x="${x+1}" y="${y+1}" width="${CW-2}" height="${CH-2}" fill="${bg}" rx="3"/>`);
    o.push(`<text x="${x + CW/2}" y="${y + CH/2}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${fg}">${v}</text>`);
  }));

  // X-axis labels (−40° rotation)
  cols.forEach((col, j) => {
    const cx = LW + j * CW + CW / 2;
    o.push(`<text transform="translate(${cx},${TH - 8}) rotate(-40)" text-anchor="end" font-family="system-ui,sans-serif" font-size="11.5" fill="#475569">${esc(col)}</text>`);
  });

  // Y-axis labels
  rows.forEach((row, i) => {
    const cy = TH + i * CH + CH / 2;
    o.push(`<text x="${LW - 10}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="11.5" fill="#475569">${esc(row)}</text>`);
  });

  // Outer border
  o.push(`<rect x="${LW}" y="${TH}" width="${cols.length * CW}" height="${rows.length * CH}" fill="none" stroke="#cbd5e1" stroke-width="1.5" rx="1"/>`);

  // Legend
  const lx = LW, ly = TH + rows.length * CH + 14;
  const lw = Math.min(cols.length * CW * 0.6, 190);
  o.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="10" fill="url(#${uid})" rx="2" stroke="#e2e8f0"/>`);
  o.push(`<text x="${lx}" y="${ly + 22}" font-family="system-ui,sans-serif" font-size="10" fill="#94a3b8">0</text>`);
  o.push(`<text x="${lx + lw}" y="${ly + 22}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#94a3b8">${max} leads</text>`);

  o.push('</svg>');
  return o.join('');
}

// ── SVG: horizontal bar chart ──────────────────────────────────────────────

function svgBarChart(bars) {
  const NW  = 195;    // name column width
  const BW  = 370;    // max bar width
  const RW  = 105;    // right label width
  const RH  = 35;     // row height
  const PL  = 14;     // left padding
  const PT  = 40;     // top padding (column headers)
  const PB  = 44;     // bottom padding (legend)
  const W = PL + NW + BW + RW + 12;

  if (!bars.length) {
    const H = PT + 56 + PB;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block"><rect width="${W}" height="${H}" fill="#f8fafc" rx="8"/><text x="${W/2}" y="${H/2}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="14" fill="#94a3b8">No university data yet — run scrapers first</text></svg>`;
  }

  const H = PT + bars.length * RH + PB;
  const maxTotal = Math.max(...bars.map(b => b.total));

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block">`);
  o.push(`<defs><linearGradient id="rg"><stop offset="0%" stop-color="#EFF6FF"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs>`);
  o.push(`<rect width="${W}" height="${H}" fill="#f8fafc" rx="8"/>`);

  // Column headers
  const hy = PT - 12;
  o.push(`<text x="${PL}" y="${hy}" font-family="system-ui,sans-serif" font-size="10.5" fill="#94a3b8" font-weight="700" letter-spacing="0.05em">UNIVERSITY</text>`);
  o.push(`<text x="${PL + NW + BW/2}" y="${hy}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#94a3b8" font-weight="700" letter-spacing="0.05em">LEADS (raw ≥ ${RAW_MAP3_MIN})</text>`);
  o.push(`<text x="${PL + NW + BW + RW - 4}" y="${hy}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10.5" fill="#94a3b8" font-weight="700" letter-spacing="0.05em">CONVERSION</text>`);

  // Subtle vertical grid lines at 25 % intervals
  [0.25, 0.5, 0.75, 1].forEach(frac => {
    const gx = PL + NW + Math.round(frac * BW);
    o.push(`<line x1="${gx}" y1="${PT - 6}" x2="${gx}" y2="${H - PB}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`);
    const lbl = Math.round(frac * maxTotal);
    o.push(`<text x="${gx}" y="${H - PB + 12}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9.5" fill="#cbd5e1">${lbl}</text>`);
  });

  bars.forEach((b, i) => {
    const y = PT + i * RH;
    const bw = maxTotal ? Math.round((b.total / maxTotal) * BW) : 0;
    const bg = rateColor(b.rate);
    const pct = Math.round(b.rate * 100);

    // Alternating row background
    if (i % 2 === 0)
      o.push(`<rect x="${PL}" y="${y}" width="${NW + BW + RW + 8}" height="${RH}" fill="#f1f5f9" rx="3"/>`);

    // University name (truncated)
    const label = b.uni.length > 30 ? b.uni.slice(0, 28) + '…' : b.uni;
    o.push(`<text x="${PL + NW - 8}" y="${y + RH/2}" text-anchor="end" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="12" fill="#334155">${esc(label)}</text>`);

    // Bar track
    o.push(`<rect x="${PL + NW}" y="${y + 9}" width="${BW}" height="${RH - 18}" fill="#e2e8f0" rx="4"/>`);

    // Bar fill
    if (bw > 0)
      o.push(`<rect x="${PL + NW}" y="${y + 9}" width="${bw}" height="${RH - 18}" fill="${bg}" rx="4"/>`);

    // Count label: inside bar if wide enough, outside otherwise
    if (bw > 28) {
      o.push(`<text x="${PL + NW + bw - 6}" y="${y + RH/2}" text-anchor="end" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="11" fill="${pct > 55 ? '#fff' : '#1e293b'}" font-weight="600">${b.total}</text>`);
    } else {
      o.push(`<text x="${PL + NW + bw + 6}" y="${y + RH/2}" text-anchor="start" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="11" fill="#475569">${b.total}</text>`);
    }

    // Conversion label: "conv/total (pct%)"
    o.push(`<text x="${PL + NW + BW + RW - 4}" y="${y + RH/2}" text-anchor="end" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="12">`);
    o.push(`<tspan font-weight="700" fill="#2563EB">${b.conv}/${b.total} </tspan>`);
    o.push(`<tspan fill="#94a3b8">(${pct}%)</tspan>`);
    o.push(`</text>`);
  });

  // Legend
  const lgY = H - PB + 20;
  const lgX = PL + NW;
  const lgW = 160;
  o.push(`<rect x="${lgX}" y="${lgY}" width="${lgW}" height="9" fill="url(#rg)" rx="2" stroke="#e2e8f0"/>`);
  o.push(`<text x="${lgX}" y="${lgY + 19}" font-family="system-ui,sans-serif" font-size="9.5" fill="#94a3b8">0% conversion</text>`);
  o.push(`<text x="${lgX + lgW}" y="${lgY + 19}" text-anchor="end" font-family="system-ui,sans-serif" font-size="9.5" fill="#94a3b8">100% → llm_score ≥ ${LLM_MAP3_CONV}</text>`);

  o.push('</svg>');
  return o.join('');
}

// ── HTML wrapper ───────────────────────────────────────────────────────────

function wrapHtml(title, svgContent, { totalLeads, ts, subtitle, note } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#1e293b}
header{background:#0f172a;color:#f1f5f9;padding:18px 24px}
header h1{font-size:1.1rem;font-weight:700;letter-spacing:-.02em}
header .meta{margin-top:5px;font-size:.78rem;color:#94a3b8}
main{padding:24px}
.card{background:#fff;border-radius:12px;padding:22px 22px 18px;box-shadow:0 1px 4px rgba(0,0,0,.07);overflow-x:auto}
.subtitle{font-size:.8rem;font-weight:600;color:#64748b;margin-bottom:14px;text-transform:uppercase;letter-spacing:.04em}
.note{margin-top:12px;font-size:.72rem;color:#94a3b8;line-height:1.5}
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="meta">Generated ${ts} &nbsp;·&nbsp; ${totalLeads} total leads in DB</div>
</header>
<main>
  <div class="card">
    ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
    ${svgContent}
  </div>
  ${note ? `<p class="note">${note}</p>` : ''}
</main>
</body>
</html>`;
}

// ── index.html ─────────────────────────────────────────────────────────────

function buildIndex(totalLeads, ts) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Founder Tracker — Heatmaps</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;min-height:100vh}
header{padding:24px 32px 18px;border-bottom:1px solid #1e293b}
header h1{font-size:1.35rem;font-weight:800;letter-spacing:-.03em}
header h1 span{color:#2563EB}
header .meta{margin-top:6px;font-size:.78rem;color:#64748b}
.maps{padding:28px 32px;display:grid;gap:28px}
.map-block h2{font-size:.78rem;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;gap:8px}
.map-block h2 .num{background:#2563EB;color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:.68rem;flex-shrink:0}
iframe{width:100%;border:none;border-radius:12px;display:block;background:#fff}
footer{padding:16px 32px;border-top:1px solid #1e293b;font-size:.72rem;color:#334155}
</style>
</head>
<body>
<header>
  <h1>Founder Tracker <span>Heatmaps</span></h1>
  <div class="meta">Generated ${ts} &nbsp;·&nbsp; ${totalLeads} leads in database</div>
</header>
<div class="maps">
  <div class="map-block">
    <h2><span class="num">1</span> Ecosystem Density — city × category (llm_score ≥ ${LLM_MAP1_MIN})</h2>
    <iframe src="ecosystem_density.html" height="360" title="Ecosystem Density"></iframe>
  </div>
  <div class="map-block">
    <h2><span class="num">2</span> Source Quality — score tier × originating source</h2>
    <iframe src="source_quality.html" height="320" title="Source Quality"></iframe>
  </div>
  <div class="map-block">
    <h2><span class="num">3</span> University Funnel — raw_score ≥ ${RAW_MAP3_MIN} leads, colored by llm_score ≥ ${LLM_MAP3_CONV} conversion</h2>
    <iframe src="university_funnel.html" height="480" title="University Funnel"></iframe>
  </div>
</div>
<footer>Founder Tracker · DACH VC Scout · data/heatmaps/</footer>
</body>
</html>`;
}

// ── main export ────────────────────────────────────────────────────────────

/**
 * Generate all heatmap HTML files from the leads table.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]} paths of written files
 */
function generateHeatmaps(db) {
  fs.mkdirSync(OUT, { recursive: true });

  const leads = db.prepare('SELECT * FROM leads').all();
  const totalLeads = leads.length;
  const ts = new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/Berlin',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const meta = { totalLeads, ts };

  // ── Map 1: ecosystem density ──────────────────────────────────────────
  const ecoMatrix  = buildEcosystemMatrix(leads);
  const ecoSvg     = svgHeatmap(CATS, CITIES, ecoMatrix, { labelW: 178 });
  const ecoHtml    = wrapHtml('Ecosystem Density', ecoSvg, {
    ...meta,
    subtitle: `Leads with llm_score ≥ ${LLM_MAP1_MIN} · rows = category · columns = city`,
  });
  const ecoFile = path.join(OUT, 'ecosystem_density.html');
  fs.writeFileSync(ecoFile, ecoHtml, 'utf8');

  // ── Map 2: source quality ─────────────────────────────────────────────
  const srcMatrix  = buildSourceMatrix(leads);
  const srcSvg     = svgHeatmap(TIERS, SOURCES, srcMatrix, { labelW: 140 });
  const srcHtml    = wrapHtml('Source Quality', srcSvg, {
    ...meta,
    subtitle: 'All leads · rows = raw_score tier · columns = originating source',
    note: 'Score tiers based on raw_score (0–8 scale): Elite 7–8, Strong 5–6, Marginal 3–4.',
  });
  const srcFile = path.join(OUT, 'source_quality.html');
  fs.writeFileSync(srcFile, srcHtml, 'utf8');

  // ── Map 3: university funnel ──────────────────────────────────────────
  const uniBars    = buildUniBars(leads);
  const uniSvg     = svgBarChart(uniBars);
  const uniHtml    = wrapHtml('University Funnel', uniSvg, {
    ...meta,
    subtitle: `Bar length = leads with raw_score ≥ ${RAW_MAP3_MIN} · bar color = llm_score ≥ ${LLM_MAP3_CONV} conversion rate`,
  });
  const uniFile = path.join(OUT, 'university_funnel.html');
  fs.writeFileSync(uniFile, uniHtml, 'utf8');

  // ── index ─────────────────────────────────────────────────────────────
  const idxFile = path.join(OUT, 'index.html');
  fs.writeFileSync(idxFile, buildIndex(totalLeads, ts), 'utf8');

  const files = [ecoFile, srcFile, uniFile, idxFile];
  console.log(`[heatmap] generated ${files.length} files → ${OUT}`);
  return files;
}

module.exports = { generateHeatmaps };

if (require.main === module) {
  const { initDb } = require('../../db/init');
  const db = initDb();
  generateHeatmaps(db);
  db.close();
}
