const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'news.db');
const db = new DatabaseSync(dbPath);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'General',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT,
      source_url TEXT,
      original_title TEXT NOT NULL,
      original_link TEXT UNIQUE,
      original_description TEXT,
      ai_title TEXT,
      ai_content TEXT,
      ai_summary TEXT,
      category TEXT DEFAULT 'Actualitate',
      image_url TEXT,
      published_at DATETIME,
      status TEXT DEFAULT 'published', -- 'published', 'draft', 'pending'
      wp_post_id INTEGER,
      wp_synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Adauga surse default daca tabela e goala
  const countSources = db.prepare('SELECT count(*) as count FROM sources').get();
  if (countSources.count === 0) {
    const insertSource = db.prepare('INSERT INTO sources (name, url, category) VALUES (?, ?, ?)');
    insertSource.run('Digi24', 'https://www.digi24.ro/rss', 'Actualitate');
    insertSource.run('HotNews.ro', 'https://hotnews.ro/feed', 'Politică & Economie');
    insertSource.run('Știrile ProTV', 'https://stirileprotv.ro/rss', 'Eveniment');
  }

  // Setari default
  const defaultSettings = [
    ['gemini_api_key', ''],
    ['ai_model', 'gemini-1.5-flash'],
    ['auto_fetch_interval_min', '30'],
    ['auto_publish', '1'],
    ['wp_url', ''],
    ['wp_username', ''],
    ['wp_app_password', ''],
    ['auto_sync_wp', '0']
  ];

  const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  
  for (const [key, val] of defaultSettings) {
    insertSetting.run(key, val);
  }
}

// Articole
function insertArticle(art) {
  try {
    const stmt = db.prepare(`
      INSERT INTO articles (
        source_name, source_url, original_title, original_link, 
        original_description, ai_title, ai_content, ai_summary, 
        category, image_url, published_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const res = stmt.run(
      art.source_name,
      art.source_url || '',
      art.original_title,
      art.original_link,
      art.original_description || '',
      art.ai_title || art.original_title,
      art.ai_content || art.original_description || '',
      art.ai_summary || '',
      art.category || 'Actualitate',
      art.image_url || null,
      art.published_at || new Date().toISOString(),
      art.status || 'published'
    );
    return res.lastInsertRowid;
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return null; // Articolul exista deja
    }
    console.error('Eroare la inserare articol:', err.message);
    return null;
  }
}

function getArticles({ category, search, status, limit = 20, offset = 0 } = {}) {
  let query = 'SELECT * FROM articles WHERE 1=1';
  const params = [];

  if (category && category !== 'Toate') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (search) {
    query += ' AND (ai_title LIKE ? OR ai_content LIKE ? OR original_title LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  return db.prepare(query).all(...params);
}

function getArticleById(id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

function updateArticleAI(id, { ai_title, ai_content, ai_summary, category }) {
  const stmt = db.prepare(`
    UPDATE articles 
    SET ai_title = ?, ai_content = ?, ai_summary = ?, category = ?
    WHERE id = ?
  `);
  stmt.run(ai_title, ai_content, ai_summary, category, id);
}

function markWpSynced(id, wp_post_id) {
  db.prepare('UPDATE articles SET wp_post_id = ?, wp_synced_at = CURRENT_TIMESTAMP WHERE id = ?').run(wp_post_id, id);
}

// Surse
function getSources() {
  return db.prepare('SELECT * FROM sources ORDER BY id ASC').all();
}

function getEnabledSources() {
  return db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
}

function addSource(name, url, category = 'General') {
  const stmt = db.prepare('INSERT INTO sources (name, url, category) VALUES (?, ?, ?)');
  return stmt.run(name, url, category);
}

function deleteSource(id) {
  return db.prepare('DELETE FROM sources WHERE id = ?').run(id);
}

function toggleSource(id, enabled) {
  return db.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

// Setari
function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  stmt.run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const res = {};
  for (const r of rows) {
    res[r.key] = r.value;
  }
  return res;
}

function getStats() {
  const totalArticles = db.prepare('SELECT count(*) as count FROM articles').get().count;
  const wpSynced = db.prepare('SELECT count(*) as count FROM articles WHERE wp_post_id IS NOT NULL').get().count;
  const totalSources = db.prepare('SELECT count(*) as count FROM sources WHERE enabled = 1').get().count;
  return { totalArticles, wpSynced, totalSources };
}

module.exports = {
  initDb,
  insertArticle,
  getArticles,
  getArticleById,
  updateArticleAI,
  markWpSynced,
  getSources,
  getEnabledSources,
  addSource,
  deleteSource,
  toggleSource,
  getSetting,
  setSetting,
  getAllSettings,
  getStats
};
