// Herkent aanbiedingen in de tekst van de aanbiedingenpagina's van Jumbo en PLUS.
// Werkt op de zichtbare tekst (document.body.innerText), niet op de HTML-opbouw,
// zodat kleine wijzigingen aan de websites minder snel iets breken.

export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const MONTHS = { jan: 0, feb: 1, mrt: 2, maa: 2, apr: 3, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };
const DAY = '(?:ma|di|wo|do|vr|za|zo)[a-z]*\\.?';

// Actieteksten (eerste regel van een aanbieding).
const PROMO = [
  /^\d+\s*\+\s*\d+\s*gratis\b/i,
  /^\d+\s*voor\s*€?\s*\d+[.,]\d{2}\b/i,
  /^\d+\s*voor\s*€?\s*\d+\b/i,
  /^\d+\s*%\s*korting\b/i,
  /^\d+e\s+halve\s+prijs\b/i,
  /^2e\s+gratis\b/i,
  /^\d+e\s+voor\s+€?\s*\d/i,
  /^voor\s*€?\s*\d+[.,]\d{2}\b/i,
  /^\d+[.,]\d{2}\s*per\s*(kilo|kg|100\s*gram|stuk)\b/i,
  /^(actieprijs|nu)\s*€?\s*\d+[.,]\d{2}\b/i,
  /^\d+\s*(gram|g|stuks?)\s*voor\s*€?\s*\d/i,
];
const isPromo = l => PROMO.some(r => r.test(l));
const DATE_RE = new RegExp(`(?:t\\/m|tot en met)\\s*(?:${DAY}\\s*)?(\\d{1,2})\\s*([a-z]{3,})`, 'i');
const NOISE = /^(bekijk|bekijken|in winkelwagen|toevoegen|meer info|alleen online|alleen in de winkel|online|nieuw|op=op|aanbieding|aanbiedingen|filter|sorteer|per gangpad|nu in de aanbieding|toon meer|meer laden|ga naar|lees meer|\+|-|€|€\s*\d.*|\d+[.,]?\d*)$/i;

export function parseDate(text, now = new Date()) {
  const m = String(text).match(DATE_RE);
  if (!m) return null;
  const mon = MONTHS[norm(m[2]).slice(0, 3)];
  if (mon == null) return null;
  let y = now.getFullYear();
  const d = new Date(Date.UTC(y, mon, +m[1]));
  if (d < new Date(Date.UTC(y, now.getMonth(), now.getDate())) - 1000 * 3600 * 24 * 60) d.setUTCFullYear(y + 1);
  return d.toISOString().slice(0, 10);
}

function cleanDeal(l) {
  return l.replace(/\s+/g, ' ').replace(/(\d)\.(\d{2})\b/g, '$1,$2')
    .replace(/^(\d+)\s*voor\s*€?\s*/i, '$1 voor € ').replace(/^voor\s*€?\s*/i, '€ ')
    .replace(/gratis/i, 'gratis').replace(/^(\d+)\s*\+\s*(\d+)/, '$1+$2').trim();
}
function priceFields(deal) {
  let m = deal.match(/^(\d+) voor € (\d+),(\d{2})/);
  if (m) return { price: `${m[1]} voor ${m[2]},${m[3]}`, unitPrice: Math.round((+`${m[2]}.${m[3]}` / +m[1]) * 100) / 100 };
  m = deal.match(/^€ (\d+),(\d{2})$/);
  if (m) return { price: `${m[1]},${m[2]}`, unitPrice: +`${m[1]}.${m[2]}` };
  return {};
}

export function parseOffers(text, store, { now = new Date(), defaultValidTo } = {}) {
  const lines = String(text).split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!isPromo(l) || l.length > 60) continue;
    // productnaam: dichtstbijzijnde regel ervoor (of erna) die geen actie, datum of knop is
    let name = null;
    for (const j of [i - 1, i - 2, i - 3, i + 1, i + 2]) {
      const c = lines[j];
      if (!c || isPromo(c) || DATE_RE.test(c) || NOISE.test(c) || c.length < 3 || c.length > 120) continue;
      if (/^(wo|do|vr|za|zo|ma|di)\b.*\d/i.test(c)) continue;
      name = c; break;
    }
    if (!name) continue;
    let validTo = null;
    for (const j of [i, i + 1, i + 2, i + 3, i - 1, i - 2]) { if (validTo) break; if (lines[j] && !(j < i && isPromo(lines[j]))) validTo = parseDate(lines[j], now); }
    const deal = cleanDeal(l);
    const key = norm(name) + '|' + norm(deal);
    if (seen.has(key)) continue;
    seen.add(key);
    const { category, keywords } = classify(name);
    out.push({ store, name: name.replace(/\s*\|\s*/g, ' ').slice(0, 100), deal, ...priceFields(deal), category, validTo: validTo || defaultValidTo, keywords });
  }
  return out;
}

// Afdeling en zoekwoorden, zodat "melk" op de lijst ook "Campina Langlekker" vindt.
const RULES = [
  ['Groente en fruit', /\b(aardappel|kriel|ui(en)?|knoflook|wortel|peen|broccoli|bloemkool|sperzie|boontjes|komkommer|tomaat|tomaten|paprika|sla|rucola|veldsla|spinazie|champignon|prei|courgette|aubergine|andijvie|boerenkool|spruit|witlof|kool|selderij|appel|banaan|bananen|peer|peren|mandarijn|sinaasappel|druif|druiven|kiwi|avocado|mango|ananas|aardbei|framboos|bessen|bramen|meloen|fruit|groente|kruiden|rauwkost|snoepgroente|snackgroente|kaki)/, null],
  ['Brood en gebak', /\b(brood|bolletjes|broodjes|stokbrood|croissant|krentenbol|rozijnenbol|beschuit|cracker|knackebrod|wraps|tortilla|taart|gebak|cake|schnitte|flatbread)/, null],
  ['Vleeswaren', /\b(ham|salami|boterhamworst|leverworst|filet americain|pate|rosbief|cervelaat)\b/, ['beleg']],
  ['Kaas', /\b(kaas|beemster|gouda|parrano|feta|mozzarella|brie|roomkaas|heks'?nkaas)/, ['kaas']],
  ['Zuivel', /\b(melk|langlekker|yoghurt|kwark|vla|boter|margarine|blue band|room|eieren|pap|optimel|danio|almhof|campina|chocomel|havermelk|oatly)/, null],
  ['Vlees, vis en vega', /\b(gehakt|kip|kipfilet|rund|biefstuk|speklap|spek|bacon|varken|shoarma|hamburger|burger|worst|rookworst|schnitzel|riblap|sukade|stoof|zalm|vis|kabeljauw|garnalen|tonijn|forel|vleesvervanger|tofu|vega|spareribs|sate)/, null],
  ['Diepvries', /\b(diepvries|ijs|patat|friet|nuggets|vissticks|kroket|frikandel|bitterbal|pizza|ben & jerry|topking|iglo)/, null],
  ['Maaltijden', /\b(maaltijd|salade|soep|stamppot|lasagne|verspakket|maaltijdpakket|bapao|loempia|shared dining)/, null],
  ['Voorraadkast', /\b(rijst|pasta|spaghetti|macaroni|noedel|bloem|suiker|olie|olijfolie|bertolli|azijn|ketchup|mayonaise|mosterd|saus|tomatenpuree|bouillon|mix|bonen|conserven|hak|bonduelle|sambal|santa maria|taco|mutti)/, null],
  ['Ontbijt', /\b(hagelslag|pindakaas|jam|honing|appelstroop|muesli|cruesli|havermout|cornflakes|nutella|quaker)/, null],
  ['Koffie en thee', /\b(koffie|dolce gusto|senseo|douwe egberts|thee|lipton|nescafe)/, null],
  ['Chips en snacks', /\b(chips|croky|lay'?s|pringles|doritos|chio|nootjes|pinda|popcorn|toastjes|zoutjes)/, ['chips']],
  ['Snoep en chocolade', /\b(chocola|milka|reep|snoep|drop|kitkat|m&m|tony|verkade)/, ['chocolade']],
  ['Koek', /\b(koek|koekjes|kruidnoten|speculaas|stroopwafel|sultana|lu\b|cookies)/, ['koek']],
  ['Frisdrank', /\b(cola|coca-cola|pepsi|fanta|sprite|fuze|frisdrank|sap|limonade|ranja|siroop|water|ice tea|red bull|monster|capri-sun|innocent)/, ['frisdrank']],
  ['Bier', /\b(bier|pils|heineken|grolsch|amstel|hertog jan|brand|leffe|affligem|texels|radler)/, ['bier']],
  ['Wijn', /\b(wijn|rose|merlot|chardonnay|prosecco|cava)/, ['wijn']],
  ['Drogisterij en huishouden', /\b(wasmiddel|ariel|persil|robijn|wasverzachter|lenor|vaatwas|dreft|sun\b|afwas|schoonmaak|allesreiniger|wc|toiletpapier|page|keukenrol|tandpasta|oral-b|shampoo|douchegel|zeep|deodorant|deo|scheer|luiers|pampers|billendoekjes|maandverband)/, null],
];
const GENERIC = [
  [/langlekker|halfvolle|volle melk|karnemelk/, ['melk', 'halfvolle melk']],
  [/coca-cola|pepsi/, ['cola']],
  [/ariel|persil|robijn/, ['wasmiddel']],
  [/lenor|wasverzachter/, ['wasverzachter']],
  [/dreft|sun\b|vaatwas/, ['vaatwastabletten', 'afwasmiddel']],
  [/page|toiletpapier/, ['wc-papier', 'toiletpapier']],
  [/douwe egberts|aroma rood|senseo/, ['koffie']],
  [/bertolli|olijfolie/, ['olijfolie']],
  [/blue band|margarine/, ['boter']],
  [/beemster|gouda|klaverland/, ['kaas', 'jonge kaas', 'belegen kaas']],
  [/rookworst|unox/, ['rookworst', 'worst']],
  [/kipfilet|\bkip\b/, ['kip', 'kipfilet']],
  [/gehakt/, ['gehakt']],
  [/aardappel|kriel/, ['aardappelen']],
];
export function classify(name) {
  const n = norm(name);
  let category = 'Overig';
  const kw = new Set();
  for (const [cat, re, extra] of RULES) { if (re.test(n)) { category = cat; (extra || []).forEach(k => kw.add(k)); break; } }
  for (const [re, words] of GENERIC) if (re.test(n)) words.forEach(w => kw.add(w));
  n.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !['alle', 'jumbo', 'jumbos', 'plus', 'voor', 'gram', 'stuks', 'biologisch', 'biologische'].includes(w)).slice(0, 4).forEach(w => kw.add(w));
  return { category, keywords: [...kw].slice(0, 8) };
}

export function nextTuesday(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const add = (2 - d.getUTCDay() + 7) % 7 || 7;
  // op dinsdag zelf: vandaag is de laatste dag
  d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 2 ? 0 : add));
  return d.toISOString().slice(0, 10);
}
export function isoWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - y) / 86400000 + 1) / 7) };
}
