#!/usr/bin/env node
// Renders pipeline/config/copy_templates.json (the single source of truth
// copyEngine.mjs actually reads) into one static HTML review page — email +
// LinkedIn side by side, per signal type, using real pipeline example data where
// available (tagged REAL) and clearly-marked placeholders where not (tagged
// ILLUSTRATIVE). Built 2026-07-17 per Leo's ask: combine email+LinkedIn review in
// one place WITHOUT hand-maintaining a second copy of the templates — this reads
// copy_templates.json directly and re-renders, so it can never drift the way a
// hand-written .txt review doc did earlier this session.
//
// Zero external calls: every example is rendered with lang:'en', which short-
// circuits copyEngine's localizeBody()/localizeHookLine() before they'd ever hit
// OpenRouter. Safe to re-run anytime, no API key needed, no cost.
//
// Run: node pipeline/stages/build_copy_review.mjs [--out=path]

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { fill as fillCopy, getTemplate } from '../lib/copyEngine.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outArg = args.find(a => a.startsWith('--out='));
const OUT_PATH = outArg ? outArg.split('=')[1] : join(__dir, '../../../docs/copy_review_2026-07-17.html');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Real pipeline example data — company + real signal headline/title where found
// via a read-only query 2026-07-17 (see chat), frozen here rather than re-queried
// live each run (this script has zero DB dependency by design). Where no real
// dual-role/aged-posting example was on hand, marked illustrative explicitly.
const EXAMPLES = {
  HIRING_EXEC: {
    real: true, company: 'Ardo', first_name: 'Sarah', exact_job_title: 'Group Sales Director Food Service',
    job_title: 'Group Sales Director Food Service', market_focus: 'Belgium', note: 'Real posting title — "Director" lands it in the exec band.',
  },
  HIRING_MID: {
    real: true, company: 'Intersnack Deutschland SE', first_name: 'Jonas', exact_job_title: 'Abteilungsleiter / Line Lead (m/w/d)',
    job_title: 'Abteilungsleiter / Line Lead', market_focus: 'Germany', note: 'Real posting title.',
  },
  HIRING_SURGE: {
    real: false, company: 'Nordkorn Feinkost GmbH', first_name: 'Petra', role_1: 'Plant Director', role_2: 'HR Director',
    market_focus: 'Germany', note: 'Illustrative — no confirmed real two-distinct-role-at-once case on hand yet.',
  },
  HIRING_STALE: {
    real: true, company: 'Famille Michaud Apiculteurs', first_name: 'Vincent', exact_job_title: 'Responsable de secteur GMS La Rochelle H/F',
    job_title: 'Responsable de secteur GMS', market_focus: 'France', note: 'Real posting, framed here as if still open ~70 days later (illustrative aging).',
  },
  HIRING_RECRUITER: {
    real: true, company: 'St Michel Biscuits', first_name: 'Franck', exact_job_title: 'Responsable de Production Industrielle H/F',
    job_title: 'Responsable de Production', market_focus: 'France', note: 'Real posting title.',
  },
  CLEVEL: {
    real: true, company: 'Block House', first_name: 'Anke', market_focus: 'Germany',
    note: 'Real headline: "Konfitürenhersteller: Glück holt neuen Geschäftsführer von Block House" (new MD appointed).',
  },
  MA: {
    real: true, company: 'Bühler Group', acquirer: 'Bühler Group', target: 'Endeco', first_name: 'Marc', market_focus: 'Switzerland',
    note: 'Real headline: "Bühler Group acquires Endeco, strengthening its plant protein business."',
  },
  EXPAND: {
    real: true, company: 'Cargill', location: 'Belgium', first_name: 'Tom', market_focus: 'Belgium',
    note: 'Real headline: "Cargill’s €56m Belgian expansion boosts European food supply chains."',
  },
  INVEST: {
    real: true, company: 'Innovorder', amount: '€20 million', first_name: 'Claire', market_focus: 'France',
    note: 'Real headline: "Profitable French scale-up Innovorder raises €20 million..."',
  },
  CONTRACT: {
    real: false, company: 'Atelier Nordique Traiteur', first_name: 'Elise', market_focus: 'France',
    note: 'Illustrative — the two real CONTRACT-tagged rows on hand were actually M&A headlines misfiled by the classifier (a real, separate data-quality note, not hidden here on purpose), so not usable as a clean CONTRACT example.',
  },
};

const TARGETED_CASE_EXAMPLES = {
  HIRING_EXEC: "I placed a Sales Director for a comparable Belgian frozen-foods group last year — similar scope, similar timeline pressure.",
  HIRING_MID: "I've placed two production leads for German snack manufacturers this year, both from the same regional talent pool you'd be looking at.",
  HIRING_SURGE: "I ran a parallel search like this for a mid-size French dairy group last year — two ops roles, three weeks apart.",
  HIRING_STALE: "I took over a stalled plant-leadership search for a comparable French group earlier this year — closed in three weeks once we had the right shortlist.",
  HIRING_RECRUITER: "I've worked alongside a generalist firm on a production-leadership search before, in France — happy to explain how that split worked.",
  CLEVEL: "I placed the ops lead under a comparable new MD in the German confectionery space last year — similar first-90-days rebuild.",
  MA: "I handled the leadership side of a comparable plant-protein acquisition integration last year — the ops gap showed up in week three.",
  EXPAND: "I placed the plant director for a comparable €40-60m build in the Benelux last year, roughly the same timeline as this one.",
  INVEST: "I placed the ops lead for a French foodtech scale-up after a similar raise last year.",
  CONTRACT: "I helped a comparable French catering group scale ops leadership after a similar contract win.",
};

const SIGNAL_TYPES = Object.keys(EXAMPLES);

async function renderType(key) {
  const t = getTemplate(key);
  const ex = EXAMPLES[key];
  const emailVars = { ...ex };
  const email = await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: emailVars });

  let li;
  if (key === 'CLEVEL') {
    li = {
      appointee: await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: emailVars, liVariant: 'li_variant_1_appointee' }),
      hrNearby: await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: emailVars, liVariant: 'li_variant_2_hr_or_ceo_nearby' }),
    };
  } else {
    li = { default: await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: emailVars }) };
  }

  const targetedVars = { ...ex, relevant_case: TARGETED_CASE_EXAMPLES[key] };
  let liTargeted;
  if (key === 'CLEVEL') {
    liTargeted = {
      appointee: await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: targetedVars, liVariant: 'li_variant_1_appointee' }),
      hrNearby: await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: targetedVars, liVariant: 'li_variant_2_hr_or_ceo_nearby' }),
    };
  } else {
    liTargeted = { default: await fillCopy({ templateKey: key, rank: 8, lang: 'en', vars: targetedVars }) };
  }

  return { key, t, ex, email, li, liTargeted };
}

function liBlock(label, fallbackFill, targetedFill) {
  return `
        <div class="li-pair">
          <div class="li-variant">
            <div class="micro-label">${esc(label)} — fallback case</div>
            <div class="field-label">Connection note</div>
            <pre class="copy-block mono">${esc(fallbackFill.li_connection_note)}</pre>
            <div class="field-label">First message</div>
            <pre class="copy-block mono">${esc(fallbackFill.li_first_message)}</pre>
          </div>
          <div class="li-variant">
            <div class="micro-label accent">${esc(label)} — targeted case</div>
            <div class="field-label">Connection note</div>
            <pre class="copy-block mono">${esc(targetedFill.li_connection_note)}</pre>
            <div class="field-label">First message</div>
            <pre class="copy-block mono">${esc(targetedFill.li_first_message)}</pre>
          </div>
        </div>`;
}

async function run() {
  const rendered = [];
  for (const key of SIGNAL_TYPES) rendered.push(await renderType(key));

  const nav = rendered.map(r => `<a href="#${r.key}">${esc(r.key)}</a>`).join('');

  const sections = rendered.map(r => {
    const { key, ex, email, li, liTargeted } = r;
    const liHtml = key === 'CLEVEL'
      ? liBlock('Variant 1 — appointee', li.appointee, liTargeted.appointee) + liBlock('Variant 2 — HR/CEO nearby', li.hrNearby, liTargeted.hrNearby)
      : liBlock('LinkedIn', li.default, liTargeted.default);

    return `
    <section class="type-card" id="${key}">
      <header class="type-head">
        <h2>${esc(key)}</h2>
        <span class="tag ${ex.real ? 'tag-real' : 'tag-illustrative'}">${ex.real ? 'real pipeline example' : 'illustrative example'}</span>
      </header>
      <p class="type-note">${esc(ex.note)} — company used below: <strong>${esc(ex.company)}</strong></p>
      <div class="channel-grid">
        <div class="channel email-channel">
          <div class="channel-label">Email — variant ${esc(email.variantUsed)}</div>
          <div class="field-label">Subject</div>
          <pre class="copy-block mono">${esc(email.subject_line)}</pre>
          <div class="field-label">Body</div>
          <pre class="copy-block mono">${esc(email.body_1)}</pre>
        </div>
        <div class="channel li-channel">
          <div class="channel-label">LinkedIn</div>
          ${liHtml}
        </div>
      </div>
    </section>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Copy review — email + LinkedIn by signal type</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
  --bg: #EEEBE3; --surface: #FBFAF6; --surface-2: #F3F1E9; --ink: #1D211F; --ink-soft: #5B5F5A;
  --accent: #1F6F6B; --accent-soft: #DCEAE8; --warm: #B5793A; --warm-soft: #F3E5D0;
  --illustrative: #6B6A78; --illustrative-soft: #E7E5EF; --rule: #DAD5C8; --shadow: rgba(29,33,31,0.08);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #14171A; --surface: #1B1F22; --surface-2: #20242A; --ink: #ECEAE3; --ink-soft: #A6A9A3;
    --accent: #4FB3AC; --accent-soft: #17302F; --warm: #D9A15C; --warm-soft: #34291A;
    --illustrative: #A9A7C0; --illustrative-soft: #27293A; --rule: #2B2F31; --shadow: rgba(0,0,0,0.4); }
}
:root[data-theme="dark"] { --bg: #14171A; --surface: #1B1F22; --surface-2: #20242A; --ink: #ECEAE3; --ink-soft: #A6A9A3;
  --accent: #4FB3AC; --accent-soft: #17302F; --warm: #D9A15C; --warm-soft: #34291A;
  --illustrative: #A9A7C0; --illustrative-soft: #27293A; --rule: #2B2F31; --shadow: rgba(0,0,0,0.4); }
:root[data-theme="light"] { --bg: #EEEBE3; --surface: #FBFAF6; --surface-2: #F3F1E9; --ink: #1D211F; --ink-soft: #5B5F5A;
  --accent: #1F6F6B; --accent-soft: #DCEAE8; --warm: #B5793A; --warm-soft: #F3E5D0;
  --illustrative: #6B6A78; --illustrative-soft: #E7E5EF; --rule: #DAD5C8; --shadow: rgba(29,33,31,0.08); }

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif; line-height: 1.5; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }

.masthead { margin-bottom: 8px; }
.eyebrow { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-soft); }
h1 { font-family: ui-serif, "Iowan Old Style", Charter, Georgia, serif; font-weight: 600; font-size: clamp(28px, 4vw, 38px);
  margin: 6px 0 10px; text-wrap: balance; }
.dek { color: var(--ink-soft); max-width: 62ch; font-size: 15px; margin: 0 0 28px; }

.legend { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 28px; }
.tag { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 10.5px; letter-spacing: 0.03em;
  padding: 3px 9px; border-radius: 3px; white-space: nowrap; }
.tag-real { background: var(--warm-soft); color: var(--warm); }
.tag-illustrative { background: var(--illustrative-soft); color: var(--illustrative); }

.jumpnav { display: flex; flex-wrap: wrap; gap: 6px 10px; padding: 14px 16px; margin-bottom: 36px;
  background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; }
.jumpnav a { font-size: 12.5px; color: var(--accent); text-decoration: none; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
.jumpnav a:hover { text-decoration: underline; }
.jumpnav a:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.type-card { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px;
  padding: 24px 26px 28px; margin-bottom: 22px; box-shadow: 0 1px 2px var(--shadow); scroll-margin-top: 20px; }
.type-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h2 { font-family: ui-serif, "Iowan Old Style", Charter, Georgia, serif; font-size: 20px; margin: 0; font-weight: 600; }
.type-note { color: var(--ink-soft); font-size: 13px; margin: 8px 0 20px; }
.type-note strong { color: var(--ink); font-weight: 600; }

.channel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
@media (max-width: 760px) { .channel-grid { grid-template-columns: 1fr; } }
.channel { display: flex; flex-direction: column; gap: 4px; }
.channel-label { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11px; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
.field-label { font-size: 11px; color: var(--ink-soft); margin-top: 10px; }
.copy-block { background: var(--surface-2); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px;
  font-size: 12.5px; white-space: pre-wrap; margin: 4px 0 0; }
.mono { font-family: ui-monospace, "SF Mono", Consolas, monospace; }

.li-pair { display: flex; flex-direction: column; gap: 16px; margin-top: 4px; }
.li-variant { border-left: 2px solid var(--rule); padding-left: 12px; }
.micro-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); }
.micro-label.accent { color: var(--accent); }

footer { color: var(--ink-soft); font-size: 12px; margin-top: 30px; }
</style></head>
<body>
<div class="wrap">
  <div class="masthead">
    <div class="eyebrow">Philippe Bosquillon · copy_templates.json review</div>
    <h1>Email + LinkedIn, side by side, by signal type</h1>
    <p class="dek">Generated straight from <code>pipeline/config/copy_templates.json</code> — the same file
    copyEngine.mjs reads in production. Nothing here is hand-duplicated, so it can't drift out of sync the way
    a separate review doc can. Each type shows the email variant, the LinkedIn connection note + first message,
    and — for LinkedIn — both the generic fallback and a targeted illustration of <code>{relevant_case}</code>
    side by side, to calibrate how specific that line should be.</p>
  </div>
  <div class="legend">
    <span class="tag tag-real">real pipeline example</span>
    <span class="tag tag-illustrative">illustrative example</span>
  </div>
  <nav class="jumpnav">${nav}</nav>
  ${sections}
  <footer>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by pipeline/stages/build_copy_review.mjs — rerun anytime after editing copy_templates.json, zero cost (lang forced to 'en', no OpenRouter calls).</footer>
</div>
</body></html>`;

  writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`written: ${OUT_PATH}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
