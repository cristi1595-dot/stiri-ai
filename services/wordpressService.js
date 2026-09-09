const db = require('./dbService');

/**
 * Trimite un articol din baza locala direct pe site-ul WordPress prin REST API
 */
async function publishToWordPress(articleId) {
  const article = db.getArticleById(articleId);
  if (!article) {
    throw new Error('Articolul nu a fost găsit în baza de date.');
  }

  const wpUrl = (db.getSetting('wp_url', '')).trim().replace(/\/$/, '');
  const wpUser = (db.getSetting('wp_username', '')).trim();
  const wpPass = (db.getSetting('wp_app_password', '')).trim().replace(/\s+/g, ''); // parolele de aplicatie au spatii

  if (!wpUrl || !wpUser || !wpPass) {
    throw new Error('Configurația WordPress este incompletă. Completează URL-ul, utilizatorul și parola de aplicație în Panoul Admin.');
  }

  // Pregatire credentiale Basic Auth
  const authHeader = 'Basic ' + Buffer.from(`${wpUser}:${wpPass}`).toString('base64');

  // Formatare continut HTML pentru WordPress
  let formattedHtml = '';
  if (article.image_url) {
    formattedHtml += `<p><img src="${article.image_url}" alt="${escapeHtml(article.ai_title)}" style="max-width: 100%; height: auto; border-radius: 8px; margin-bottom: 1.5rem;" /></p>\n`;
  }

  const paragraphs = article.ai_content
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p}</p>`)
    .join('\n');

  formattedHtml += paragraphs;
  formattedHtml += `\n<hr />\n<p style="font-size: 0.9em; color: #666;"><em>Sursă originală preluată de la: <a href="${article.original_link}" target="_blank" rel="nofollow noopener">${article.source_name}</a></em></p>`;

  const endpoint = `${wpUrl}/wp-json/wp/v2/posts`;

  const payload = {
    title: article.ai_title,
    content: formattedHtml,
    excerpt: article.ai_summary || '',
    status: 'publish' // sau 'draft'
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Eroare publicare WordPress:', response.status, errorText);
    throw new Error(`WordPress API Error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const result = await response.json();
  const wpPostId = result.id;

  // Marcam ca sincronizat
  db.markWpSynced(articleId, wpPostId);

  return {
    success: true,
    wpPostId,
    link: result.link
  };
}

/**
 * Testeaza daca conexiunea la WordPress functioneaza
 */
async function testConnection(wpUrl, wpUser, wpPass) {
  const cleanUrl = wpUrl.trim().replace(/\/$/, '');
  const cleanUser = wpUser.trim();
  const cleanPass = wpPass.trim().replace(/\s+/g, '');

  const authHeader = 'Basic ' + Buffer.from(`${cleanUser}:${cleanPass}`).toString('base64');
  const endpoint = `${cleanUrl}/wp-json/wp/v2/users/me`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': authHeader
    }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Conexiunea a eșuat (${response.status}). Verifică datele de autentificare.`);
  }

  const user = await response.json();
  return {
    success: true,
    username: user.name || cleanUser,
    site: cleanUrl
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  publishToWordPress,
  testConnection
};
