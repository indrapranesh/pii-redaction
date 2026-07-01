# PII Redaction Guard — browser extension (MV3)

The MVP wedge: sits in the browser, intercepts the send action on the
ChatGPT/Claude web UI, redacts the draft **before it leaves your machine**, shows
a review-before-send panel, and rehydrates the assistant's response locally. The
vault (placeholder → real value) never leaves the content-script scope.

## Build & load

```bash
npm run build:browser   # produces extension/content.js (+ vendor bundle)
```

Then load it unpacked:

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Open ChatGPT or Claude and start typing. On send, the review panel appears.

Configure a custom dictionary and the NER confidence threshold from the toolbar
popup (stored in `chrome.storage.sync`).

## How it works

- `content.js` (bundled IIFE, engine inlined) intercepts Enter / the send button
  in the capture phase, runs the deterministic + dictionary redaction engine,
  and opens the review panel.
- On confirm, only the redacted text is written back into the composer and sent;
  unticked items are restored via partial rehydration and left in the clear.
- A `MutationObserver` on the message stream rehydrates placeholders in the
  assistant's reply using the tab vault — only known keys are swapped, so a
  mangled or hallucinated token is left untouched.

## Scope (v1)

- **In:** deterministic + dictionary detection, review panel, redacted send,
  response rehydration, per-tab vault.
- **Out (next):** in-extension NER (PERSON/ORG/LOCATION). Running the ONNX model
  under a strict page CSP needs an **offscreen document** (or the model hosted as
  a web-accessible resource); the engine already supports it via the pluggable
  `NerProvider`, so this is a wiring task, not an engine change.

## Testing

`extension/test/mock.html` is a stand-in chat UI (uses `[data-pii-*]` hooks the
content script recognizes). The e2e check drives it in headless Chromium:

```bash
npm run test:e2e   # builds bundles, runs demo + extension e2e
```

Selectors for the real sites live in the `SITES` table in
`extension/src/content.js` and may need updating as those UIs change.
