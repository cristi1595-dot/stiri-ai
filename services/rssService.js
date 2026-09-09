const Parser = require('rss-parser');
const db = require('./dbService');
const ai = require('./aiService');
const wp = require('./wordpressService');

const parser = new Parser({
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

/**
 * Extrage imaginea dintr-un element RSS
 */
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

/**
 * Scaneaza toate sursele active si adauga articolele noi
 */
async function fetchAllFeeds({ maxPerFeed = 5, useAi = true } = {}) {
  const sources = db.getEnabledSources();
  let totalNew = 0;
  const results = [];

  for (const source of sources) {
    try {
      console.log(`[RSS] Scanare sursă: ${source.name} (${source.url})...`);
      const feed = await parser.parseURL(source.url);
      const items = feed.items.slice(0, maxPerFeed);
      let newCount = 0;

      for (const item of items) {
        if (!item.link || !item.title) continue;

        // Pregatire date de baza
        const title = item.title.trim();
        const content = item.content || item['content:encoded'] || item.contentSnippet || item.summary || '';
        const img = extractImage(item);
        const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

        // Verificam rescrierea cu AI
        let aiResult = {
          ai_title: title,
          ai_content: ai.cleanHtml(content),
          ai_summary: ai.cleanHtml(content).slice(0, 160) + '...',
          category: source.category || 'Actualitate'
        };

        if (useAi) {
          try {
            aiResult = await ai.rewriteArticleWithAI({
              title,
              content,
              sourceName: source.name,
              link: item.link
            });
          } catch (e) {
            console.error(`Eroare AI pentru "${title}":`, e.message);
          }
        }

        const articleId = db.insertArticle({
          source_name: source.name,
          source_url: source.url,
          original_title: title,
          original_link: item.link,
          original_description: ai.cleanHtml(content),
          ai_title: aiResult.ai_title,
          ai_content: aiResult.ai_content,
          ai_summary: aiResult.ai_summary,
          category: aiResult.category,
          image_url: img,
          published_at: pubDate,
          status: 'published'
        });

        if (articleId) {
          newCount++;
          totalNew++;

          // Sincronizare automata cu WordPress daca este activata
          const autoSyncWp = db.getSetting('auto_sync_wp', '0') === '1';
          if (autoSyncWp) {
            wp.publishToWordPress(articleId).catch(err => {
              console.error(`[WP AutoSync] Eroare postare articol #${articleId}:`, err.message);
            });
          }
        }
      }

      results.push({ source: source.name, newArticles: newCount, success: true });
    } catch (err) {
      console.error(`[RSS] Eroare scanare ${source.name}:`, err.message);
      results.push({ source: source.name, error: err.message, success: false });
    }
  }

  return { totalNew, details: results };
}

module.exports = {
  fetchAllFeeds
};
