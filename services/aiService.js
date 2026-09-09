const db = require('./dbService');

/**
 * Rescrie si sintetizeaza o stire (sau un grup de 2-4 stiri din surse diferite pe acelasi subiect)
 * folosind Google Gemini AI specializat in jurnalism financiar si economic.
 */
async function synthesizeMultiSourceArticle(cluster) {
  const apiKey = db.getSetting('gemini_api_key', '').trim();
  const model = db.getSetting('ai_model', 'gemini-1.5-flash');

  const sourcesList = cluster.map(c => ({
    name: c.sourceName,
    title: c.title,
    link: c.link
  }));

  const primaryItem = cluster[0];

  // Fallback demo daca nu este setata o cheie API
  if (!apiKey) {
    const isMulti = cluster.length > 1;
    const titlePrefix = isMulti ? `[Sinteză ${cluster.length} Surse] ` : '';
    return {
      ai_title: `${titlePrefix}${primaryItem.title}`,
      ai_content: cluster.map(c => `(${c.sourceName}): ${cleanHtml(c.content)}`).join('\n\n'),
      ai_summary: cleanHtml(primaryItem.content).slice(0, 160) + '...',
      category: detectFinancialCategory(primaryItem.title + ' ' + primaryItem.content),
      tickers: extractPotentialTickers(cluster.map(c => c.title).join(' ')),
      sources_json: sourcesList,
      is_mock: true
    };
  }

  // Construim materialul sursa pentru AI
  let sourcesPayloadText = '';
  cluster.forEach((item, idx) => {
    sourcesPayloadText += `\n--- SURSA ${idx + 1}: ${item.sourceName} ---\nTITLU: ${item.title}\nTEXT/REZUMAT:\n${cleanHtml(item.content).slice(0, 1800)}\n`;
  });

  const prompt = `
Ești un analist financiar senior și jurnalist de elită pentru o publicație economică de top (în stilul Ziarul Financiar / Financial Times / Bloomberg) în limba română.

Ai primit informații de presă de la ${cluster.length} sursă/surse de încredere:
${sourcesPayloadText}

SARCINA TA:
1. Sintetizează toate aceste relatări într-un singur articol complet, fluent, neutru și profesionist în LIMBA ROMÂNĂ.
2. Dacă sursele raportează cifre concrete (prețuri de acțiuni, procente, cifre de afaceri, decizii ale băncilor centrale), include aceste detalii financiare precise.
3. Dacă sursele conțin nuanțe sau unghiuri diferite de abordare, unifică-le armonios.
4. NU inventa date, nume de companii sau cotații care nu sunt susținute de textele primite.

RĂSPUNDE STRICT ÎN FORMAT JSON VALID, fără markdown exterior în afara JSON-ului:
{
  "ai_title": "Titlu financiar captivant, profesional și clar în română",
  "ai_summary": "Rezumat executiv de 1-2 fraze esențiale pentru un investitor",
  "ai_content": "Articolul complet redactat în 3-4 paragrafe structurate, separate prin linie nouă",
  "category": "Piețe & Burse",
  "tickers": "Ex: NVDA, LMT, LLY, FED sau BNR"
}
* Pentru "category", alege STRICT una dintre următoarele opțiuni în funcție de conținutul știrii:
  - "Piețe & Burse" (evoluția burselor, acțiuni, obligațiuni, indici S&P 500, Nasdaq, Dow Jones)
  - "Companii & Tech" (rezultate corporative, Big Tech, Inteligență Artificială, semiconductori)
  - "Defense & Securitate" (războaie, conflicte militare, NATO, Pentagon, companii de armament: Lockheed Martin, Raytheon, Rheinmetall etc.)
  - "Health & Pharma" (sănătate, companii farmaceutice: Eli Lilly, Novo Nordisk, Pfizer, aprobări FDA, tratamente, spitale)
  - "Macroeconomie" (creștere economică PIB, inflație, șomaj, taxe, deficite, comerț global)
  - "Energie & Petrol" (prețul petrolului, gaze naturale, OPEC, energie nucleară, regenerabile)
  - "Bănci & Politică" (bănci centrale: Fed, BCE, BNR, dobânzi de referință, decizii guvernamentale majore)
  - "România" (evenimente economice, fiscale și de afaceri specifice României)
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1200
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Eroare Gemini API:', response.status, errText);
      return {
        ai_title: primaryItem.title,
        ai_content: cleanHtml(primaryItem.content),
        ai_summary: primaryItem.title,
        category: detectFinancialCategory(primaryItem.title + ' ' + primaryItem.content),
        tickers: extractPotentialTickers(primaryItem.title),
        sources_json: sourcesList,
        is_mock: true
      };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let cleanedJsonText = rawText.trim();
    if (cleanedJsonText.startsWith('```json')) {
      cleanedJsonText = cleanedJsonText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanedJsonText.startsWith('```')) {
      cleanedJsonText = cleanedJsonText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleanedJsonText);
    const validatedCategory = normalizeCategory(parsed.category) || detectFinancialCategory(primaryItem.title + ' ' + primaryItem.content);
    return {
      ai_title: parsed.ai_title || primaryItem.title,
      ai_content: parsed.ai_content || cleanHtml(primaryItem.content),
      ai_summary: parsed.ai_summary || '',
      category: validatedCategory,
      tickers: parsed.tickers || extractPotentialTickers(primaryItem.title),
      sources_json: sourcesList,
      is_mock: false
    };

  } catch (err) {
    console.error('Eroare la sinteza AI:', err.message);
    return {
      ai_title: primaryItem.title,
      ai_content: cleanHtml(primaryItem.content),
      ai_summary: primaryItem.title,
      category: detectFinancialCategory(primaryItem.title + ' ' + primaryItem.content),
      tickers: extractPotentialTickers(primaryItem.title),
      sources_json: sourcesList,
      is_mock: true
    };
  }
}

const VALID_CATEGORIES = [
  'Piețe & Burse',
  'Companii & Tech',
  'Defense & Securitate',
  'Health & Pharma',
  'Macroeconomie',
  'Energie & Petrol',
  'Bănci & Politică',
  'România'
];

function normalizeCategory(cat) {
  if (!cat) return null;
  const c = cat.trim().toLowerCase();
  for (const valid of VALID_CATEGORIES) {
    if (valid.toLowerCase() === c) return valid;
  }
  if (c.includes('defense') || c.includes('defens') || c.includes('aparare') || c.includes('armament') || c.includes('razboi')) return 'Defense & Securitate';
  if (c.includes('health') || c.includes('pharma') || c.includes('sanatate') || c.includes('medic')) return 'Health & Pharma';
  if (c.includes('energie') || c.includes('petrol') || c.includes('oil')) return 'Energie & Petrol';
  if (c.includes('banc') || c.includes('politic') || c.includes('fed')) return 'Bănci & Politică';
  if (c.includes('romani')) return 'România';
  if (c.includes('tech') || c.includes('compani')) return 'Companii & Tech';
  if (c.includes('macro') || c.includes('economi')) return 'Macroeconomie';
  if (c.includes('piet') || c.includes('burs') || c.includes('market')) return 'Piețe & Burse';
  return null;
}

function cleanHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFinancialCategory(text) {
  const t = text.toLowerCase();

  // Defense & Securitate (Apărare, Războaie, Armată, Companii de armament)
  if (
    t.includes('defense') || t.includes('defence') || t.includes('military') || t.includes('pentagon') ||
    t.includes('weapon') || t.includes('missile') || t.includes('arms ') || t.includes('nato') ||
    t.includes('army') || t.includes('war ') || t.includes('lockheed') || t.includes('raytheon') ||
    t.includes('rtx') || t.includes('general dynamics') || t.includes('northrop') || t.includes('rheinmetall') ||
    t.includes('război') || t.includes('razboi') || t.includes('armată') || t.includes('armata') ||
    t.includes('armament') || t.includes('rachet') || t.includes('tanc') || t.includes('dronă') ||
    t.includes('drone') || t.includes('ucraina') || t.includes('ukraine') || t.includes('rusia') ||
    t.includes('russia') || t.includes('israel') || t.includes('gaza') || t.includes('iran') ||
    t.includes('frontul') || t.includes('militar') || t.includes('trupe')
  ) {
    return 'Defense & Securitate';
  }

  // Health & Pharma (Sănătate, Medicină, Biotech, Companii farmaceutice)
  if (
    t.includes('health') || t.includes('pharma') || t.includes('fda') || t.includes('drug') ||
    t.includes('vaccine') || t.includes('cancer') || t.includes('biotech') || t.includes('hospital') ||
    t.includes('clinical') || t.includes('medicine') || t.includes('patient') || t.includes('disease') ||
    t.includes('eli lilly') || t.includes('novo nordisk') || t.includes('pfizer') || t.includes('moderna') ||
    t.includes('astrazeneca') || t.includes('roche') || t.includes('novartis') || t.includes('sanofi') ||
    t.includes('sănătate') || t.includes('sanatate') || t.includes('medic') || t.includes('spital') ||
    t.includes('tratament') || t.includes('farmac') || t.includes('virus') || t.includes('vaccin') ||
    t.includes('boală') || t.includes('boala') || t.includes('pacient')
  ) {
    return 'Health & Pharma';
  }

  // Energie & Petrol
  if (
    t.includes('oil') || t.includes('crude') || t.includes('petrol') || t.includes('brent') ||
    t.includes('gas ') || t.includes('gaze') || t.includes('opec') || t.includes('barrel') ||
    t.includes('baril') || t.includes('chevron') || t.includes('exxon') || t.includes('shell') ||
    t.includes('bp ') || t.includes('energie') || t.includes('nuclear') || t.includes('gazprom') ||
    t.includes('omv') || t.includes('electrica') || t.includes('hidroelectrica')
  ) {
    return 'Energie & Petrol';
  }

  // Bănci & Politică
  if (
    t.includes('fed ') || t.includes('federal reserve') || t.includes('ecb') || t.includes('bnr') ||
    t.includes('bancă centrală') || t.includes('banca centrala') || t.includes('central bank') ||
    t.includes('dobând') || t.includes('doband') || t.includes('interest rate') || t.includes('rate cut') ||
    t.includes('rate hike') || t.includes('powell') || t.includes('lagarde') || t.includes('isarescu') ||
    t.includes('guvern') || t.includes('parlament') || t.includes('alegeri') || t.includes('ministru') ||
    t.includes('senat') || t.includes('politica monetara')
  ) {
    return 'Bănci & Politică';
  }

  // România
  if (
    t.includes('românia') || t.includes('romania') || t.includes('bucurești') || t.includes('bucuresti') ||
    t.includes('anaf') || t.includes('ciolacu') || t.includes('pnl') || t.includes('psd') ||
    t.includes('usr') || t.includes('leul') || t.includes('ron ') || t.includes('ministerul finantelor') ||
    t.includes('bugetul de stat') || t.includes('rectificare bugetara')
  ) {
    return 'România';
  }

  // Companii & Tech
  if (
    t.includes('tech') || t.includes('ai ') || t.includes('artificial intelligence') ||
    t.includes('nvidia') || t.includes('apple') || t.includes('microsoft') || t.includes('google') ||
    t.includes('alphabet') || t.includes('amazon') || t.includes('tesla') || t.includes('meta ') ||
    t.includes('semiconductor') || t.includes('chips') || t.includes('software') || t.includes('cloud') ||
    t.includes('intel') || t.includes('amd') || t.includes('tsmc') || t.includes('openai')
  ) {
    return 'Companii & Tech';
  }

  // Macroeconomie
  if (
    t.includes('gdp') || t.includes('pib') || t.includes('inflație') || t.includes('inflatie') ||
    t.includes('inflation') || t.includes('cpi') || t.includes('recesiune') || t.includes('recession') ||
    t.includes('deficit') || t.includes('datorie') || t.includes('debt') || t.includes('somaj') ||
    t.includes('unemployment') || t.includes('tax ') || t.includes('impozit') || t.includes('salariu')
  ) {
    return 'Macroeconomie';
  }

  // Default: Piețe & Burse
  return 'Piețe & Burse';
}

function extractPotentialTickers(text) {
  const tickers = [];
  const matches = text.match(/\b[A-Z]{2,5}\b/g) || [];
  const commonWords = new Set(['THE', 'AND', 'FOR', 'NEW', 'NOW', 'WHY', 'HOW', 'ALL', 'OUT', 'TOP', 'GET', 'HAS', 'ARE', 'WAS', 'BUT', 'NOT']);
  for (const m of matches) {
    if (!commonWords.has(m) && !tickers.includes(m)) {
      tickers.push(m);
      if (tickers.length >= 3) break;
    }
  }
  return tickers.join(', ');
}

module.exports = {
  synthesizeMultiSourceArticle,
  cleanHtml,
  detectFinancialCategory,
  normalizeCategory,
  VALID_CATEGORIES
};
