// Stare aplicatie
let currentCategory = 'Toate';
let searchQuery = '';
let currentOpenArticleId = null;

// Initializare
document.addEventListener('DOMContentLoaded', () => {
  displayDate();
  setupEventListeners();
  loadArticles();
});

function displayDate() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const today = new Date();
  document.getElementById('currentDate').textContent = today.toLocaleDateString('ro-RO', options);
}

function setupEventListeners() {
  // Filtrare categorii
  const catButtons = document.querySelectorAll('.cat-btn');
  catButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      catButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.cat;
      loadArticles();
    });
  });

  // Cautare cu debounce
  let searchTimeout;
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = e.target.value.trim();
      loadArticles();
    }, 300);
  });

  // Buton scanare rapida
  const quickFetchBtn = document.getElementById('quickFetchBtn');
  quickFetchBtn.addEventListener('click', triggerQuickFetch);

  // Modal events
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCloseBottomBtn').addEventListener('click', closeModal);
  document.getElementById('articleModal').addEventListener('click', (e) => {
    if (e.target.id === 'articleModal') closeModal();
  });

  // Sincronizare WordPress din modal
  document.getElementById('modalSyncWpBtn').addEventListener('click', () => {
    if (currentOpenArticleId) {
      syncToWordPress(currentOpenArticleId);
    }
  });
}

// Incarca articole din API
async function loadArticles() {
  const grid = document.getElementById('newsGrid');
  const emptyState = document.getElementById('emptyState');

  try {
    let url = `/api/articles?limit=40`;
    if (currentCategory && currentCategory !== 'Toate') {
      url += `&category=${encodeURIComponent(currentCategory)}`;
    }
    if (searchQuery) {
      url += `&search=${encodeURIComponent(searchQuery)}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (!data.success || !data.articles || data.articles.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = data.articles.map(article => renderArticleCard(article)).join('');

    // Adauga event listeners pe carduri
    document.querySelectorAll('.news-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        openModal(id);
      });
    });

  } catch (err) {
    console.error('Eroare incarcare articole:', err);
    showToast('Nu s-au putut încărca știrile.', 'error');
  }
}

// Render card
function renderArticleCard(art) {
  const timeAgo = formatTimeAgo(art.published_at || art.created_at);
  const title = escapeHtml(art.ai_title || art.original_title);
  const excerpt = escapeHtml(art.ai_summary || art.original_description || '').slice(0, 160) + '...';
  const category = escapeHtml(art.category || 'Piețe & Burse');
  const source = escapeHtml(art.source_name || 'Finanțe');
  
  // Numar de surse combinate
  let sourcesCount = 1;
  try {
    const parsedSources = JSON.parse(art.sources_json || '[]');
    if (Array.isArray(parsedSources) && parsedSources.length > 0) {
      sourcesCount = parsedSources.length;
    }
  } catch (e) {}

  const multiBadge = sourcesCount > 1 
    ? `<span style="background: #4f46e5; color: white; padding: 2px 7px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; margin-left: 6px;">✨ ${sourcesCount} Surse</span>` 
    : '';

  const tickerBadge = art.tickers 
    ? `<span style="background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">${escapeHtml(art.tickers)}</span>` 
    : '';

  const imgHtml = art.image_url 
    ? `<img src="${art.image_url}" alt="${title}" loading="lazy" onerror="this.style.display='none'">` 
    : `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:white; font-size:2.8rem; background: linear-gradient(135deg, #1e293b, #0f172a);">📈</div>`;

  const wpBadge = art.wp_post_id 
    ? `<span style="color:#059669; font-weight:600;" title="Publicat pe WordPress">✅ Pe WP</span>` 
    : '';

  return `
    <article class="news-card" data-id="${art.id}">
      <div class="card-img-wrapper">
        ${imgHtml}
        <span class="card-badge">${category}</span>
        <span class="ai-rewritten-badge">✨ AI Sinteză</span>
      </div>
      <div class="card-body">
        <div style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
          ${tickerBadge}
          ${multiBadge}
        </div>
        <h2 class="card-title">${title}</h2>
        <p class="card-excerpt">${excerpt}</p>
        <div class="card-footer">
          <span class="card-source" style="max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${source}</span>
          <div>
            ${wpBadge}
            <span>🕒 ${timeAgo}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

// Modal vizualizare
async function openModal(id) {
  currentOpenArticleId = id;
  const modal = document.getElementById('articleModal');

  try {
    const res = await fetch(`/api/articles/${id}`);
    const data = await res.json();
    if (!data.success || !data.article) return;

    const art = data.article;
    document.getElementById('modalTitle').textContent = art.ai_title || art.original_title;
    document.getElementById('modalCategory').textContent = art.category || 'Piețe & Burse';
    document.getElementById('modalSourceName').textContent = art.source_name || 'Finanțe';
    document.getElementById('modalDate').textContent = new Date(art.published_at || art.created_at).toLocaleString('ro-RO');

    const tickerEl = document.getElementById('modalTickers');
    if (art.tickers) {
      tickerEl.textContent = 'Tickers: ' + art.tickers;
      tickerEl.style.display = 'inline-block';
    } else {
      tickerEl.style.display = 'none';
    }

    const wpStatus = document.getElementById('modalWpStatus');
    if (art.wp_post_id) {
      wpStatus.innerHTML = `<span style="color: #059669; font-weight: bold;">✅ Publicat pe WordPress (#${art.wp_post_id})</span>`;
    } else {
      wpStatus.innerHTML = `<span style="color: #64748b;">⏳ Netrimis pe WordPress</span>`;
    }

    const imgContainer = document.getElementById('modalImageContainer');
    if (art.image_url) {
      imgContainer.innerHTML = `<img src="${art.image_url}" alt="${escapeHtml(art.ai_title)}" onerror="this.style.display='none'">`;
    } else {
      imgContainer.innerHTML = '';
    }

    // Rezumat Executiv
    const summaryBox = document.getElementById('modalExecutiveSummary');
    if (art.ai_summary) {
      summaryBox.innerHTML = `<strong>💡 Rezumat Executiv:</strong> ${escapeHtml(art.ai_summary)}`;
      summaryBox.style.display = 'block';
    } else {
      summaryBox.style.display = 'none';
    }

    // Paragrafe continut
    const paragraphs = (art.ai_content || art.original_description || '')
      .split(/\n+/)
      .map(p => `<p>${escapeHtml(p.trim())}</p>`)
      .join('');
    document.getElementById('modalContent').innerHTML = paragraphs;

    // Lista surse agregate
    const sourcesList = document.getElementById('modalSourcesList');
    let sources = [];
    try {
      sources = JSON.parse(art.sources_json || '[]');
    } catch (e) {}

    if (Array.isArray(sources) && sources.length > 0) {
      sourcesList.innerHTML = sources.map(s => `
        <li>
          <strong>${escapeHtml(s.name)}:</strong> 
          <a href="${s.link}" target="_blank" rel="noopener noreferrer" style="color: var(--primary);">${escapeHtml(s.title || 'Vezi articolul original')}</a>
        </li>
      `).join('');
    } else {
      sourcesList.innerHTML = `
        <li>
          <strong>${escapeHtml(art.source_name)}:</strong> 
          <a href="${art.original_link}" target="_blank" rel="noopener noreferrer" style="color: var(--primary);">Articolul original</a>
        </li>
      `;
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showToast('Nu s-a putut deschide articolul.', 'error');
  }
}

function closeModal() {
  const modal = document.getElementById('articleModal');
  modal.classList.remove('active');
  document.body.style.overflow = 'auto';
  currentOpenArticleId = null;
}

// Declanșează scanarea automată
async function triggerQuickFetch() {
  const btn = document.getElementById('quickFetchBtn');
  const loading = document.getElementById('loadingStatus');

  btn.disabled = true;
  btn.textContent = '⏳ Se procesează...';
  loading.style.display = 'block';

  try {
    showToast('Colectarea și sinteza pe piețele financiare au început...', 'info');
    const res = await fetch('/api/fetch-now', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      const multiInfo = data.result.multiSourceSyntheses > 0 
        ? ` (${data.result.multiSourceSyntheses} sinteze multi-sursă)` 
        : '';
      showToast(`Succes! Au fost adăugate ${data.result.totalNew} analize noi${multiInfo}.`);
      await loadArticles();
    } else {
      showToast(data.message || 'Scanarea nu a putut fi efectuată.', 'error');
    }
  } catch (err) {
    showToast('Eroare de conexiune la server.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Preia & Sintetizează Acum';
    loading.style.display = 'none';
  }
}

// Sincronizare cu WordPress
async function syncToWordPress(articleId) {
  const btn = document.getElementById('modalSyncWpBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Se trimite pe WP...';

  try {
    const res = await fetch(`/api/articles/${articleId}/publish-wp`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast('Articolul a fost publicat cu succes pe WordPress!');
      openModal(articleId);
      loadArticles();
    } else {
      showToast(data.error || 'Eroare la trimiterea pe WordPress.', 'error');
    }
  } catch (err) {
    showToast('Eroare rețea la comunicarea cu WordPress.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (isNaN(diffSec) || diffSec < 60) return 'chiar acum';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `acum ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `acum ${diffHours} ore`;
  const diffDays = Math.floor(diffHours / 24);
  return `acum ${diffDays} zile`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'error') toast.style.background = '#dc2626';
  if (type === 'info') toast.style.background = '#2563eb';
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}
