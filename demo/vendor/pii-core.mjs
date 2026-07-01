// src/deterministic/validators.ts
function digitsOnly(value) {
  return value.replace(/[\s-]/g, "");
}
function isLuhnValid(value) {
  const digits = digitsOnly(value);
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
function isValidSSN(value) {
  const digits = digitsOnly(value);
  if (!/^\d{9}$/.test(digits)) return false;
  const area = Number(digits.slice(0, 3));
  const group = Number(digits.slice(3, 5));
  const serial = Number(digits.slice(5, 9));
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;
  return true;
}
function isValidITIN(value) {
  const digits = digitsOnly(value);
  if (!/^9\d{8}$/.test(digits)) return false;
  const group = Number(digits.slice(3, 5));
  return group >= 50 && group <= 65 || group >= 70 && group <= 88 || group >= 90 && group <= 92 || group >= 94 && group <= 99;
}
function isValidIPv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (p.length > 1 && p[0] === "0") return false;
    return Number(p) <= 255;
  });
}
function isValidIPv6(value) {
  const v = value.trim();
  if (!/^[0-9a-f:.]+$/i.test(v)) return false;
  if (/:{3,}/.test(v)) return false;
  const doubleColons = v.match(/::/g);
  if (doubleColons && doubleColons.length > 1) return false;
  const hasCompression = v.includes("::");
  let head = v;
  let tailGroups = 0;
  const lastColon = v.lastIndexOf(":");
  const tail = v.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isValidIPv4(tail)) return false;
    head = v.slice(0, lastColon + 1);
    tailGroups = 2;
  }
  const parts = head.split(":");
  const hextets = parts.filter((p) => p !== "");
  for (const h of hextets) {
    if (!/^[0-9a-f]{1,4}$/i.test(h)) return false;
  }
  const total = hextets.length + tailGroups;
  return hasCompression ? total <= 7 : total === 8;
}
function isValidRoutingNumber(value) {
  const digits = digitsOnly(value);
  if (!/^\d{9}$/.test(digits)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * w[i];
  return sum % 10 === 0;
}
function isValidIBAN(value) {
  const compact = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const mapped = code >= 65 && code <= 90 ? (code - 55).toString() : ch;
    for (const digit of mapped) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}
function isPlausibleEmailDomain(email) {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1);
  if (domain.length === 0 || domain.length > 253) return false;
  if (!domain.includes(".")) return false;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return /^[a-z]{2,24}$/i.test(tld);
}

// src/deterministic/recognizers.ts
var RECOGNIZERS = [
  {
    // Email — matched before phone/account so its digits aren't misread.
    type: "EMAIL",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi,
    validate: isPlausibleEmailDomain,
    priority: 90
  },
  {
    // SSN — hyphenated, spaced, or 9 bare digits.
    type: "SSN",
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    validate: isValidSSN,
    priority: 80
  },
  {
    // ITIN — SSN-shaped but starts with 9; guarded by IRS group ranges.
    type: "ITIN",
    pattern: /\b9\d{2}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    validate: isValidITIN,
    priority: 82
  },
  {
    // Credit card — 13-19 digits, optionally grouped by spaces/hyphens.
    type: "CREDIT_CARD",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: isLuhnValid,
    priority: 70
  },
  {
    // IBAN — 2 letters, 2 check digits, then 10-30 alphanumerics.
    type: "IBAN",
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){2,8}\b/g,
    validate: isValidIBAN,
    priority: 75
  },
  {
    // IPv4 dotted quad.
    type: "IP",
    pattern: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
    validate: isValidIPv4,
    priority: 60
  },
  {
    // IPv6 — any colon-bearing token, validated (handles `::` compression and
    // an optional embedded IPv4 tail). Candidate must contain at least 2 colons.
    type: "IP",
    pattern: /(?<![0-9a-fA-F:.])(?=[0-9a-fA-F.]*:[0-9a-fA-F.]*:)[0-9a-fA-F:.]{2,45}(?![0-9a-fA-F:.])/g,
    validate: isValidIPv6,
    priority: 60
  },
  {
    // NANP + international phone numbers. Requires a separator or +country code
    // to avoid swallowing bare 10-digit account numbers.
    type: "PHONE",
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b|\+\d{1,3}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}\b/g,
    priority: 50
  },
  {
    // ABA routing number, guarded by its checksum.
    type: "ROUTING_NUMBER",
    pattern: /\b\d{9}\b/g,
    validate: isValidRoutingNumber,
    priority: 40
  },
  {
    // US passport — keyword-gated to avoid matching arbitrary alphanumerics.
    // Book numbers are 9 digits (older) or 1 letter + 8 digits (newer).
    type: "PASSPORT",
    pattern: /(?<=\bpassport(?:\s*(?:no|number|#))?\b[:.#\s]{0,3})[A-Z]?\d{8,9}\b/gi,
    priority: 58
  },
  {
    // Driver's license — formats vary wildly by state, so keyword-gate and
    // capture the following alphanumeric token.
    type: "DRIVERS_LICENSE",
    pattern: /(?<=\b(?:driver'?s?\s+licen[sc]e|dl(?:\s*(?:no|number|#))?)\b[:.#\s]{0,3})[A-Z0-9]{5,20}\b/gi,
    priority: 57
  },
  {
    // Medical record number — keyword-gated.
    type: "MRN",
    pattern: /(?<=\b(?:mrn|medical\s+record(?:\s+(?:no|number|#))?)\b[:.#\s]{0,3})[A-Z0-9-]{4,20}\b/gi,
    priority: 56
  },
  {
    // Generic bank/customer account number — keyword-gated, 6-17 digits.
    type: "ACCOUNT_NUMBER",
    pattern: /(?<=\b(?:acct|account|a\/c)(?:\s*(?:no|number|#))?\b[:.#\s]{0,3})\d[\d\s-]{5,20}\d\b/gi,
    priority: 30
  },
  {
    // Date of birth — only when a DOB keyword precedes the date. The lookbehind
    // keeps the match on the date itself (keyword stays in the clear).
    type: "DATE_OF_BIRTH",
    pattern: /(?<=\b(?:dob|d\.o\.b\.|date of birth|born(?: on)?)\b[:\s]{0,3})\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/gi,
    priority: 55
  }
];
function runRecognizers(text) {
  const out = [];
  for (const rec of RECOGNIZERS) {
    rec.pattern.lastIndex = 0;
    let m;
    while ((m = rec.pattern.exec(text)) !== null) {
      const matched = m[0];
      if (matched.length === 0) {
        rec.pattern.lastIndex++;
        continue;
      }
      if (rec.validate && !rec.validate(matched)) continue;
      out.push({
        type: rec.type,
        start: m.index,
        end: m.index + matched.length,
        text: matched,
        source: "deterministic",
        confidence: 1
      });
    }
  }
  return out;
}

// src/deterministic/index.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function runDictionary(text, terms) {
  const out = [];
  for (const t of terms) {
    if (!t.term) continue;
    const flags = t.caseSensitive ? "g" : "gi";
    const boundaried = /^[A-Za-z0-9].*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(t.term);
    const body = escapeRegExp(t.term);
    const pattern = new RegExp(boundaried ? `\\b${body}\\b` : body, flags);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      out.push({
        type: t.type,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        source: "dictionary",
        confidence: 1
      });
    }
  }
  return out;
}
function detectDeterministic(text, dictionary = []) {
  const entities = runRecognizers(text);
  if (dictionary.length > 0) entities.push(...runDictionary(text, dictionary));
  return entities;
}

// src/placeholders.ts
function makePlaceholder(type, index) {
  return `[[${type}_${index}]]`;
}
var PLACEHOLDER_RE = /\[\[[A-Z_]+_\d+\]\]/g;
function assignPlaceholders(entities) {
  const vault = /* @__PURE__ */ new Map();
  const placeholders = /* @__PURE__ */ new Map();
  const counters = /* @__PURE__ */ new Map();
  const keyToPlaceholder = /* @__PURE__ */ new Map();
  const byEntity = [];
  const order = entities.map((e, i) => ({ e, i })).sort((a, b) => a.e.start - b.e.start);
  for (const { e, i } of order) {
    const key = `${e.type}\0${e.text}`;
    let token = keyToPlaceholder.get(key);
    if (!token) {
      const next = (counters.get(e.type) ?? 0) + 1;
      counters.set(e.type, next);
      token = makePlaceholder(e.type, next);
      keyToPlaceholder.set(key, token);
      vault.set(token, e.text);
      placeholders.set(e.text, token);
    }
    byEntity[i] = token;
  }
  return { vault, placeholders, byEntity };
}

// src/reconcile.ts
var SOURCE_RANK = {
  dictionary: 3e3,
  deterministic: 2e3,
  ner: 1e3
};
var TYPE_RANK = {
  EMAIL: 90,
  ITIN: 82,
  SSN: 80,
  IBAN: 75,
  CREDIT_CARD: 70,
  IP: 60,
  PASSPORT: 58,
  DRIVERS_LICENSE: 57,
  MRN: 56,
  DATE_OF_BIRTH: 55,
  PHONE: 50,
  ROUTING_NUMBER: 40,
  ACCOUNT_NUMBER: 30
};
function precedence(e) {
  return SOURCE_RANK[e.source] + (TYPE_RANK[e.type] ?? 0) + e.confidence;
}
function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}
function reconcile(candidates) {
  const ranked = [...candidates].sort((a, b) => {
    const pd = precedence(b) - precedence(a);
    if (pd !== 0) return pd;
    const ld = b.end - b.start - (a.end - a.start);
    if (ld !== 0) return ld;
    return a.start - b.start;
  });
  const accepted = [];
  for (const cand of ranked) {
    if (cand.end <= cand.start) continue;
    if (accepted.some((a) => overlaps(a, cand))) continue;
    accepted.push(cand);
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

// src/engine.ts
function applyPolicy(entities, policy) {
  const allow = policy.allow ? new Set(policy.allow) : null;
  const deny = policy.deny ? new Set(policy.deny) : null;
  const minConfidence = policy.minConfidence ?? 0;
  return entities.filter((e) => {
    if (allow && !allow.has(e.type)) return false;
    if (deny && deny.has(e.type)) return false;
    if (e.source === "ner" && e.confidence < minConfidence) return false;
    return true;
  });
}
function applyPlaceholders(text, entities, byEntity) {
  const ordered = entities.map((e, i) => ({ e, token: byEntity[i] })).sort((a, b) => b.e.start - a.e.start);
  let out = text;
  for (const { e, token } of ordered) {
    out = out.slice(0, e.start) + token + out.slice(e.end);
  }
  return out;
}
async function redact(text, options = {}) {
  const policy = options.policy ?? {};
  const candidates = detectDeterministic(text, policy.dictionary ?? []);
  if (options.ner) {
    const nerEntities = await options.ner.detect(text);
    candidates.push(...nerEntities);
  }
  const filtered = applyPolicy(candidates, policy);
  const entities = reconcile(filtered);
  const { vault, placeholders, byEntity } = assignPlaceholders(entities);
  const redactedText = applyPlaceholders(text, entities, byEntity);
  return { redactedText, vault, entities, placeholders };
}
function rehydrate(text, vault) {
  if (vault.size === 0) return text;
  const keys = [...vault.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const key of keys) {
    out = out.split(key).join(vault.get(key));
  }
  return out;
}

// src/ner/chunk.ts
function chunkText(text, windowChars = 1600, overlapChars = 200) {
  if (windowChars <= 0) throw new Error("windowChars must be positive");
  if (overlapChars < 0 || overlapChars >= windowChars) {
    throw new Error("overlapChars must be in [0, windowChars)");
  }
  if (text.length <= windowChars) return [{ text, offset: 0 }];
  const stride = windowChars - overlapChars;
  const chunks = [];
  for (let start = 0; start < text.length; start += stride) {
    const end = Math.min(start + windowChars, text.length);
    chunks.push({ text: text.slice(start, end), offset: start });
    if (end === text.length) break;
  }
  return chunks;
}

// src/ner/transformers.ts
var DEFAULT_MODEL = "Xenova/bert-base-NER";
function mapLabel(label) {
  if (!label) return null;
  const tag = label.replace(/^[BI]-/, "").toUpperCase();
  switch (tag) {
    case "PER":
    case "PERSON":
      return "PERSON";
    case "ORG":
      return "ORG";
    case "LOC":
    case "GPE":
    case "LOCATION":
      return "LOCATION";
    case "MISC":
      return "MISC";
    default:
      return null;
  }
}
var TransformersNerProvider = class {
  opts;
  pipe = null;
  constructor(options = {}) {
    this.opts = {
      model: options.model ?? DEFAULT_MODEL,
      quantized: options.quantized ?? true,
      windowChars: options.windowChars ?? 1600,
      overlapChars: options.overlapChars ?? 200,
      device: options.device,
      pipelineFactory: options.pipelineFactory
    };
  }
  /** Lazily build (and cache) the pipeline. */
  getPipeline() {
    if (this.pipe) return this.pipe;
    this.pipe = this.buildPipeline();
    return this.pipe;
  }
  async buildPipeline() {
    const factory = this.opts.pipelineFactory ?? await loadPipelineFactory();
    const built = {
      dtype: this.opts.quantized ? "q8" : "fp32"
    };
    if (this.opts.device) built.device = this.opts.device;
    return factory("token-classification", this.opts.model, built);
  }
  async detect(text) {
    if (!text) return [];
    const pipe = await this.getPipeline();
    const chunks = chunkText(text, this.opts.windowChars, this.opts.overlapChars);
    const entities = [];
    for (const chunk of chunks) {
      const results = await pipe(chunk.text, {
        // Merge sub-word tokens into whole-entity spans.
        aggregation_strategy: "simple"
      });
      for (const r of results) {
        const type = mapLabel(r.entity_group ?? r.entity);
        if (type === null) continue;
        if (r.start == null || r.end == null || r.end <= r.start) continue;
        entities.push({
          type,
          start: chunk.offset + r.start,
          end: chunk.offset + r.end,
          text: text.slice(chunk.offset + r.start, chunk.offset + r.end),
          source: "ner",
          confidence: r.score
        });
      }
    }
    return entities;
  }
};
async function loadPipelineFactory() {
  try {
    const specifier = "@huggingface/transformers";
    const mod = await import(
      /* @vite-ignore */
      specifier
    );
    return mod.pipeline;
  } catch {
    throw new Error(
      "The NER layer requires the optional peer dependency '@huggingface/transformers'. Install it (npm i @huggingface/transformers) or pass a `pipelineFactory`."
    );
  }
}
function createTransformersNer(options) {
  return new TransformersNerProvider(options);
}
export {
  PLACEHOLDER_RE,
  RECOGNIZERS,
  TransformersNerProvider,
  assignPlaceholders,
  chunkText,
  createTransformersNer,
  detectDeterministic,
  isLuhnValid,
  isPlausibleEmailDomain,
  isValidIBAN,
  isValidIPv4,
  isValidIPv6,
  isValidITIN,
  isValidRoutingNumber,
  isValidSSN,
  makePlaceholder,
  reconcile,
  redact,
  rehydrate,
  runDictionary,
  runRecognizers
};
