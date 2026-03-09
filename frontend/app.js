const imageInput = document.getElementById('image');
const generateBtn = document.getElementById('generate');
const keywordsEl = document.getElementById('keywords');
const promptEl = document.getElementById('prompt');
const negativeEl = document.getElementById('negative');
const copyKeywordsBtn = document.getElementById('copyKeywords');
const copyPromptBtn = document.getElementById('copyPrompt');
const copyNegativeBtn = document.getElementById('copyNegative');
const previewEl = document.getElementById('preview');
const errorEl = document.getElementById('error');
const loadingEl = document.getElementById('loading');
const loadingStatusEl = document.getElementById('loadingStatus');

loadingEl.hidden = true;
loadingStatusEl.textContent = 'Uploading image';

function setError(msg) {
  if (!msg) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }

  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function setResults({ keywords, prompt, negative, raw }) {
  keywordsEl.textContent = keywords || '';
  promptEl.textContent = prompt || '';
  negativeEl.textContent = negative || '';

  copyKeywordsBtn.disabled = !keywordsEl.textContent;
  copyPromptBtn.disabled = !promptEl.textContent;
  copyNegativeBtn.disabled = !negativeEl.textContent;

  if (!keywordsEl.textContent && !promptEl.textContent && !negativeEl.textContent && raw) {
    keywordsEl.textContent = raw;
    copyKeywordsBtn.disabled = false;
  }
}

async function setImageFile(file) {
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  imageInput.files = dt.files;
  imageInput.dispatchEvent(new Event('change', { bubbles: true }));
}

document.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items || items.length === 0) return;

  for (const item of items) {
    if (item.kind !== 'file') continue;
    const type = item.type || '';
    if (!type.startsWith('image/')) continue;

    const blob = item.getAsFile();
    if (!blob) continue;

    const ext = (type.split('/')[1] || 'png').toLowerCase();
    const file = new File([blob], `pasted.${ext}`, { type });
    await setImageFile(file);
    setError('');
    return;
  }
});

async function copyTextFrom(el, btn) {
  const text = el.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = prev), 900);
  } catch {
    setError('Copy failed.');
  }
}

imageInput.addEventListener('change', () => {
  setError('');
  setResults({ keywords: '', prompt: '', negative: '', raw: '' });

  const file = imageInput.files?.[0];
  generateBtn.disabled = !file;

  loadingEl.hidden = true;
  loadingStatusEl.textContent = 'Uploading image';

  if (file) {
    const url = URL.createObjectURL(file);
    previewEl.src = url;
    previewEl.style.display = 'block';
  } else {
    previewEl.removeAttribute('src');
    previewEl.style.display = 'none';
  }
});

generateBtn.addEventListener('click', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  setError('');
  setResults({ keywords: '', prompt: '', negative: '', raw: '' });
  generateBtn.disabled = true;
  loadingEl.hidden = false;
  loadingStatusEl.textContent = 'Uploading image';

  try {
    const form = new FormData();
    form.append('image', file);

    loadingStatusEl.textContent = 'Waiting for model response';

    const res = await fetch('/api/generate', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      let detail = '';
      try {
        const data = JSON.parse(text);
        detail = typeof data?.detail === 'string' ? data.detail : '';
      } catch {
        // ignore
      }
      throw new Error(detail || text || `Request failed: ${res.status}`);
    }

    const data = await res.json();

    const keywords = Array.isArray(data.keywords) ? data.keywords.join(', ') : '';
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const negative = typeof data.negative_prompt === 'string' ? data.negative_prompt : '';
    const raw = typeof data.raw === 'string' ? data.raw : '';

    setResults({ keywords, prompt, negative, raw });
  } catch (e) {
    setResults({ keywords: '', prompt: '', negative: '', raw: '' });
    setError(e?.message ?? String(e));
  } finally {
    generateBtn.disabled = false;
    loadingEl.hidden = true;
  }
});

copyKeywordsBtn.addEventListener('click', () => copyTextFrom(keywordsEl, copyKeywordsBtn));
copyPromptBtn.addEventListener('click', () => copyTextFrom(promptEl, copyPromptBtn));
copyNegativeBtn.addEventListener('click', () => copyTextFrom(negativeEl, copyNegativeBtn));
