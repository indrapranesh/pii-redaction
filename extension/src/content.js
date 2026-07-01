/**
 * Content script for the PII Redaction Guard extension.
 *
 * Intercepts the "send" action on supported chat UIs, redacts the draft in the
 * browser, shows a review-before-send panel, sends only the redacted text, and
 * rehydrates the assistant's response locally. The vault (placeholder -> real
 * value) lives only in this content-script scope and is never transmitted.
 *
 * Bundled to a classic IIFE (`extension/content.js`) so it runs under strict
 * page CSPs without dynamic imports.
 */
import { redact, rehydrate } from '../../src/index.js';

/* ------------------------------------------------------------------ config */

// Each site describes how to find the composer, the send button, and the
// message stream. The `[data-pii-*]` hooks let the same script run on the
// bundled mock page used for testing.
const SITES = [
  {
    match: /chatgpt\.com|chat\.openai\.com/,
    composer: '#prompt-textarea, textarea[data-id], [contenteditable="true"]',
    send: 'button[data-testid="send-button"], button[aria-label*="Send" i]',
    stream: 'main',
    message: '[data-message-author-role="assistant"]',
  },
  {
    match: /claude\.ai/,
    composer: 'div[contenteditable="true"], textarea',
    send: 'button[aria-label*="Send" i]',
    stream: 'main',
    message: '[data-testid*="assistant" i], .font-claude-message',
  },
  {
    // Test / generic hook.
    match: /.*/,
    composer: '[data-pii-composer]',
    send: '[data-pii-send]',
    stream: '[data-pii-stream]',
    message: '[data-pii-message]',
  },
];

const DEFAULT_POLICY = {
  minConfidence: 0.5,
  dictionary: [],
};

/* ------------------------------------------------------------------- state */

const state = {
  site: SITES.find((s) => s.match.test(location.hostname)) ?? SITES[SITES.length - 1],
  vault: new Map(), // placeholder -> real value, for this tab session
  policy: { ...DEFAULT_POLICY },
  bypass: false, // true while we programmatically re-trigger a send
  panelOpen: false,
};

/* --------------------------------------------------------------- utilities */

function getComposer() {
  return document.querySelector(state.site.composer);
}

function readDraft(el) {
  if (!el) return '';
  return 'value' in el && el.tagName === 'TEXTAREA' ? el.value : el.innerText;
}

function writeDraft(el, text) {
  if (!el) return;
  if (el.tagName === 'TEXTAREA') {
    el.value = text;
  } else {
    el.textContent = text;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** Merge a per-send vault into the tab vault (values shared across turns). */
function mergeVault(v) {
  for (const [k, val] of v) state.vault.set(k, val);
}

/* ---------------------------------------------------------- review panel UI */

function closePanel() {
  document.getElementById('pii-guard-panel')?.remove();
  state.panelOpen = false;
}

/**
 * Show the review panel. `onConfirm(excludedValues)` runs when the user chooses
 * to send; excludedValues is the set of original values to leave un-redacted.
 */
function openPanel(result, onConfirm) {
  closePanel();
  state.panelOpen = true;

  const excluded = new Set();
  const overlay = document.createElement('div');
  overlay.id = 'pii-guard-panel';
  overlay.innerHTML = `
    <div class="pg-card" role="dialog" aria-label="Review PII before sending">
      <div class="pg-head">
        <span class="pg-title">Review before sending</span>
        <span class="pg-count">${result.entities.length} item(s) detected</span>
      </div>
      <p class="pg-sub">Only the redacted text is sent. Untick an item to send it as-is.</p>
      <div class="pg-list"></div>
      <div class="pg-preview"><div class="pg-label">Redacted preview</div><pre></pre></div>
      <div class="pg-actions">
        <button class="pg-cancel">Cancel</button>
        <button class="pg-send">Send redacted</button>
      </div>
    </div>`;

  const list = overlay.querySelector('.pg-list');
  const previewEl = overlay.querySelector('.pg-preview pre');

  const byValue = new Map();
  for (const e of result.entities) {
    if (!byValue.has(e.text)) byValue.set(e.text, e);
  }

  function renderPreview() {
    // Start from full redaction, restore excluded values from the vault.
    const partial = new Map(
      [...result.vault].filter(([, v]) => excluded.has(v)),
    );
    previewEl.textContent = rehydrate(result.redactedText, partial);
  }

  for (const [value, e] of byValue) {
    const row = document.createElement('label');
    row.className = 'pg-row';
    row.innerHTML = `
      <input type="checkbox" checked />
      <span class="pg-tag">${e.type}</span>
      <span class="pg-val"></span>
      <span class="pg-src pg-src-${e.source}">${e.source}</span>`;
    row.querySelector('.pg-val').textContent = value;
    const cb = row.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) excluded.delete(value);
      else excluded.add(value);
      renderPreview();
    });
    list.appendChild(row);
  }
  renderPreview();

  overlay.querySelector('.pg-cancel').addEventListener('click', closePanel);
  overlay.querySelector('.pg-send').addEventListener('click', () => {
    closePanel();
    onConfirm(excluded);
  });

  document.body.appendChild(overlay);
}

/* ------------------------------------------------------------ send handling */

/** Re-issue the send the user originally attempted, bypassing interception. */
function triggerSend(composer) {
  state.bypass = true;
  const btn = document.querySelector(state.site.send);
  if (btn && !btn.disabled) {
    btn.click();
  } else if (composer) {
    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  }
  // Reset shortly after so future sends are intercepted again.
  setTimeout(() => (state.bypass = false), 0);
}

async function handleSendAttempt() {
  const composer = getComposer();
  const draft = readDraft(composer).trim();
  if (!draft) return false; // let the empty send through

  const result = await redact(draft, { policy: state.policy });
  if (result.entities.length === 0) {
    return false; // nothing sensitive — don't interfere
  }

  openPanel(result, (excluded) => {
    const sendVault = new Map(
      [...result.vault].filter(([, v]) => !excluded.has(v)),
    );
    const restore = new Map([...result.vault].filter(([, v]) => excluded.has(v)));
    const sendText = rehydrate(result.redactedText, restore);
    mergeVault(sendVault);
    writeDraft(composer, sendText);
    triggerSend(composer);
  });
  return true; // we handled it (blocked the raw send)
}

/* -------------------------------------------------------------- interception */

document.addEventListener(
  'keydown',
  (ev) => {
    if (state.bypass || state.panelOpen) return;
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
    const composer = getComposer();
    if (!composer || ev.target !== composer) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    void handleSendAttempt();
  },
  true,
);

document.addEventListener(
  'click',
  (ev) => {
    if (state.bypass || state.panelOpen) return;
    const sendBtn = ev.target instanceof Element ? ev.target.closest(state.site.send) : null;
    if (!sendBtn) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    void handleSendAttempt();
  },
  true,
);

/* ------------------------------------------------------- response rehydration */

/** Replace placeholders with real values inside a rendered message subtree. */
function rehydrateNode(node) {
  if (state.vault.size === 0) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const edits = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && n.nodeValue.includes('[[')) {
      const next = rehydrate(n.nodeValue, state.vault);
      if (next !== n.nodeValue) edits.push([n, next]);
    }
  }
  for (const [textNode, value] of edits) textNode.nodeValue = value;
}

function startObserver() {
  const stream = document.querySelector(state.site.stream) ?? document.body;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches?.(state.site.message)) rehydrateNode(added);
        added.querySelectorAll?.(state.site.message).forEach(rehydrateNode);
        // Streaming responses mutate text in place; rehydrate on any text change.
        if (added.closest?.(state.site.message)) rehydrateNode(added.closest(state.site.message));
      }
      if (m.type === 'characterData') {
        const host = m.target.parentElement?.closest?.(state.site.message);
        if (host) rehydrateNode(host);
      }
    }
  });
  observer.observe(stream, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/* --------------------------------------------------------------- settings */

function loadSettings() {
  try {
    chrome?.storage?.sync?.get?.(['dictionary', 'minConfidence'], (cfg) => {
      if (cfg?.dictionary) state.policy.dictionary = cfg.dictionary;
      if (typeof cfg?.minConfidence === 'number') state.policy.minConfidence = cfg.minConfidence;
    });
  } catch {
    /* chrome.storage unavailable (e.g. test page) — use defaults */
  }
}

/* ------------------------------------------------------------------- init */

loadSettings();
startObserver();

// Expose a tiny hook so the mock test page can assert on internal state.
if (location.hostname === 'localhost' || location.protocol === 'file:') {
  window.__piiGuard = { state, handleSendAttempt };
}
