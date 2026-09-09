const express = require('express');
const cron = require('node-cron');
const path = require('path');
const db = require('./services/dbService');
const rss = require('./services/rssService');
const ai = require('./services/aiService');
const wp = require('./services/wordpressService');

const app = express();
const PORT = process.env.PORT || 3000;

// Initializare baza de date
db.initDb();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======================== API ARTICOLE ======================== //

// Lista articole cu filtrare si cautare
app.get('/api/articles', (req, res) => {
  try {
    const { category, search, limit = 30, offset = 0 } = req.query;
    const articles = db.getArticles({ category, search, limit, offset });
    res.json({ success: true, articles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Detalii articol
app.get('/api/articles/:id', (req, res) => {
  try {
    const article = db.getArticleById(req.params.id);
    if (!article) return res.status(404).json({ success: false, error: 'Articol negăsit' });
    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rescrie articol manual cu AI
app.post('/api/articles/:id/rewrite', async (req, res) => {
  try {
    const article = db.getArticleById(req.params.id);
    if (!article) return res.status(404).json({ success: false, error: 'Articol negăsit' });

    const aiResult = await ai.rewriteArticleWithAI({
      title: article.original_title,
      content: article.original_description,
      sourceName: article.source_name,
      link: article.original_link
    });

    db.updateArticleAI(article.id, {
      ai_title: aiResult.ai_title,
      ai_content: aiResult.ai_content,
      ai_summary: aiResult.ai_summary,
      category: aiResult.category
    });

    res.json({ success: true, aiResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trimite articol catre WordPress
app.post('/api/articles/:id/publish-wp', async (req, res) => {
  try {
    const result = await wp.publishToWordPress(req.params.id);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================== API SURSE ======================== //

app.get('/api/sources', (req, res) => {
  try {
    const sources = db.getSources();
    res.json({ success: true, sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sources', (req, res) => {
  try {
    const { name, url, category } = req.body;
    if (!name || !url) {
      return res.status(400).json({ success: false, error: 'Numele și URL-ul sunt obligatorii.' });
    }
    db.addSource(name, url, category || 'General');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/sources/:id', (req, res) => {
  try {
    db.deleteSource(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sources/:id/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    db.toggleSource(req.params.id, enabled);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================== API SETĂRI & ADMIN ======================== //

app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    // Mascam parola pentru securitate
    if (settings.wp_app_password) {
      settings.has_wp_password = true;
      settings.wp_app_password = '••••••••••••';
    }
    if (settings.gemini_api_key) {
      settings.has_gemini_key = true;
      settings.gemini_api_key = settings.gemini_api_key.slice(0, 4) + '••••••••' + settings.gemini_api_key.slice(-4);
    }
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    for (const [key, val] of Object.entries(updates)) {
      // Daca valoarea nu este masca mascata, o salvam
      if (!String(val).includes('••••')) {
        db.setSetting(key, val);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/test-wp', async (req, res) => {
  try {
    let { wp_url, wp_username, wp_app_password } = req.body;
    if (wp_app_password && wp_app_password.includes('••••')) {
      wp_app_password = db.getSetting('wp_app_password');
    }
    const result = await wp.testConnection(wp_url, wp_username, wp_app_password);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Declanșează scanare imediată
let isFetching = false;
app.post('/api/fetch-now', async (req, res) => {
  if (isFetching) {
    return res.json({ success: false, message: 'O scanare este deja în curs de desfășurare...' });
  }
  isFetching = true;
  try {
    console.log('--- Scanare manuală inițiată de utilizator ---');
    const result = await rss.fetchAllFeeds({ maxPerFeed: 6, useAi: true });
    isFetching = false;
    res.json({ success: true, result });
  } catch (err) {
    isFetching = false;
    res.status(500).json({ success: false, error: err.message });
  }
});

// Statistici
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================== CRON JOB (PROGRAMARE AUTOMATĂ) ======================== //

// Ruleaza automat la fiecare 30 de minute
cron.schedule('*/30 * * * *', async () => {
  console.log('[CRON] Verificare periodică automată a știrilor...');
  try {
    await rss.fetchAllFeeds({ maxPerFeed: 4, useAi: true });
    console.log('[CRON] Scanare automată finalizată cu succes.');
  } catch (e) {
    console.error('[CRON] Eroare:', e.message);
  }
});

// ======================== PROTECȚIE CRASH / EXCEPȚII ======================== //

process.on('uncaughtException', (err) => {
  console.error('[GUARD] Eroare necaptată prevenită:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[GUARD] Promisiune respinsă prevenită:', reason);
});

// ======================== PORNIRE SERVER ======================== //

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Agregatorul de Știri AI rulează pe:`);
  console.log(`👉 Portal Știri:  http://localhost:${PORT}`);
  console.log(`👉 Panou Admin:   http://localhost:${PORT}/admin.html`);
  console.log(`====================================================`);
});
