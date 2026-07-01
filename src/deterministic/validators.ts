/**
 * Validators turn high-noise regex detectors into high-precision ones.
 * Each returns true only when the candidate passes a structural/checksum test,
 * killing false positives for free (the Luhn check is the canonical example).
 */

/** Strip spaces and hyphens; used before checksum math. */
function digitsOnly(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/**
 * Luhn (mod-10) checksum, the standard for payment card numbers. Turns a raw
 * "13-19 digits" detector into a high-precision credit-card recognizer.
 */
export function isLuhnValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' === 48
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * US SSN structural validity. Rejects allocations the SSA never issues:
 * area 000 / 666 / 900-999, group 00, serial 0000.
 */
export function isValidSSN(value: string): boolean {
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

/**
 * US ITIN — an SSN-shaped tax id that always starts with 9 and whose group
 * (4th-5th digits) falls in the IRS-assigned ranges 50-65, 70-88, 90-92, 94-99.
 */
export function isValidITIN(value: string): boolean {
  const digits = digitsOnly(value);
  if (!/^9\d{8}$/.test(digits)) return false;
  const group = Number(digits.slice(3, 5));
  return (
    (group >= 50 && group <= 65) ||
    (group >= 70 && group <= 88) ||
    (group >= 90 && group <= 92) ||
    (group >= 94 && group <= 99)
  );
}

/** Every octet of a dotted-quad must be 0-255 with no leading zeros. */
export function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (p.length > 1 && p[0] === '0') return false; // no leading zeros
    return Number(p) <= 255;
  });
}

/**
 * IPv6 validity including `::` zero-compression (at most one `::`) and an
 * optional trailing IPv4 tail (e.g. `::ffff:192.168.0.1`). Rejects strings that
 * have too many groups or a malformed hextet.
 */
export function isValidIPv6(value: string): boolean {
  const v = value.trim();
  if (!/^[0-9a-f:.]+$/i.test(v)) return false;
  if (/:{3,}/.test(v)) return false; // ':::' or more is never valid
  const doubleColons = v.match(/::/g);
  if (doubleColons && doubleColons.length > 1) return false;
  const hasCompression = v.includes('::');

  // Split off an optional IPv4 tail, which counts as two hextets.
  let head = v;
  let tailGroups = 0;
  const lastColon = v.lastIndexOf(':');
  const tail = v.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isValidIPv4(tail)) return false;
    head = v.slice(0, lastColon + 1); // keep the trailing colon for splitting
    tailGroups = 2;
  }

  const parts = head.split(':');
  // Remove empty parts produced by leading/trailing/`::` colons.
  const hextets = parts.filter((p) => p !== '');
  for (const h of hextets) {
    if (!/^[0-9a-f]{1,4}$/i.test(h)) return false;
  }
  const total = hextets.length + tailGroups;
  return hasCompression ? total <= 7 : total === 8;
}

/**
 * ABA routing number checksum (weights 3-7-1 repeating over 9 digits).
 */
export function isValidRoutingNumber(value: string): boolean {
  const digits = digitsOnly(value);
  if (!/^\d{9}$/.test(digits)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * w[i];
  return sum % 10 === 0;
}

/**
 * IBAN validity via the ISO 13616 / ISO 7064 mod-97 check. Moves the first 4
 * chars to the end, maps letters A-Z to 10-35, and requires the big-integer
 * value mod 97 to equal 1.
 */
export function isValidIBAN(value: string): boolean {
  const compact = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const mapped =
      code >= 65 && code <= 90
        ? (code - 55).toString() // A->10 ... Z->35
        : ch;
    for (const digit of mapped) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * US National Provider Identifier (PHI). A 10-digit number whose final digit is
 * a Luhn check computed after prefixing the constant issuer id `80840`. So the
 * 15-char string `80840` + NPI must itself satisfy the Luhn mod-10 check.
 */
export function isValidNPI(value: string): boolean {
  const digits = digitsOnly(value);
  if (!/^\d{10}$/.test(digits)) return false;
  return isLuhnValid('80840' + digits);
}

/**
 * US DEA registration number (PHI — prescriber id). Two letters then seven
 * digits; the last digit is a checksum: (d1+d3+d5) + 2*(d2+d4+d6) mod 10. The
 * first letter is a registrant-type code; the second is the registrant's
 * last-name initial (any letter).
 */
export function isValidDEA(value: string): boolean {
  const v = value.toUpperCase();
  const m = /^([ABFGMPRX])[A-Z](\d{7})$/.exec(v);
  if (!m) return false;
  const d = m[2];
  const n = (i: number): number => d.charCodeAt(i) - 48;
  const sum1 = n(0) + n(2) + n(4);
  const sum2 = n(1) + n(3) + n(5);
  return (sum1 + 2 * sum2) % 10 === n(6);
}

/** Letters CMS permits in an MBI (A-Z minus the look-alikes S, L, O, I, B, Z). */
const MBI_ALPHA = 'ACDEFGHJKMNPQRTUVWXY';

/**
 * US Medicare Beneficiary Identifier (PHI). Eleven characters, hyphens
 * optional, with strict per-position rules: numeric / alpha / alphanumeric in a
 * fixed pattern, using only the non-ambiguous MBI alphabet. There is no
 * checksum, so the positional rules carry the precision.
 */
export function isValidMBI(value: string): boolean {
  const v = value.replace(/[-\s]/g, '').toUpperCase();
  if (v.length !== 11) return false;
  const A = `[${MBI_ALPHA}]`;
  const AN = `[0-9${MBI_ALPHA}]`;
  const re = new RegExp(`^[1-9]${A}${AN}[0-9]${A}${AN}[0-9]${A}${A}[0-9][0-9]$`);
  return re.test(v);
}

/**
 * US/ISO-3779 Vehicle Identification Number (PHI — Safe Harbor identifier #12).
 * 17 chars excluding I/O/Q, with a mod-11 check digit at position 9 (value `X`
 * means 10). Letters transliterate to numeric values per the standard.
 */
export function isValidVIN(value: string): boolean {
  const v = value.toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  const translit: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i];
    const val = /\d/.test(ch) ? ch.charCodeAt(0) - 48 : translit[ch];
    if (val === undefined) return false;
    sum += val * weights[i];
  }
  const check = sum % 11;
  const expected = check === 10 ? 'X' : String(check);
  return v[8] === expected;
}

/** A conservative allow-list check that an email's domain looks plausible. */
export function isPlausibleEmailDomain(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1);
  if (domain.length === 0 || domain.length > 253) return false;
  if (!domain.includes('.')) return false;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return /^[a-z]{2,24}$/i.test(tld);
}
