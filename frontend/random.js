const countEl = document.getElementById('count');
const generateBtn = document.getElementById('generate');
const copyBtn = document.getElementById('copy');
const copyPromptBtn = document.getElementById('copyPrompt');
const copyKeywordsBtn = document.getElementById('copyKeywords');
const promptEl = document.getElementById('prompt');
const keywordsEl = document.getElementById('keywords');
const uniqueEl = document.getElementById('unique');
const totalEl = document.getElementById('total');
const errorEl = document.getElementById('error');
const searchEl = document.getElementById('search');
const requiredListEl = document.getElementById('requiredList');
const clearRequiredBtn = document.getElementById('clearRequired');
const categoryEl = document.getElementById('category');

let allKeywords = [];
const requiredSet = new Set();
let categories = ['all'];

function setError(msg) {
  if (!msg) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }

  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function setRequiredButtons() {
  clearRequiredBtn.disabled = requiredSet.size === 0;
}

async function deleteKeyword(keyword) {
  const kw = (keyword || '').trim();
  if (!kw) return;

  const ok = window.confirm(`Delete keyword "${kw}"?`);
  if (!ok) return;

  try {
    const res = await fetch('/api/delete_keyword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }

    allKeywords = allKeywords.filter((x) => x.keyword !== kw);
    requiredSet.delete(kw);
    setRequiredButtons();
    renderKeywordList();
    loadStats();
  } catch (e) {
    setError(e?.message ?? String(e));
  }
}

function renderKeywordList() {
  const q = (searchEl.value || '').trim().toLowerCase();
  const cat = categoryEl?.value || 'all';
  requiredListEl.innerHTML = '';

  let filtered = allKeywords;
  if (cat !== 'all') {
    filtered = filtered.filter((k) => (k.category || 'other') === cat);
  }
  if (q) {
    filtered = filtered.filter((k) => k.keyword.includes(q));
  }

  for (const item of filtered) {
    const row = document.createElement('label');
    row.className = 'kwItem';

    const left = document.createElement('div');
    left.className = 'kwLeft';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = requiredSet.has(item.keyword);
    cb.addEventListener('change', () => {
      if (cb.checked) requiredSet.add(item.keyword);
      else requiredSet.delete(item.keyword);
      setRequiredButtons();
    });

    const name = document.createElement('div');
    name.className = 'kwName';
    name.textContent = item.keyword;

    left.appendChild(cb);
    left.appendChild(name);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const catSel = document.createElement('select');
    catSel.className = 'mini';
    catSel.style.width = '140px';

    const curCat = item.category || 'other';
    for (const c of categories.filter((x) => x !== 'all')) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (c === curCat) opt.selected = true;
      catSel.appendChild(opt);
    }

    catSel.addEventListener('change', async () => {
      try {
        const res = await fetch('/api/keyword_category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: item.keyword, category: catSel.value }),
        });
        if (!res.ok) return;
        item.category = catSel.value;
        if ((categoryEl?.value || 'all') !== 'all') {
          renderKeywordList();
        }
      } catch {
        // ignore
      }
    });

    const count = document.createElement('div');
    count.className = 'kwCount';
    count.textContent = String(item.count ?? 0);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mini';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      deleteKeyword(item.keyword);
    });

    right.appendChild(catSel);
    right.appendChild(count);
    right.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(right);

    requiredListEl.appendChild(row);
  }
}

async function loadKeywords() {
  try {
    const res = await fetch('/api/keywords?limit=2000');
    if (!res.ok) return;
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    allKeywords = items
      .filter((x) => typeof x.keyword === 'string')
      .map((x) => ({
        keyword: x.keyword,
        count: x.count ?? 0,
        category: typeof x.category === 'string' ? x.category : null,
      }));
    renderKeywordList();
  } catch {
    // ignore
  }
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) return;
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    categories = ['all', ...items.filter((x) => typeof x === 'string')];

    categoryEl.innerHTML = '';
    for (const c of categories) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      categoryEl.appendChild(opt);
    }
    categoryEl.value = 'all';
  } catch {
    // ignore
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
    uniqueEl.textContent = data.unique_keywords ?? '-';
    totalEl.textContent = data.total_records ?? '-';
  } catch {
    // ignore
  }
}

async function generate() {
  setError('');
  promptEl.textContent = '';
  keywordsEl.textContent = '';
  copyBtn.disabled = true;
  copyPromptBtn.disabled = true;
  copyKeywordsBtn.disabled = true;

  const n = Math.max(1, Math.min(80, Number(countEl.value || 20)));

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';

  try {
    const required = Array.from(requiredSet);
    const res = await fetch('/api/build_prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n, coherent: true, required }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }

    const data = await res.json();
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const kws = Array.isArray(data.keywords) ? data.keywords : [];

    promptEl.textContent = prompt;
    keywordsEl.textContent = kws.join(', ');
    copyBtn.disabled = !promptEl.textContent;
    copyPromptBtn.disabled = !promptEl.textContent;
    copyKeywordsBtn.disabled = !keywordsEl.textContent;
  } catch (e) {
    setError(e?.message ?? String(e));
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate random prompt';
  }
}

copyBtn.addEventListener('click', async () => {
  const text = promptEl.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Copied';
    setTimeout(() => (copyBtn.textContent = prev), 900);
  } catch {
    setError('Copy failed.');
  }
});

copyPromptBtn.addEventListener('click', async () => {
  const text = promptEl.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = copyPromptBtn.textContent;
    copyPromptBtn.textContent = 'Copied';
    setTimeout(() => (copyPromptBtn.textContent = prev), 900);
  } catch {
    setError('Copy failed.');
  }
});

copyKeywordsBtn.addEventListener('click', async () => {
  const text = keywordsEl.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = copyKeywordsBtn.textContent;
    copyKeywordsBtn.textContent = 'Copied';
    setTimeout(() => (copyKeywordsBtn.textContent = prev), 900);
  } catch {
    setError('Copy failed.');
  }
});

generateBtn.addEventListener('click', generate);

searchEl.addEventListener('input', renderKeywordList);
categoryEl.addEventListener('change', renderKeywordList);

clearRequiredBtn.addEventListener('click', () => {
  requiredSet.clear();
  setRequiredButtons();
  renderKeywordList();
});

loadStats();
loadCategories();
loadKeywords();
setRequiredButtons();
