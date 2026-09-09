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
  "tickers": "Ex: NVDA, AAPL, FED sau BNR"
}
* Pentru "category", alege una dintre: Piețe & Burse, Companii & Tech, Macroeconomie, Energie & Materii prime, Politică & Bănci Centrale, Sănătate.
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
        category: detectFinancialCategory(primaryItem.title),
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
    return {
      ai_title: parsed.ai_title || primaryItem.title,
      ai_content: parsed.ai_content || cleanHtml(primaryItem.content),
      ai_summary: parsed.ai_summary || '',
      category: parsed.category || detectFinancialCategory(primaryItem.title),
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
      category: detectFinancialCategory(primaryItem.title),
      tickers: extractPotentialTickers(primaryItem.title),
      sources_json: sourcesList,
      is_mock: true
    };
  }
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
  if (t.includes('oil') || t.includes('petrol') || t.includes('gaz') || t.includes('energie') || t.includes('nuclear')) return 'Energie & Materii prime';
  if (t.includes('fed') || t.includes('central bank') || t.includes('banca') || t.includes('doband') || t.includes('inflation') || t.includes('inflatie') || t.includes('bnr') || t.includes('ecb')) return 'Politică & Bănci Centrale';
  if (t.includes('stock') || t.includes('shares') || t.includes('market') || t.includes('bursa') || t.includes('s&p') || t.includes('nasdaq') || t.includes('dow') || t.includes('wall street')) return 'Piețe & Burse';
  if (t.includes('ai') || t.includes('tech') || t.includes('nvidia') || t.includes('apple') || t.includes('microsoft') || t.includes('google') || t.includes('tesla') || t.includes('meta')) return 'Companii & Tech';
  if (t.includes('gdp') || t.includes('pib') || t.includes('tax') || t.includes('deficit') || t.includes('economie')) return 'Macroeconomie';
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
  cleanHtml
};
