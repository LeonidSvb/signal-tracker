#!/usr/bin/env node
// Static HTML report of Exa-signal companies for Philippe — company + signal + contacts
// (LinkedIn + inferred email), no frontend needed. Read-only, no external API calls, safe to
// rerun anytime. Mirrors nextjs/src/hooks/useLeads.ts's data shape (same fields, same source
// tables) so it stays consistent with the real frontend once that ships.
//
// Email status note: emails come from Blitz's pattern-inference (source='blitz',
// email_status='inferred') — NOT SMTP-validated. Per project rule, real validation goes through
// a separate manual-upload flow (save to Downloads, upload to BounceBan/mails.so/MV, bring back
// results) — this report labels inferred emails as such rather than presenting them as verified.
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/build_signal_report.mjs [--out=path]

import { writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { selectAll } from '../lib/supabase.mjs';
import { getClientId } from '../lib/log.mjs';

const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const outArg = process.argv.find(a => a.startsWith('--out='));
const OUT_PATH = outArg ? outArg.split('=')[1] : `C:/Users/79818/Downloads/philippe_exa_signals_${new Date().toISOString().slice(0, 10)}.html`;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

export async function run() {
  console.log('\n=== build_signal_report.mjs ===');
  const clientId = await getClientId(CLIENT_SLUG);

  const [companies, signals, contacts] = await Promise.all([
    selectAll('companies', { client_id: clientId }),
    selectAll('signals', { client_id: clientId, source: 'exa' }),
    selectAll('contacts', { client_id: clientId }),
  ]);

  const companyById = new Map(companies.map(c => [c.id, c]));
  const signalsByCompany = new Map();
  for (const s of signals) {
    if (!s.company_id) continue;
    if (!signalsByCompany.has(s.company_id)) signalsByCompany.set(s.company_id, []);
    signalsByCompany.get(s.company_id).push(s);
  }
  const contactsByCompany = new Map();
  for (const c of contacts) {
    if (!contactsByCompany.has(c.company_id)) contactsByCompany.set(c.company_id, []);
    contactsByCompany.get(c.company_id).push(c);
  }

  const rows = [...signalsByCompany.keys()]
    .map(companyId => {
      const company = companyById.get(companyId);
      if (!company) return null;
      const compSignals = signalsByCompany.get(companyId).sort((a, b) => (b.score || 0) - (a.score || 0));
      const compContacts = (contactsByCompany.get(companyId) || []).sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
      return { company, signals: compSignals, contacts: compContacts, score: compSignals[0]?.score || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const stats = {
    companies: rows.length,
    withLinkedin: rows.filter(r => r.company.linkedin_url).length,
    withContact: rows.filter(r => r.contacts.length > 0).length,
    withEmail: rows.filter(r => r.contacts.some(c => c.email)).length,
    totalContacts: rows.reduce((n, r) => n + r.contacts.length, 0),
  };
  console.log(JSON.stringify(stats, null, 2));

  const rowsHtml = rows.map(({ company, signals: sigs, contacts: cons }) => {
    const primary = sigs[0];
    const signalsHtml = sigs.map(s => `
      <div class="signal">
        <div class="signal-title">${esc(s.title || '(no title)')}</div>
        <div class="signal-meta">${esc(s.source || '')} · ${s.pub_date ? esc(new Date(s.pub_date).toISOString().slice(0, 10)) : ''} (${daysAgo(s.pub_date) ?? '?'}d ago) · ${esc(s.country || '')}${s.source_url ? ` · <a href="${esc(s.source_url)}" target="_blank">source</a>` : ''}</div>
        ${s.angle ? `<div class="signal-angle">${esc(s.angle)}</div>` : ''}
      </div>`).join('');

    const contactsHtml = cons.length
      ? cons.map(c => `
        <tr>
          <td>${esc(c.full_name || '')}</td>
          <td>${esc(c.title || '')}</td>
          <td>${c.email ? esc(c.email) : '<span class="muted">none found</span>'}</td>
          <td>${c.email ? `<span class="badge badge-${esc(c.email_status || 'inferred')}">${esc(c.email_status || 'inferred')}</span>` : ''}</td>
          <td>${c.linkedin_url ? `<a href="${esc(c.linkedin_url)}" target="_blank">profile</a>` : ''}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="muted">No contacts found yet</td></tr>`;

    return `
    <div class="company-card">
      <div class="company-header">
        <div>
          <h3>${esc(company.name)}</h3>
          <div class="company-meta">
            ${company.domain ? `<a href="https://${esc(company.domain)}" target="_blank">${esc(company.domain)}</a> · ` : ''}
            ${company.linkedin_url ? `<a href="${esc(company.linkedin_url)}" target="_blank">LinkedIn</a> · ` : '<span class="muted">no LinkedIn</span> · '}
            ${esc(company.industry || 'industry unknown')} · ${company.employees ? `${company.employees} employees` : 'size unknown'} · ${esc(company.hq_country || '?')}
          </div>
        </div>
        <div class="score">score ${primary?.score ?? 0}</div>
      </div>
      <div class="signals">${signalsHtml}</div>
      <table class="contacts">
        <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Status</th><th>LinkedIn</th></tr></thead>
        <tbody>${contactsHtml}</tbody>
      </table>
    </div>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Philippe Bosquillon — Exa Signal Report — ${new Date().toISOString().slice(0, 10)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #f6f6f4; color: #1a1a1a; margin: 0; padding: 24px; }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 4px; }
  .stats { display: flex; gap: 16px; margin: 16px 0 24px; flex-wrap: wrap; }
  .stat { background: #fff; border: 1px solid #e0e0dc; border-radius: 8px; padding: 10px 14px; font-size: 13px; }
  .stat b { display: block; font-size: 18px; }
  .note { background: #fff8e6; border: 1px solid #f0d98c; border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 24px; }
  .company-card { background: #fff; border: 1px solid #e0e0dc; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  .company-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .company-header h3 { margin: 0 0 4px; font-size: 16px; }
  .company-meta { font-size: 12px; color: #666; }
  .company-meta a { color: #2563eb; text-decoration: none; }
  .score { background: #eef2ff; color: #3730a3; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
  .signals { margin: 10px 0; }
  .signal { border-left: 3px solid #d1d5db; padding: 4px 0 4px 10px; margin-bottom: 6px; }
  .signal-title { font-size: 13px; font-weight: 600; }
  .signal-meta { font-size: 11px; color: #888; }
  .signal-meta a { color: #2563eb; }
  .signal-angle { font-size: 12px; color: #444; font-style: italic; margin-top: 2px; }
  table.contacts { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  table.contacts th { text-align: left; color: #888; font-weight: 500; padding: 4px 6px; border-bottom: 1px solid #eee; }
  table.contacts td { padding: 4px 6px; border-bottom: 1px solid #f2f2f0; }
  table.contacts a { color: #2563eb; text-decoration: none; }
  .muted { color: #aaa; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: #f3f4f6; color: #555; }
  .badge-inferred { background: #fef3c7; color: #92400e; }
  .badge-verified { background: #d1fae5; color: #065f46; }
</style></head>
<body><div class="wrap">
  <h1>Exa Signal Report — Philippe Bosquillon</h1>
  <div class="subtitle">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${stats.companies} companies with a resolved signal</div>
  <div class="stats">
    <div class="stat"><b>${stats.companies}</b>companies</div>
    <div class="stat"><b>${stats.withLinkedin}</b>with LinkedIn</div>
    <div class="stat"><b>${stats.withContact}</b>with contact(s)</div>
    <div class="stat"><b>${stats.withEmail}</b>with email</div>
    <div class="stat"><b>${stats.totalContacts}</b>total contacts</div>
  </div>
  <div class="note">Emails are pattern-inferred by Blitz (first.last@domain style, "inferred" badge) — not yet SMTP-validated. A validation pass before sending is a separate step.</div>
  ${rowsHtml}
</div></body></html>`;

  writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`\nwritten: ${OUT_PATH}`);
  console.log('=== DONE ===');
  return { ...stats, outPath: OUT_PATH };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
