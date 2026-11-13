// Builds the compact card database used by the app from the open-source
// the-fab-cube/flesh-and-blood-cards dataset.
//
//   node scripts/build-cards.mjs              (download latest from GitHub)
//   node scripts/build-cards.mjs ./card.json  (use a local copy)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/';
const SOURCE = `${BASE}card.json`;

const num = (v) => (v === '' || v == null ? null : Number.isNaN(Number(v)) ? v : Number(v));

async function load() {
  const local = process.argv[2];
  if (local) return JSON.parse(await readFile(local, 'utf8'));
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.json();
}

const raw = await load();
const cards = raw.map((c) => {
  const printing = c.printings.find((p) => p.image_url) ?? c.printings[0];
  const legal = [];
  // banned, suspended and living-legend cards aren't legal
  if (c.blitz_legal && !c.blitz_banned && !c.blitz_suspended && !c.blitz_living_legend) legal.push('blitz');
  if (c.cc_legal && !c.cc_banned && !c.cc_suspended && !c.cc_living_legend) legal.push('cc');
  if (c.silver_age_legal && !c.silver_age_banned) legal.push('sage');
  if (c.commoner_legal && !c.commoner_banned && !c.commoner_suspended) legal.push('commoner');
  if (c.ll_legal && !c.ll_banned) legal.push('ll');
  return {
    id: c.unique_id,
    name: c.name,
    pitch: num(c.pitch),
    cost: num(c.cost),
    power: num(c.power),
    defense: num(c.defense),
    health: num(c.health),
    intellect: num(c.intelligence),
    arcane: num(c.arcane),
    types: c.types,
    traits: c.traits,
    keywords: [...new Set([...c.card_keywords, ...c.granted_keywords])],
    text: c.functional_text_plain,
    typeText: c.type_text,
    legal,
    rarity: printing?.rarity ?? '',
    sets: [...new Set(c.printings.map((p) => p.set_id))],
    printId: printing?.id ?? '',
    image: printing?.image_url ?? '',
  };
});
cards.sort((a, b) => a.name.localeCompare(b.name) || (a.pitch ?? 0) - (b.pitch ?? 0));
await mkdir('public/data', { recursive: true });
await writeFile(
  'public/data/cards.json',
  JSON.stringify({ source: SOURCE, builtAt: new Date().toISOString(), cards }),
);
console.log(`Wrote ${cards.length} cards to public/data/cards.json`);

// official keyword definitions (shown as "Rules" on each card)
try {
  const local = process.argv[2];
  const kw = local ? [] : await (await fetch(`${BASE}keyword.json`)).json();
  const out = Object.fromEntries(kw.filter((k) => k.description_plain).map((k) => [k.name, k.description_plain]));
  if (Object.keys(out).length) {
    await writeFile('public/data/keywords.json', JSON.stringify(out));
    console.log(`Wrote ${Object.keys(out).length} keyword definitions to public/data/keywords.json`);
  }
} catch (e) {
  console.warn('Keyword definitions not updated:', e.message);
}
