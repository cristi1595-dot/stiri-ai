const Parser = require('rss-parser');
const db = require('./dbService');
const ai = require('./aiService');
const wp = require('./wordpressService');

const parser = new Parser({
  timeout: 12000,
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['enclosure', 'enclosure']
    ]
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

function extractImage(item) {
  if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
    return item.enclosure.url;
  }
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
    return item.mediaContent.$.url;
  }
  if (item.content) {
    const match = item.content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) return match[1];
  }
  if (item.contentSnippet) {
    const match = item.contentSnippet.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) return match[1];
  }
  return null;
}

// Stopwords pentru compararea inteligenta de stiri
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among',
  'de', 'la', 'in', 'pe', 'cu', 'si', 'sau', 'un', 'o', 'din', 'pentru', 'care', 'este', 'sunt', 'fost', 'mai', 'ale', 'lui', 'cum', 'dupa', 'prin'
]);

function extractKeywords(text) {
  if (!text) return new Set();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9ăîâșț\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Calculeaza gradul de similitudine dintre doua stiri
 */
function calculateSimilarity(itemA, itemB) {
  const kwA = extractKeywords(itemA.title + ' ' + (itemA.content || ''));
  const kwB = extractKeywords(itemB.title + ' ' + (itemB.content || ''));

  if (kwA.size === 0 || kwB.size === 0) return 0;

  let common = 0;
  for (const w of kwA) {
    if (kwB.has(w)) common++;
  }

  // Coeficient Jaccard ponderat
  const similarity = (2 * common) / (kwA.size + kwB.size);

  // Bonus daca ambele titluri contin aceeasi entitate majora (ex: Apple, Nvidia, Fed, Trump, BNR, ECB)
  const titleWordsA = itemA.title.toLowerCase().split(/\s+/);
  const titleWordsB = itemB.title.toLowerCase().split(/\s+/);
  let entityMatch = false;
  for (const wa of titleWordsA) {
    if (wa.length >= 4 && !STOPWORDS.has(wa) && titleWordsB.includes(wa)) {
      entityMatch = true;
      break;
    }
  }

  return similarity + (entityMatch ? 0.25 : 0);
}

/**
 * Grupeaza articolele noi pe acelasi subiect (Clustering)
 */
function clusterArticles(rawArticles) {
  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < rawArticles.length; i++) {
    if (visited.has(i)) continue;

    const cluster = [rawArticles[i]];
    visited.add(i);

    // Cautam stiri din alte surse care vorbesc despre acelasi subiect
    for (let j = i + 1; j < rawArticles.length; j++) {
      if (visited.has(j)) continue;

      // Nu grupam 2 stiri de la aceeasi publicatie
      if (rawArticles[j].sourceName === rawArticles[i].sourceName) continue;

      const sim = calculateSimilarity(rawArticles[i], rawArticles[j]);
      if (sim >= 0.35) {
        cluster.push(rawArticles[j]);
        visited.add(j);
        // Limitam la maxim 4 surse per cluster pentru sinteza ideala
        if (cluster.length >= 4) break;
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Scaneaza toate fluxurile, grupeaza subiectele comune si genereaza sinteze
 */
async function fetchAllFeeds({ maxPerFeed = 6, useAi = true } = {}) {
  const sources = db.getEnabledSources();
  const collectedItems = [];

  // 1. Colectam stirile recente de la toate sursele active
  for (const source of sources) {
    try {
      console.log(`[RSS] Scanare: ${source.name}...`);
      const feed = await parser.parseURL(source.url);
      const items = feed.items.slice(0, maxPerFeed);

      for (const item of items) {
        if (!item.link || !item.title) continue;

        // Sarim peste cele deja existente in baza de date
        if (db.articleExistsByLink(item.link)) continue;

        const content = item.content || item['content:encoded'] || item.contentSnippet || item.summary || '';
        collectedItems.push({
          sourceName: source.name,
          sourceUrl: source.url,
          title: item.title.trim(),
          content: ai.cleanHtml(content),
          link: item.link,
          imageUrl: extractImage(item),
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(`[RSS] Eroare la ${source.name}:`, err.message);
    }
  }

  console.log(`[RSS] Colectate ${collectedItems.length} știri noi neprocesate.`);

  // 2. Gruparea stirilor similare din surse multiple
  const clusters = clusterArticles(collectedItems);
  console.log(`[Clustering] Formate ${clusters.length} subiecte (clustere).`);

  let totalNewArticles = 0;
  let multiSourceCount = 0;

  // 3. Procesam fiecare cluster
  for (const cluster of clusters) {
    const primary = cluster[0];
    const isMultiSource = cluster.length > 1;
    if (isMultiSource) multiSourceCount++;

    let synthesis;
    if (useAi) {
      synthesis = await ai.synthesizeMultiSourceArticle(cluster);
    } else {
      const combinedText = cluster.map(c => c.title + ' ' + c.content).join(' ');
      synthesis = {
        ai_title: primary.title,
        ai_content: primary.content,
        ai_summary: primary.content.slice(0, 150) + '...',
        category: ai.detectFinancialCategory(combinedText),
        tickers: '',
        sources_json: cluster.map(c => ({ name: c.sourceName, title: c.title, link: c.link }))
      };
    }

    // Identificam cea mai buna imagine din cluster
    const bestImage = cluster.find(c => c.imageUrl)?.imageUrl || null;

    // Salvam articolul unificat
    const articleId = db.insertArticle({
      source_name: cluster.map(c => c.sourceName).join(' + '),
      source_url: primary.sourceUrl,
      original_title: primary.title,
      original_link: primary.link,
      original_description: primary.content,
      ai_title: synthesis.ai_title,
      ai_content: synthesis.ai_content,
      ai_summary: synthesis.ai_summary,
      category: synthesis.category,
      tickers: synthesis.tickers,
      sources_json: synthesis.sources_json,
      image_url: bestImage,
      published_at: primary.publishedAt,
      status: 'published'
    });

    if (articleId) {
      totalNewArticles++;

      // Marcam si linkurile secundare din cluster ca procesate in baza de date
      for (let k = 1; k < cluster.length; k++) {
        try {
          db.insertArticle({
            source_name: cluster[k].sourceName,
            source_url: cluster[k].sourceUrl,
            original_title: cluster[k].title,
            original_link: cluster[k].link,
            original_description: cluster[k].content,
            ai_title: synthesis.ai_title,
            status: 'merged' // Marcat ca parte din alt articol
          });
        } catch (e) {}
      }

      // Sincronizare automata cu WordPress daca este activata
      const autoSyncWp = db.getSetting('auto_sync_wp', '0') === '1';
      if (autoSyncWp) {
        wp.publishToWordPress(articleId).catch(err => {
          console.error(`[WP AutoSync] Eroare postare #${articleId}:`, err.message);
        });
      }
    }
  }

  return {
    totalNew: totalNewArticles,
    multiSourceSyntheses: multiSourceCount,
    totalScanned: collectedItems.length
  };
}

module.exports = {
  fetchAllFeeds,
  clusterArticles
};
