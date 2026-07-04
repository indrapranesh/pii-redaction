import { runRecognizers } from '../deterministic/recognizers.js';
import type { PIIType } from '../types.js';
import { createRedactor, type FormatRedactOptions, type Redactor } from './shared.js';

/**
 * Structure-aware PHI redaction for C-CDA (Consolidated CDA) documents.
 *
 * C-CDA is XML. To keep the core dependency-free we don't pull in an XML parser;
 * instead we redact tag- and attribute-aware:
 *
 *  - person-name elements (`<family>`, `<given>`, `<prefix>`, `<suffix>`)
 *    anywhere in the document — names are always PHI, and over-redacting a
 *    provider name is safe;
 *  - address parts, telephone/email, ids, and birth time *scoped* to the
 *    `<recordTarget>` block, so facility/author addresses (not PHI) are left;
 *  - the free-text `<text>` section narratives, swept with the full detector
 *    (and optional NER) engine.
 *
 * Only leaf text and attribute values are replaced with placeholders, so the
 * XML structure is preserved and `rehydrate()` reconstructs the document.
 */

export interface CcdaRedactionResult {
  /** The redacted document, safe to send to a cloud LLM. */
  redactedText: string;
  /** placeholder -> original value. Never serialize to the network. */
  vault: Map<string, string>;
  /** original value -> placeholder. */
  placeholders: Map<string, string>;
  /** Every value that was redacted, with its type. */
  redactions: Array<{ type: PIIType; value: string; token: string }>;
}

/** Redact the text node of the named elements (with any attributes) as `type`. */
function redactElementText(
  xml: string,
  tags: string[],
  type: PIIType,
  R: Redactor,
): string {
  let out = xml;
  for (const tag of tags) {
    const re = new RegExp(`(<${tag}\\b[^>]*>)([^<]*)(</${tag}>)`, 'g');
    out = out.replace(re, (m, open: string, text: string, close: string) => {
      if (!/\S/.test(text)) return m;
      const token = R.allocate(type, text);
      return token ? open + token + close : m;
    });
  }
  return out;
}

/** Redact a `value="..."` attribute on the named element. */
function redactValueAttr(
  xml: string,
  tag: string,
  R: Redactor,
  resolveType: (value: string) => PIIType,
): string {
  const re = new RegExp(`<${tag}\\b[^>]*?\\bvalue="([^"]*)"[^>]*?/?>`, 'g');
  return xml.replace(re, (m, val: string) => {
    if (!val) return m;
    const token = R.allocate(resolveType(val), val);
    return token ? m.replace(`value="${val}"`, `value="${token}"`) : m;
  });
}

/** Redact an `extension="..."` identifier attribute on `<id>` elements. */
function redactIdExtension(xml: string, R: Redactor): string {
  return xml.replace(/<id\b[^>]*?\bextension="([^"]*)"[^>]*?\/?>/g, (m, val: string) => {
    if (!val) return m;
    const whole = runRecognizers(val).find(
      (h) => h.start === 0 && h.end === val.length,
    );
    const token = R.allocate(whole?.type ?? 'IDENTIFIER', val);
    return token ? m.replace(`extension="${val}"`, `extension="${token}"`) : m;
  });
}

/** Map a CDA telecom URI scheme to a type. */
function telecomType(value: string): PIIType {
  const v = value.toLowerCase();
  if (v.startsWith('mailto:')) return 'EMAIL';
  if (v.startsWith('fax:')) return 'FAX';
  if (v.startsWith('http://') || v.startsWith('https://')) return 'URL';
  return 'PHONE';
}

export async function redactCcda(
  xml: string,
  options: FormatRedactOptions = {},
): Promise<CcdaRedactionResult> {
  const R = createRedactor(options);
  let out = xml;

  // 1. Person names, anywhere in the document.
  out = redactElementText(out, ['family', 'given', 'prefix', 'suffix'], 'PERSON', R);

  // 2. recordTarget-scoped identifiers, address parts, telecom, birth time.
  //    (state / country are left in the clear — Safe Harbor allows them.)
  out = out.replace(/<recordTarget\b[\s\S]*?<\/recordTarget>/g, (block) => {
    let b = block;
    b = redactElementText(b, ['streetAddressLine', 'city', 'postalCode'], 'LOCATION', R);
    b = redactValueAttr(b, 'birthTime', R, () => 'DATE_OF_BIRTH');
    b = redactValueAttr(b, 'telecom', R, telecomType);
    b = redactIdExtension(b, R);
    return b;
  });

  // 3. Free-text section narratives. Done last so tokens from the structured
  //    passes above are simply left alone by the sweep.
  const narratives = [...out.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)];
  for (const match of narratives) {
    const full = match[0];
    const inner = full.replace(/^<text\b[^>]*>/, '').replace(/<\/text>$/, '');
    const open = full.slice(0, full.length - inner.length - '</text>'.length);
    const redactedInner = await R.redactFreeText(inner);
    if (redactedInner !== inner) {
      out = out.replace(full, open + redactedInner + '</text>');
    }
  }

  return {
    redactedText: out,
    vault: R.vault,
    placeholders: R.placeholders,
    redactions: R.redactions,
  };
}
