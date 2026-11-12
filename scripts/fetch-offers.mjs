// Haalt elke week de aanbiedingen van Jumbo en PLUS op en zet ze in Supabase.
// Draait in GitHub Actions (zie .github/workflows/offers.yml).
// Nodig: SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY als omgevingsvariabelen.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { parseOffers, nextTuesday, isoWeek, norm } from './offers-lib.mjs';

const SOURCES = {
  jumbo: ['https://www.jumbo.com/aanbiedingen/nu'],
  plus: ['https://www.plus.nl/aanbiedingen', 'https://www.folderz.nl/winkels/plus/aanbiedingen'],
};
const MIN_OK = 10; // minder gevonden? dan blijven de oude aanbiedingen van die winkel staan

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN } = process.env;
const now = new Date();
const today = now.toISOString().slice(0, 10);
const defaultValidTo = nextTuesday(now);
const { year, week } = isoWeek(now);

async function pageText(browser, store, url) {
  const ctx = await browser.newContext({
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    viewport: { width: 1280, height: 1800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);
  for (const name of [/alle(s)? (cookies )?accepteren/i, /accepteren/i, /akkoord/i, /accept all/i, /^ok$/i]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(1500); break; }
  }
  let last = 0;
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(700);
    for (const name of [/meer laden/i, /toon meer/i, /bekijk meer/i, /laad meer/i]) {
      const b = page.getByRole('button', { name }).first();
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === last && i > 8) break;
    last = h;
  }
  const text = await page.evaluate(() => document.body.innerText);
  fs.appendFileSync(`debug-${store}.txt`, `\n\n===== ${url} =====\n` + text);
  await ctx.close();
  return text;
}

async function main() {
  const browser = await chromium.launch();
  const found = {};
  for (const [store, urls] of Object.entries(SOURCES)) {
    found[store] = [];
    for (const url of urls) {
      try {
        const text = await pageText(browser, store, url);
        found[store].push(...parseOffers(text, store, { now, defaultValidTo }));
      } catch (e) {
        console.error(`[${store}] ophalen mislukt: ${e.message}`);
      }
    }
    // dubbele producten samenvoegen
    const m = new Map();
    for (const o of found[store]) if (!m.has(norm(o.name))) m.set(norm(o.name), o);
    found[store] = [...m.values()].filter(o => !o.validTo || o.validTo >= today);
    console.log(`[${store}] ${found[store].length} aanbiedingen herkend`);
    found[store].slice(0, 12).forEach(o => console.log(`  [${store}] ${o.deal} | ${o.name} | t/m ${o.validTo} | ${o.category}`));
    if (process.env.DEBUG_TEXT || found[store].length < MIN_OK) {
      try {
        const lines = fs.readFileSync(`debug-${store}.txt`, 'utf8').split(/\n+/).map(l => l.trim()).filter(Boolean);
        console.log(`  [${store}] paginatekst: ${lines.length} regels; fragment rond acties:`);
        let shown = 0;
        for (let i = 0; i < lines.length && shown < 25; i++) {
          if (/gratis|korting|halve prijs|\d+\s*voor|^voor\b|actie/i.test(lines[i])) {
            console.log('  >> ' + lines.slice(Math.max(0, i - 3), i + 4).map(x => x.slice(0, 70)).join(' ¦ '));
            shown++; i += 3;
          }
        }
        if (!shown) console.log('  >> eerste regels: ' + lines.slice(0, 60).map(x => x.slice(0, 50)).join(' ¦ '));
      } catch (_) {}
    }
  }
  await browser.close();

  if (DRY_RUN) { console.log(JSON.stringify(found, null, 1).slice(0, 4000)); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt');
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: existing, error } = await sb.from('offers').select('id,data').limit(5000);
  if (error) throw error;
  const status = {};
  for (const [store, offers] of Object.entries(found)) {
    if (offers.length < MIN_OK) {
      status[store] = `niet ververst (${offers.length} herkend)`;
      console.warn(`[${store}] te weinig herkend, oude aanbiedingen blijven staan`);
      continue;
    }
    const names = new Set(offers.map(o => norm(o.name)));
    const del = (existing || []).filter(r => r.data?.store === store &&
      ((r.data?.validTo && r.data.validTo < today) || names.has(norm(r.data?.name)) || String(r.id).startsWith(store[0] + String(year).slice(2) + String(week).padStart(2, '0')))).map(r => r.id);
    for (let i = 0; i < del.length; i += 100) {
      const { error: e } = await sb.from('offers').delete().in('id', del.slice(i, i + 100));
      if (e) throw e;
    }
    const prefix = store[0] + String(year).slice(2) + String(week).padStart(2, '0');
    const rows = offers.map((o, i) => ({ id: `${prefix}-${String(i).padStart(3, '0')}`, data: o }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: e } = await sb.from('offers').upsert(rows.slice(i, i + 200));
      if (e) throw e;
    }
    status[store] = `${offers.length} aanbiedingen`;
  }
  const d = new Date(defaultValidTo);
  const start = new Date(d); start.setUTCDate(d.getUTCDate() - 6);
  const fmt = x => x.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  await sb.from('meta').upsert({ id: 'offers', data: { updatedAt: today, week: `week van wo ${fmt(start)} t/m di ${fmt(d)}`, status } });
  console.log('Klaar:', JSON.stringify(status));
}

main().catch(e => { console.error(e); process.exit(1); });
