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
