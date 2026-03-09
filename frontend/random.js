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
const addKeywordEl = document.getElementById('addKeyword');
const addCategoryEl = document.getElementById('addCategory');
const addSubcategoryEl = document.getElementById('addSubcategory');
const addKeywordBtnEl = document.getElementById('addKeywordBtn');

let allKeywords = [];
const requiredSet = new Set();
let categories = ['all'];

const TREE_STATE_KEY = 'kwTreeStateV1';

function loadTreeState() {
  try {
    const raw = localStorage.getItem(TREE_STATE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveTreeState(state) {
  try {
    localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state || {}));
  } catch {
    // ignore
  }
}

function getSubcategoriesForCategory(cat) {
  const c = (cat || 'other').toLowerCase();
  const set = new Set();
  for (const k of allKeywords) {
    const kc = (k.category || 'other').toLowerCase();
    if (kc !== c) continue;
    const sub = (k.subcategory || '').trim();
    if (sub) set.add(sub);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function fillSubcategorySelect(selectEl, cat, current) {
  if (!selectEl) return;
  const subs = getSubcategoriesForCategory(cat);
  const cur = (current || '').trim();

  selectEl.innerHTML = '';

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '(no subcategory)';
  selectEl.appendChild(emptyOpt);

  for (const s of subs) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === cur) opt.selected = true;
    selectEl.appendChild(opt);
  }

  if (cur && !subs.includes(cur)) {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur;
    opt.selected = true;
    selectEl.appendChild(opt);
  }

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New…';
  selectEl.appendChild(newOpt);

  selectEl.value = cur;
}

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

async function addKeyword() {
  const kw = (addKeywordEl?.value || '').trim();
  if (!kw) return;

  const cat = addCategoryEl?.value || 'other';
  let sub = addSubcategoryEl?.value || '';
  if (sub === '__new__') {
    const s = window.prompt('New subcategory name:');
    sub = (s || '').trim();
    if (!sub) sub = '';
  }

  try {
    const res = await fetch('/api/add_keyword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw, category: cat, subcategory: sub || null }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }

    addKeywordEl.value = '';
    if (addSubcategoryEl) addSubcategoryEl.value = '';
    await loadKeywords();
    await loadStats();
  } catch (e) {
    setError(e?.message ?? String(e));
  }
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

  const treeState = loadTreeState();

  let filtered = allKeywords;
  if (cat !== 'all') {
    filtered = filtered.filter((k) => (k.category || 'other') === cat);
  }
  if (q) {
    filtered = filtered.filter((k) => k.keyword.includes(q));
  }

  const groups = new Map();
  for (const item of filtered) {
    const g = item.category || 'other';
    const sg = item.subcategory || '';
    if (!groups.has(g)) groups.set(g, new Map());
    const subMap = groups.get(g);
    if (!subMap.has(sg)) subMap.set(sg, []);
    subMap.get(sg).push(item);
  }

  const groupNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  for (const groupName of groupNames) {
    const subMap = groups.get(groupName);
    const allItems = Array.from(subMap.values()).flat();

    const details = document.createElement('details');
    details.className = 'kwGroup';
    const groupKey = `c:${groupName}`;
    details.open = treeState[groupKey] !== false;
    details.addEventListener('toggle', () => {
      const next = loadTreeState();
      next[groupKey] = details.open;
      saveTreeState(next);
    });

    const summary = document.createElement('summary');
    summary.className = 'kwGroupSummary';
    summary.textContent = `${groupName} (${allItems.length})`;
    details.appendChild(summary);

    const groupList = document.createElement('div');
    groupList.className = 'kwGroupList';

    const subNames = Array.from(subMap.keys()).sort((a, b) => a.localeCompare(b));
    for (const subName of subNames) {
      const items = subMap.get(subName) || [];
      items.sort((a, b) => a.keyword.localeCompare(b.keyword));

      const subDetails = document.createElement('details');
      subDetails.className = 'kwSubGroup';
      const subKey = `s:${groupName}::${subName || ''}`;
      subDetails.open = treeState[subKey] !== false;
      subDetails.addEventListener('toggle', () => {
        const next = loadTreeState();
        next[subKey] = subDetails.open;
        saveTreeState(next);
      });

      const subSummary = document.createElement('summary');
      subSummary.className = 'kwSubGroupSummary';
      const label = subName ? subName : '(no subcategory)';
      subSummary.textContent = `${label} (${items.length})`;
      subDetails.appendChild(subSummary);

      const list = document.createElement('div');
      list.className = 'kwSubGroupList';

      for (const item of items) {
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

        const subSel = document.createElement('select');
        subSel.className = 'mini';
        subSel.style.width = '160px';
        fillSubcategorySelect(subSel, item.category || 'other', item.subcategory || '');

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
              body: JSON.stringify({
                keyword: item.keyword,
                category: catSel.value,
                subcategory: item.subcategory || null,
              }),
            });
            if (!res.ok) return;
            item.category = catSel.value;
            fillSubcategorySelect(subSel, item.category || 'other', item.subcategory || '');
            renderKeywordList();
          } catch {
            // ignore
          }
        });

        subSel.addEventListener('change', async () => {
          let val = subSel.value || '';
          if (val === '__new__') {
            const s = window.prompt('New subcategory name:');
            val = (s || '').trim();
            if (!val) {
              fillSubcategorySelect(subSel, item.category || 'other', item.subcategory || '');
              return;
            }
          }
          try {
            const res = await fetch('/api/keyword_category', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                keyword: item.keyword,
                category: item.category || 'other',
                subcategory: val || null,
              }),
            });
            if (!res.ok) return;
            item.subcategory = val || null;
            renderKeywordList();
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
        right.appendChild(subSel);
        right.appendChild(count);
        right.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(right);

        list.appendChild(row);
      }

      subDetails.appendChild(list);
      groupList.appendChild(subDetails);
    }

    details.appendChild(groupList);
    requiredListEl.appendChild(details);
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
        subcategory: typeof x.subcategory === 'string' ? x.subcategory : null,
      }));
    renderKeywordList();

    if (addSubcategoryEl) {
      fillSubcategorySelect(addSubcategoryEl, addCategoryEl?.value || 'other', addSubcategoryEl.value || '');
    }
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

    if (addCategoryEl) {
      addCategoryEl.innerHTML = '';
      for (const c of categories.filter((x) => x !== 'all')) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        addCategoryEl.appendChild(opt);
      }
      addCategoryEl.value = 'other';
    }

    if (addSubcategoryEl) {
      fillSubcategorySelect(addSubcategoryEl, addCategoryEl?.value || 'other', '');
    }
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
      body: JSON.stringify({ n, coherent: false, required }),
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

addKeywordBtnEl?.addEventListener('click', (e) => {
  e.preventDefault();
  addKeyword();
});

addKeywordEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addKeyword();
});

addCategoryEl?.addEventListener('change', () => {
  fillSubcategorySelect(addSubcategoryEl, addCategoryEl?.value || 'other', '');
});

loadStats();
loadCategories();
loadKeywords();
setRequiredButtons();
