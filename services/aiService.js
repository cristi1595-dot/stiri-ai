const db = require('./dbService');

/**
 * Rescrie si sintetizeaza o stire folosind Gemini AI.
 * Daca nu este setata o cheie API, va folosi modul demo pentru testare imediata.
 */
async function rewriteArticleWithAI({ title, content, sourceName, link }) {
  const apiKey = db.getSetting('gemini_api_key', '').trim();
  const model = db.getSetting('ai_model', 'gemini-1.5-flash');

  // Daca nu exista cheie, oferim un raspuns simulat curat
  if (!apiKey) {
    return {
      ai_title: `${title}`,
      ai_content: cleanHtml(content) || 'Conținut indisponibil pentru această știre.',
      ai_summary: (cleanHtml(content) || title).slice(0, 150) + '...',
      category: detectCategory(title + ' ' + content),
      is_mock: true
    };
  }

  const prompt = `
Ești un jurnalist profesionist și redactor de știri neutru pentru un portal românesc de știri.
Ai primit următorul material de presă preluat de la sursa "${sourceName}":

TITLU ORIGINAL: ${title}
TEXT ORIGINAL:
${cleanHtml(content).slice(0, 2500)}

SARCINĂ:
Rescrie această știre complet originală, fluentă, neutră și atractivă în limba română.
Păstrează doar faptele reale relatate în text (nu inventa date, nume sau declarații).

Răspunde STRICT în format JSON valid, fără alte explicații sau blocuri de cod markdown în afara JSON-ului:
{
  "ai_title": "Titlu concis, profesional și captivant",
  "ai_content": "Articolul reformulat în 2-4 paragrafe clare, separate prin linie nouă",
  "ai_summary": "Un rezumat de 1-2 propoziții al știrii",
  "category": "Actualitate" (alege una dintre: Actualitate, Politică, Economie, Tehnologie, Sport, Sănătate, Auto)
}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: prompt }] }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1000
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Eroare Gemini API:', response.status, errText);
      // Fallback
      return {
        ai_title: title,
        ai_content: cleanHtml(content),
        ai_summary: title,
        category: detectCategory(title),
        is_mock: true,
        error: `Gemini API a returnat cod ${response.status}`
      };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extragem JSON-ul din raspuns
    let cleanedJsonText = rawText.trim();
    if (cleanedJsonText.startsWith('```json')) {
      cleanedJsonText = cleanedJsonText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanedJsonText.startsWith('```')) {
      cleanedJsonText = cleanedJsonText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleanedJsonText);
    return {
      ai_title: parsed.ai_title || title,
      ai_content: parsed.ai_content || cleanHtml(content),
      ai_summary: parsed.ai_summary || '',
      category: parsed.category || 'Actualitate',
      is_mock: false
    };
  } catch (err) {
    console.error('Eroare procesare AI:', err.message);
    return {
      ai_title: title,
      ai_content: cleanHtml(content),
      ai_summary: title,
      category: detectCategory(title),
      is_mock: true,
      error: err.message
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

function detectCategory(text) {
  const t = text.toLowerCase();
  if (t.includes('fotbal') || t.includes('meci') || t.includes('liga') || t.includes('sport') || t.includes('tenis')) return 'Sport';
  if (t.includes('guvern') || t.includes('parlament') || t.includes('alegeri') || t.includes('ministru') || t.includes('partid')) return 'Politică';
  if (t.includes('bani') || t.includes('euro') || t.includes('inflație') || t.includes('burs') || t.includes('banca') || t.includes('fiscal')) return 'Economie';
  if (t.includes('ai') || t.includes('telefon') || t.includes('google') || t.includes('apple') || t.includes('internet') || t.includes('software')) return 'Tehnologie';
  if (t.includes('spital') || t.includes('medic') || t.includes('sănătate') || t.includes('virus')) return 'Sănătate';
  return 'Actualitate';
}

module.exports = {
  rewriteArticleWithAI,
  cleanHtml
};
