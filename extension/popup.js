/** Popup settings: persist a custom dictionary + NER threshold to sync storage. */
const dictEl = document.getElementById('dict');
const confEl = document.getElementById('conf');
const savedEl = document.getElementById('saved');

function parseDictionary(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [term, type] = line.split(',').map((s) => s.trim());
      return { term, type: (type || 'MISC').toUpperCase() };
    })
    .filter((t) => t.term);
}

function serializeDictionary(dict) {
  return (dict || []).map((t) => `${t.term}, ${t.type}`).join('\n');
}

chrome.storage.sync.get(['dictionary', 'minConfidence'], (cfg) => {
  dictEl.value = serializeDictionary(cfg.dictionary);
  if (typeof cfg.minConfidence === 'number') confEl.value = String(cfg.minConfidence);
});

document.getElementById('save').addEventListener('click', () => {
  const dictionary = parseDictionary(dictEl.value);
  const minConfidence = Math.max(0, Math.min(1, Number(confEl.value) || 0.5));
  chrome.storage.sync.set({ dictionary, minConfidence }, () => {
    savedEl.textContent = `Saved ${dictionary.length} term(s). Reload the chat tab to apply.`;
    setTimeout(() => (savedEl.textContent = ''), 4000);
  });
});
