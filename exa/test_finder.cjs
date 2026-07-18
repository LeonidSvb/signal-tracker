'use strict';
const fs    = require('fs');
const https = require('https');
const path  = require('path');

const EXA_KEY = '58d10405-552d-4647-86bb-fe88e8310883';
const OUT_DIR  = path.join(__dirname, 'results');

// ─── Тестовые компании ───────────────────────────────────────────────────────

// CAT1 — ICP pass в blitz, но нет контактов
const CAT1 = [
  { name: 'Hügli Nahrungsmittel GmbH',        linkedin_url: 'https://www.linkedin.com/company/h%c3%bcgli-nahrungsmittel-gmbh', domain: 'huegli.com',        country: 'DE', icp_score: 5 },
  { name: 'Suntory Beverage & Food Benelux',   linkedin_url: 'https://www.linkedin.com/company/suntory-beverage-food-benelux', domain: 'schweppessuntorybenelux.com', country: 'BE', icp_score: 4 },
  { name: 'Dr. Klaus Karg GmbH & Co. KG',      linkedin_url: 'https://www.linkedin.com/company/dr-klaus-karg-gmbh-co-kg',     domain: 'dr-karg.de',        country: 'DE', icp_score: 5 },
  { name: 'MDS Holding GmbH',                  linkedin_url: 'https://www.linkedin.com/company/mds-holding-gmbh',              domain: '',                  country: 'DE', icp_score: 5 },
];

// CAT2 — не в нашей DB, ICP неизвестен — только реальные food candidates (рекрутёры excluded)
const CAT2 = [
  { name: 'Ardo',                          linkedin_url: 'https://www.linkedin.com/company/ardo',                   domain: 'ardo.com',              country: 'BE', employees: 1251 },
  { name: 'Intersnack Deutschland SE',     linkedin_url: 'https://www.linkedin.com/company/intersnack',             domain: 'intersnack.de',         country: 'DE', employees: 429  },
  { name: 'DMK Deutsches Milchkontor',     linkedin_url: 'https://www.linkedin.com/company/dmk-deutsches-milchkontor-gmbh', domain: 'dmk.de',  country: 'DE', employees: 1005 },
  { name: 'St Michel Biscuits',            linkedin_url: 'https://www.linkedin.com/company/st-michel-biscuits',    domain: 'entreprise.stmichel.fr', country: 'FR', employees: 924  },
  { name: 'Henry Lambertz GmbH & Co KG',  linkedin_url: 'https://www.linkedin.com/company/henry-lambertz',        domain: 'lambertz.de',           country: 'DE', employees: 256  },
  { name: 'Fromageries de L\'Ermitage',   linkedin_url: 'https://www.linkedin.com/company/fromageries-ermitage',  domain: 'ermitage.com',          country: 'FR', employees: 246  },
  { name: 'Famille Michaud Apiculteurs',   linkedin_url: 'https://www.linkedin.com/company/famille-michaud-apiculteurs', domain: 'famillemichaud.com', country: 'FR', employees: 202 },
  { name: 'Saturn Petcare',               linkedin_url: 'https://www.linkedin.com/company/saturn-petcare',         domain: 'werkenbijsaturnpetcare.nl', country: 'NL', employees: 224 },
  { name: 'Servair',                       linkedin_url: 'https://www.linkedin.com/company/servair',               domain: 'servair.fr',            country: 'FR', employees: 2577 },
  { name: 'Edgard & Cooper',              linkedin_url: 'https://www.linkedin.com/company/edgard-cooper',          domain: 'edgardcooper.com',      country: 'BE', employees: 289  },
];

// ─── Exa API helper ──────────────────────────────────────────────────────────

function exaPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.exa.ai',
      path: endpoint,
      method: 'POST',
      headers: {
        'x-api-key': EXA_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
      },
      timeout: 20000,
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

// ─── TEST A: Company search → description для ICP ───────────────────────────
// Метод: ищем по имени компании + food/sector, просим highlights

async function testCompanySearch(company) {
  const results = {};

  // A1: по домену (если есть)
  if (company.domain) {
    const r = await exaPost('/search', {
      query: `${company.name} food company`,
      numResults: 1,
      includeDomains: [company.domain],
      contents: { text: { maxCharacters: 800 }, highlights: { numSentences: 3, highlightsPerUrl: 2 } },
    });
    results.domain_search = {
      status: r.status,
      found: r.body.results ? r.body.results.length : 0,
      title: r.body.results?.[0]?.title || '',
      text_snippet: (r.body.results?.[0]?.text || '').slice(0, 300),
      highlights: r.body.results?.[0]?.highlights || [],
      url: r.body.results?.[0]?.url || '',
    };
  }

  // A2: category company по имени
  const r2 = await exaPost('/search', {
    query: `${company.name} food production ${company.country}`,
    numResults: 3,
    category: 'company',
    contents: { text: { maxCharacters: 600 } },
  });
  results.category_company = {
    status: r2.status,
    found: r2.body.results ? r2.body.results.length : 0,
    top_url: r2.body.results?.[0]?.url || '',
    top_title: r2.body.results?.[0]?.title || '',
    top_text: (r2.body.results?.[0]?.text || '').slice(0, 300),
  };

  // A3: LinkedIn URL direct content
  if (company.linkedin_url) {
    const liSlug = company.linkedin_url.replace('https://www.linkedin.com/company/', '').replace(/\/+$/, '');
    const r3 = await exaPost('/search', {
      query: `${company.name} linkedin company page about`,
      numResults: 1,
      includeDomains: ['linkedin.com'],
      includeText: liSlug.slice(0, 30),
      contents: { text: { maxCharacters: 800 } },
    });
    results.linkedin_search = {
      status: r3.status,
      found: r3.body.results ? r3.body.results.length : 0,
      url: r3.body.results?.[0]?.url || '',
      text: (r3.body.results?.[0]?.text || '').slice(0, 400),
    };
  }

  return results;
}

// ─── TEST B: People search → executives at company ───────────────────────────
// Метод: ищем LinkedIn профили топ-менеджеров компании

async function testPeopleSearch(company) {
  const results = {};

  // B1: LinkedIn profiles — CEO/MD/DG
  const r1 = await exaPost('/search', {
    query: `${company.name} CEO OR "Managing Director" OR "Directeur Général" OR "Geschäftsführer" site:linkedin.com/in`,
    numResults: 5,
    category: 'linkedin profile',
    contents: { text: { maxCharacters: 400 } },
  });
  results.linkedin_execs = {
    status: r1.status,
    found: r1.body.results ? r1.body.results.length : 0,
    profiles: (r1.body.results || []).map(p => ({
      url: p.url,
      title: p.title,
      text: (p.text || '').slice(0, 200),
    })),
  };

  // B2: plant/ops director level
  const r2 = await exaPost('/search', {
    query: `${company.name} "Plant Director" OR "Werksleiter" OR "Directeur Usine" OR "Operations Director" site:linkedin.com/in`,
    numResults: 5,
    category: 'linkedin profile',
    contents: { text: { maxCharacters: 300 } },
  });
  results.linkedin_ops = {
    status: r2.status,
    found: r2.body.results ? r2.body.results.length : 0,
    profiles: (r2.body.results || []).map(p => ({
      url: p.url,
      title: p.title,
      text: (p.text || '').slice(0, 150),
    })),
  };

  // B3: HR Director (decision maker for exec search purchase)
  const r3 = await exaPost('/search', {
    query: `${company.name} "HR Director" OR "DRH" OR "Personalleiter" OR "HRD" site:linkedin.com/in`,
    numResults: 3,
    category: 'linkedin profile',
    contents: { text: { maxCharacters: 300 } },
  });
  results.linkedin_hr = {
    status: r3.status,
    found: r3.body.results ? r3.body.results.length : 0,
    profiles: (r3.body.results || []).map(p => ({
      url: p.url,
      title: p.title,
    })),
  };

  return results;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const log = [];
  const summary = { cat1: [], cat2_food: [], cat2_recruiters_skipped: 14 };

  console.log('=== EXA FINDER TEST — ' + new Date().toISOString().slice(0, 10) + ' ===\n');
  console.log('Testing CAT1 (ICP known, need contacts): ' + CAT1.length + ' companies');
  console.log('Testing CAT2 (ICP unknown, food only): ' + CAT2.length + ' companies');
  console.log('Skipped: ~14 recruiters/non-ICP from Cat2\n');

  // --- CAT1 ---
  console.log('\n=== CAT1: ICP PASS — NEED CONTACTS ===');
  for (const c of CAT1) {
    console.log('\n--- ' + c.name + ' [' + c.country + ', icp:' + c.icp_score + '] ---');
    const people = await testPeopleSearch(c);

    const row = {
      category: 'cat1',
      company: c.name,
      country: c.country,
      icp_score: c.icp_score,
      domain: c.domain,
      linkedin_url: c.linkedin_url,
      test_people: people,
    };
    log.push(row);
    summary.cat1.push({
      company: c.name,
      execs_found: people.linkedin_execs.found,
      ops_found: people.linkedin_ops.found,
      hr_found: people.linkedin_hr.found,
      sample_profile: people.linkedin_execs.profiles?.[0]?.url || people.linkedin_ops.profiles?.[0]?.url || 'none',
    });

    console.log('  Execs found: ' + people.linkedin_execs.found);
    if (people.linkedin_execs.profiles?.[0]) {
      console.log('  Top exec: ' + people.linkedin_execs.profiles[0].title);
      console.log('  URL: ' + people.linkedin_execs.profiles[0].url);
    }
    console.log('  Ops found: ' + people.linkedin_ops.found);
    console.log('  HR found: ' + people.linkedin_hr.found);
    await new Promise(r => setTimeout(r, 300));
  }

  // --- CAT2 ---
  console.log('\n\n=== CAT2: ICP UNKNOWN — COMPANY INFO + PEOPLE ===');
  for (const c of CAT2) {
    console.log('\n--- ' + c.name + ' [' + c.country + ', emp:' + c.employees + '] ---');
    const company_info = await testCompanySearch(c);
    const people = await testPeopleSearch(c);

    const row = {
      category: 'cat2',
      company: c.name,
      country: c.country,
      employees: c.employees,
      domain: c.domain,
      linkedin_url: c.linkedin_url,
      test_company: company_info,
      test_people: people,
    };
    log.push(row);

    const best_desc = company_info.domain_search?.text_snippet || company_info.category_company?.top_text || '';
    summary.cat2_food.push({
      company: c.name,
      country: c.country,
      employees: c.employees,
      company_info_found: !!(company_info.domain_search?.found || company_info.category_company?.found),
      description_snippet: best_desc.slice(0, 150),
      execs_found: people.linkedin_execs.found,
      ops_found: people.linkedin_ops.found,
      sample_profile: people.linkedin_execs.profiles?.[0]?.url || people.linkedin_ops.profiles?.[0]?.url || 'none',
    });

    console.log('  Company info: domain=' + (company_info.domain_search?.found || 0) + ' cat=' + (company_info.category_company?.found || 0));
    if (best_desc) console.log('  Desc: ' + best_desc.slice(0, 100) + '...');
    console.log('  Execs found: ' + people.linkedin_execs.found + '  Ops: ' + people.linkedin_ops.found);
    if (people.linkedin_execs.profiles?.[0]) console.log('  Top: ' + people.linkedin_execs.profiles[0].title + ' | ' + people.linkedin_execs.profiles[0].url);
    await new Promise(r => setTimeout(r, 300));
  }

  // Save full log
  const outFull = path.join(OUT_DIR, 'exa_finder_test_' + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(outFull, JSON.stringify(log, null, 2), 'utf8');

  // Save summary
  const outSummary = path.join(OUT_DIR, 'exa_finder_summary_' + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8');

  // Print summary table
  console.log('\n\n=== SUMMARY ===');
  console.log('\nCAT1 — contacts found:');
  for (const r of summary.cat1) {
    const total = r.execs_found + r.ops_found + r.hr_found;
    console.log('  ' + r.company + ': execs=' + r.execs_found + ' ops=' + r.ops_found + ' hr=' + r.hr_found + ' | ' + (total > 0 ? 'FOUND' : 'ZERO') + ' | ' + r.sample_profile);
  }
  console.log('\nCAT2 — company info + contacts:');
  for (const r of summary.cat2_food) {
    const total = r.execs_found + r.ops_found;
    console.log('  ' + r.company + ' [' + r.country + ']: info=' + (r.company_info_found ? 'YES' : 'NO') + ' contacts=' + total + (total > 0 ? ' FOUND' : ' ZERO'));
  }

  console.log('\nFull log: ' + outFull);
  console.log('Summary: ' + outSummary);
}

main().catch(console.error);
