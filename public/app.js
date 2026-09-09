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
    let url = `/api/articles?limit=30`;
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
  const category = escapeHtml(art.category || 'Actualitate');
  const source = escapeHtml(art.source_name || 'RSS');
  
  const imgHtml = art.image_url 
    ? `<img src="${art.image_url}" alt="${title}" loading="lazy" onerror="this.style.display='none'">` 
    : `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:white; font-size:2.5rem; opacity:0.8;">📰</div>`;

  const wpBadge = art.wp_post_id 
    ? `<span style="color:#059669; font-weight:600;" title="Sincronizat pe WordPress">✅ Pe WP</span>` 
    : '';

  return `
    <article class="news-card" data-id="${art.id}">
      <div class="card-img-wrapper">
        ${imgHtml}
        <span class="card-badge">${category}</span>
        <span class="ai-rewritten-badge">✨ AI</span>
      </div>
      <div class="card-body">
        <h2 class="card-title">${title}</h2>
        <p class="card-excerpt">${excerpt}</p>
        <div class="card-footer">
          <span class="card-source">${source}</span>
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
    document.getElementById('modalCategory').textContent = art.category || 'Actualitate';
    document.getElementById('modalSourceName').textContent = art.source_name || 'RSS';
    document.getElementById('modalDate').textContent = new Date(art.published_at || art.created_at).toLocaleString('ro-RO');

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

    // Paragrafe continut
    const paragraphs = (art.ai_content || art.original_description || '')
      .split(/\n+/)
      .map(p => `<p>${escapeHtml(p.trim())}</p>`)
      .join('');
    document.getElementById('modalContent').innerHTML = paragraphs;

    // Link sursa
    const origLink = document.getElementById('modalOriginalLink');
    origLink.href = art.original_link;
    origLink.textContent = art.source_name + ' (vezi articolul)';

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
    showToast('Colectarea și rescrierea AI au început...', 'info');
    const res = await fetch('/api/fetch-now', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(`Succes! Au fost adăugate ${data.result.totalNew} știri noi.`);
      await loadArticles();
    } else {
      showToast(data.message || 'Scanarea nu a putut fi efectuată.', 'error');
    }
  } catch (err) {
    showToast('Eroare de conexiune la server.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Preia Știri Noi';
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
      openModal(articleId); // Reincarca detaliile in modal
      loadArticles(); // Reincarca lista
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

// Formatare data relativa
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

// Toast notificari
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
