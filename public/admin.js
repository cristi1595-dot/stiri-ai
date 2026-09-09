document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadSettings();
  loadSources();
  setupEventListeners();
});

function setupEventListeners() {
  // Salvare AI
  document.getElementById('aiSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiKey = document.getElementById('geminiApiKey').value.trim();
    const aiModel = document.getElementById('aiModel').value;

    const payload = { ai_model: aiModel };
    if (apiKey) payload.gemini_api_key = apiKey;

    await saveSettings(payload);
    showToast('Setările AI au fost salvate cu succes!');
  });

  // Salvare WordPress
  document.getElementById('wpSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wpUrl = document.getElementById('wpUrl').value.trim();
    const wpUser = document.getElementById('wpUser').value.trim();
    const wpPass = document.getElementById('wpPass').value.trim();
    const autoSyncWp = document.getElementById('autoSyncWp').checked ? '1' : '0';

    const payload = {
      wp_url: wpUrl,
      wp_username: wpUser,
      auto_sync_wp: autoSyncWp
    };
    if (wpPass) payload.wp_app_password = wpPass;

    await saveSettings(payload);
    showToast('Setările WordPress au fost salvate cu succes!');
  });

  // Testare conexiune WordPress
  document.getElementById('testWpBtn').addEventListener('click', async () => {
    const btn = document.getElementById('testWpBtn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Se testează...';

    const wpUrl = document.getElementById('wpUrl').value.trim();
    const wpUser = document.getElementById('wpUser').value.trim();
    const wpPass = document.getElementById('wpPass').value.trim();

    try {
      const res = await fetch('/api/test-wp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wp_url: wpUrl, wp_username: wpUser, wp_app_password: wpPass })
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Conexiune reușită cu WordPress! Autentificat ca: ${data.result.username}`);
      } else {
        showToast(data.error || 'Testul a eșuat.', 'error');
      }
    } catch (err) {
      showToast('Nu s-a putut contacta serverul.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // Adaugare sursa noua
  document.getElementById('addSourceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newSourceName').value.trim();
    const url = document.getElementById('newSourceUrl').value.trim();
    const category = document.getElementById('newSourceCategory').value;

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, category })
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Sursa "${name}" a fost adăugată!`);
        document.getElementById('addSourceForm').reset();
        loadSources();
        loadStats();
      } else {
        showToast(data.error || 'Eroare la adăugarea sursei.', 'error');
      }
    } catch (err) {
      showToast('Eroare la server.', 'error');
    }
  });

  // Scanare manuala din admin
  document.getElementById('adminFetchBtn').addEventListener('click', triggerAdminFetch);
}

// Incarcare statistici
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      document.getElementById('statTotalArticles').textContent = data.stats.totalArticles;
      document.getElementById('statTotalSources').textContent = data.stats.totalSources;
      document.getElementById('statWpSynced').textContent = data.stats.wpSynced;
    }
  } catch (err) {
    console.error('Eroare statistici:', err);
  }
}

// Incarcare setari
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      if (s.gemini_api_key) document.getElementById('geminiApiKey').value = s.gemini_api_key;
      if (s.ai_model) document.getElementById('aiModel').value = s.ai_model;
      if (s.wp_url) document.getElementById('wpUrl').value = s.wp_url;
      if (s.wp_username) document.getElementById('wpUser').value = s.wp_username;
      if (s.wp_app_password) document.getElementById('wpPass').value = s.wp_app_password;
      document.getElementById('autoSyncWp').checked = s.auto_sync_wp === '1';
    }
  } catch (err) {
    console.error('Eroare setari:', err);
  }
}

// Salvare setari generale
async function saveSettings(payload) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    showToast('Eroare la salvarea setărilor.', 'error');
  }
}

// Incarcare surse RSS
async function loadSources() {
  const tbody = document.getElementById('sourcesTableBody');
  try {
    const res = await fetch('/api/sources');
    const data = await res.json();
    if (!data.success || !data.sources) return;

    tbody.innerHTML = data.sources.map(src => {
      const isEnabled = src.enabled === 1;
      return `
        <tr>
          <td>#${src.id}</td>
          <td><strong>${escapeHtml(src.name)}</strong></td>
          <td><a href="${src.url}" target="_blank" style="color: var(--primary); font-size: 0.85rem;">${escapeHtml(src.url)}</a></td>
          <td><span class="card-badge" style="position:static; display:inline-block;">${escapeHtml(src.category)}</span></td>
          <td>
            <label style="cursor: pointer; font-size: 0.85rem; font-weight: 600; color: ${isEnabled ? '#059669' : '#dc2626'}">
              <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleSource(${src.id}, this.checked)">
              ${isEnabled ? 'Activ' : 'Inactiv'}
            </label>
          </td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="deleteSource(${src.id}, '${escapeHtml(src.name)}')">🗑️ Șterge</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Eroare surse:', err);
  }
}

// Toggle sursa
async function toggleSource(id, enabled) {
  try {
    await fetch(`/api/sources/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    showToast(`Status sursă actualizat.`);
    loadStats();
    loadSources();
  } catch (err) {
    showToast('Nu s-a putut schimba statusul.', 'error');
  }
}

// Sterge sursa
async function deleteSource(id, name) {
  if (!confirm(`Ești sigur că vrei să ștergi sursa "${name}"?`)) return;

  try {
    const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Sursa "${name}" a fost ștearsă.`);
      loadSources();
      loadStats();
    }
  } catch (err) {
    showToast('Nu s-a putut șterge sursa.', 'error');
  }
}

// Scanare din admin
async function triggerAdminFetch() {
  const btn = document.getElementById('adminFetchBtn');
  const box = document.getElementById('scanStatusBox');

  btn.disabled = true;
  btn.textContent = '⏳ Se procesează...';
  box.style.display = 'block';

  try {
    const res = await fetch('/api/fetch-now', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(`Scanare completă! Au fost adăugate ${data.result.totalNew} știri noi.`);
      loadStats();
    } else {
      showToast(data.message || 'Scanarea nu a putut rula.', 'error');
    }
  } catch (err) {
    showToast('Eroare de comunicare cu serverul.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Declanșează Scanare Acum';
    box.style.display = 'none';
  }
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
