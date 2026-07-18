'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const BLITZ_KEY = 'blitz-019f0220-e113-7a16-b722-dce52f40a4fc';
const CONCURRENCY = 10;

// ─── Blitz POST helper ───────────────────────────────────────────────────────

function blitzPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.blitz-api.ai',
      path: endpoint,
      method: 'POST',
      headers: {
        'x-api-key': BLITZ_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
      },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(json);
    req.end();
  });
}

function normalizeLinkedinUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?linkedin\.com/, 'https://www.linkedin.com').replace(/\/$/, '');
}

// ─── Batch runner ─────────────────────────────────────────────────────────────

async function runBatch(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + CONCURRENCY < items.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return results;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const exaLog = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'results', 'exa_finder_test_2026-06-29.json'), 'utf8'
  ));

  // Извлечь все уникальные LinkedIn профили из Exa результатов
  const profileMap = new Map(); // url → { company, category, role_tier, title }

  for (const entry of exaLog) {
    const add = (profiles, tier) => {
      for (const p of profiles || []) {
        if (!p.url || !p.url.includes('linkedin.com/in/')) continue;
        const url = normalizeLinkedinUrl(p.url);
        if (!profileMap.has(url)) {
          profileMap.set(url, {
            linkedin_url: url,
            company: entry.company,
            country: entry.country,
            category: entry.category,
            role_tier: tier,
            title: p.title || '',
          });
        }
      }
    };

    add(entry.test_people?.linkedin_execs?.profiles, 'exec');
    add(entry.test_people?.linkedin_ops?.profiles, 'ops');
    add(entry.test_people?.linkedin_hr?.profiles, 'hr');
  }

  const profiles = Array.from(profileMap.values());
  console.log('=== BLITZ EMAIL LOOKUP — ' + new Date().toISOString().slice(0, 10) + ' ===\n');
  console.log('EXA profiles collected: ' + profiles.length);
  console.log('  exec tier: ' + profiles.filter(p => p.role_tier === 'exec').length);
  console.log('  ops tier:  ' + profiles.filter(p => p.role_tier === 'ops').length);
  console.log('  hr tier:   ' + profiles.filter(p => p.role_tier === 'hr').length);
  console.log('\nRunning Blitz /enrichment/email for each... (concurrency=' + CONCURRENCY + ')\n');

  let done = 0;
  const emailResults = await runBatch(profiles, async (p) => {
    let result;
    try {
      const r = await blitzPost('/v2/enrichment/email', { person_linkedin_url: p.linkedin_url });
      result = {
        ...p,
        blitz_status: r.status,
        found: r.body?.found === true,
        email: r.body?.email || null,
        all_emails: r.body?.all_emails || [],
        error: r.status !== 200 ? (r.body?.message || r.body?.detail || String(r.body)) : null,
      };
    } catch (e) {
      result = { ...p, blitz_status: 0, found: false, email: null, all_emails: [], error: e.message };
    }
    done++;
    if (done % 10 === 0 || done === profiles.length) {
      process.stdout.write('  [' + done + '/' + profiles.length + '] ...\r');
    }
    return result;
  });

  console.log('\n');

  // Статистика
  const found     = emailResults.filter(r => r.found);
  const not_found = emailResults.filter(r => !r.found && !r.error);
  const errors    = emailResults.filter(r => r.error);

  console.log('=== РЕЗУЛЬТАТЫ ===\n');
  console.log('Total profiles:  ' + emailResults.length);
  console.log('Email found:     ' + found.length + ' (' + Math.round(found.length / emailResults.length * 100) + '%)');
  console.log('Not found:       ' + not_found.length + ' (' + Math.round(not_found.length / emailResults.length * 100) + '%)');
  console.log('Errors/other:    ' + errors.length);

  // По tier
  for (const tier of ['exec', 'ops', 'hr']) {
    const tier_all   = emailResults.filter(r => r.role_tier === tier);
    const tier_found = tier_all.filter(r => r.found);
    console.log('\n  [' + tier.toUpperCase() + '] ' + tier_found.length + '/' + tier_all.length + ' found (' + Math.round(tier_found.length / (tier_all.length || 1) * 100) + '%)');
  }

  // По категории
  for (const cat of ['cat1', 'cat2']) {
    const cat_all   = emailResults.filter(r => r.category === cat);
    const cat_found = cat_all.filter(r => r.found);
    console.log('\n  [' + cat.toUpperCase() + '] ' + cat_found.length + '/' + cat_all.length + ' found (' + Math.round(cat_found.length / (cat_all.length || 1) * 100) + '%)');
  }

  // Список найденных
  console.log('\n=== НАЙДЕННЫЕ EMAILS ===\n');
  for (const r of found) {
    console.log('[' + r.role_tier.toUpperCase() + '] ' + r.company + ' (' + r.country + ')');
    console.log('  ' + r.title);
    console.log('  LI: ' + r.linkedin_url);
    console.log('  Email: ' + r.email);
    console.log('');
  }

  // Список не найденных (сокращённо)
  console.log('=== НЕ НАЙДЕНО (' + not_found.length + ' шт.) ===\n');
  for (const r of not_found.slice(0, 20)) {
    console.log('  ' + r.company + ' / ' + r.title + ' / ' + r.linkedin_url);
  }
  if (not_found.length > 20) console.log('  ... ещё ' + (not_found.length - 20) + ' не показано');

  if (errors.length) {
    console.log('\n=== ОШИБКИ ===\n');
    for (const r of errors.slice(0, 5)) {
      console.log('  ' + r.linkedin_url + ' → ' + r.blitz_status + ' ' + r.error);
    }
  }

  // Сохранить полный результат
  const outPath = path.join(__dirname, 'results', 'blitz_email_test_2026-06-29.json');
  fs.writeFileSync(outPath, JSON.stringify(emailResults, null, 2), 'utf8');
  console.log('\nFull result: ' + outPath);

  // Per-company сводка
  console.log('\n=== ПО КОМПАНИЯМ ===\n');
  const companies = [...new Set(emailResults.map(r => r.company))];
  for (const co of companies) {
    const co_all   = emailResults.filter(r => r.company === co);
    const co_found = co_all.filter(r => r.found);
    const cat = co_all[0].category;
    const sample = co_found[0]?.email || 'no email';
    console.log('[' + cat.toUpperCase() + '] ' + co + ': ' + co_found.length + '/' + co_all.length + ' emails | sample: ' + sample);
  }
}

main().catch(console.error);
