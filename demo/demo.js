// Client-side PII redaction demo. Loads the engine bundle locally; the NER
// model (optional) is fetched from a CDN only when the toggle is on.
import { redact, rehydrate, createTransformersNer } from './vendor/pii-core.mjs';

const $ = (id) => document.getElementById(id);
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

const policy = {
  minConfidence: 0.5, // bias toward recall: when in doubt, redact
  dictionary: [
    { term: 'Acme Corp', type: 'ORG' },
    { term: 'Project Bluebird', type: 'MISC' },
  ],
};

let lastVault = new Map();
let nerProvider = null;

/**
 * Build a NerProvider backed by Transformers.js loaded from the CDN. We inject
 * a `pipelineFactory` so the engine core never hard-depends on the model
 * runtime — exactly the seam used in tests.
 */
async function getNer() {
  if (nerProvider) return nerProvider;
  const progressRow = $('progressRow');
  progressRow.style.display = 'flex';
  const { pipeline, env } = await import(/* @vite-ignore */ `${CDN}/dist/transformers.min.js`);
  env.allowLocalModels = false; // fetch weights from the HF hub

  nerProvider = createTransformersNer({
    model: 'Xenova/bert-base-NER',
    pipelineFactory: async (task, model, opts) =>
      pipeline(task, model, {
        ...opts,
        progress_callback: (p) => {
          if (p.status === 'progress' && typeof p.progress === 'number') {
            $('progress').value = p.progress / 100;
            $('progressLabel').textContent = `Loading ${p.file ?? 'model'}… ${Math.round(p.progress)}%`;
          } else if (p.status === 'ready' || p.status === 'done') {
            $('progressLabel').textContent = 'Model ready.';
          }
        },
      }),
  });
  return nerProvider;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Highlight [[TYPE_N]] placeholders in redacted output. */
function renderRedacted(text) {
  const html = escapeHtml(text).replace(
    /\[\[[A-Z_]+_\d+\]\]/g,
    (m) => `<span class="ph">${m}</span>`,
  );
  $('redactedOut').innerHTML = html;
}

function renderReview(entities) {
  if (!entities.length) {
    $('reviewWrap').innerHTML = '<p class="note">No PII detected.</p>';
    return;
  }
  const rows = entities
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(
      (e) => `
      <tr>
        <td><span class="tag">${e.type}</span></td>
        <td>${escapeHtml(e.text)}</td>
        <td class="src-${e.source}">${e.source}</td>
        <td>${e.confidence.toFixed(2)}</td>
      </tr>`,
    )
    .join('');
  $('reviewWrap').innerHTML = `
    <table>
      <thead><tr><th>Type</th><th>Value</th><th>Source</th><th>Conf.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderVault(vault) {
  const body = [...vault.entries()]
    .map(([k, v]) => `<tr><td class="ph">${k}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  $('vaultTable').querySelector('tbody').innerHTML =
    body || '<tr><td colspan="2" class="note">empty</td></tr>';
}

async function runRedaction() {
  const btn = $('redactBtn');
  btn.disabled = true;
  try {
    const text = $('input').value;
    const opts = { policy };
    if ($('nerToggle').checked) opts.ner = await getNer();

    const t0 = performance.now();
    const result = await redact(text, opts);
    const ms = (performance.now() - t0).toFixed(1);

    lastVault = result.vault;
    renderRedacted(result.redactedText);
    renderReview(result.entities);
    renderVault(result.vault);
    $('latency').textContent = `${result.entities.length} entities · ${ms} ms`;

    // Seed the round-trip box with a mock response referencing placeholders.
    if (!$('responseIn').value.trim()) {
      const first = [...result.vault.keys()];
      $('responseIn').value = first.length
        ? `Sure — I've noted ${first[0]}${first[1] ? ` and ${first[1]}` : ''}. I will follow up shortly.`
        : '';
    }
  } catch (err) {
    $('redactedOut').textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function runRehydrate() {
  $('rehydratedOut').textContent = rehydrate($('responseIn').value, lastVault);
}

$('redactBtn').addEventListener('click', runRedaction);
$('rehydrateBtn').addEventListener('click', runRehydrate);
