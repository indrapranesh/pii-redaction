import { describe, expect, it } from 'vitest';
import {
  isLuhnValid,
  isPlausibleEmailDomain,
  isValidIBAN,
  isValidIPv4,
  isValidIPv6,
  isValidITIN,
  isValidRoutingNumber,
  isValidSSN,
} from '../src/deterministic/validators.js';

describe('isLuhnValid', () => {
  it('accepts known-good card numbers (formatted and bare)', () => {
    expect(isLuhnValid('4111 1111 1111 1111')).toBe(true); // Visa test
    expect(isLuhnValid('5500005555555559')).toBe(true); // MasterCard test
    expect(isLuhnValid('340000000000009')).toBe(true); // Amex test (15)
  });
  it('rejects numbers that fail the checksum', () => {
    expect(isLuhnValid('4111 1111 1111 1112')).toBe(false);
    expect(isLuhnValid('1234567890123456')).toBe(false);
  });
  it('rejects wrong-length input', () => {
    expect(isLuhnValid('1234')).toBe(false);
  });
});

describe('isValidSSN', () => {
  it('accepts structurally valid SSNs', () => {
    expect(isValidSSN('123-45-6789')).toBe(true);
    expect(isValidSSN('123456789')).toBe(true);
  });
  it('rejects invalid area/group/serial allocations', () => {
    expect(isValidSSN('000-45-6789')).toBe(false); // area 000
    expect(isValidSSN('666-45-6789')).toBe(false); // area 666
    expect(isValidSSN('900-45-6789')).toBe(false); // area 900+
    expect(isValidSSN('123-00-6789')).toBe(false); // group 00
    expect(isValidSSN('123-45-0000')).toBe(false); // serial 0000
  });
});

describe('isValidITIN', () => {
  it('accepts a 9xx number with an IRS-valid group', () => {
    expect(isValidITIN('900-70-0000')).toBe(true); // group 70 in 70-88
    expect(isValidITIN('999-88-1234')).toBe(true);
  });
  it('rejects non-9 leading digit and out-of-range groups', () => {
    expect(isValidITIN('123-70-0000')).toBe(false); // not a 9
    expect(isValidITIN('900-69-0000')).toBe(false); // group 69 excluded
    expect(isValidITIN('900-93-0000')).toBe(false); // group 93 excluded
  });
});

describe('isValidIPv6', () => {
  it('accepts full and compressed forms', () => {
    expect(isValidIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(isValidIPv6('2001:db8::8a2e:370:7334')).toBe(true);
    expect(isValidIPv6('::1')).toBe(true);
    expect(isValidIPv6('::ffff:192.168.0.1')).toBe(true); // IPv4 tail
  });
  it('rejects malformed addresses', () => {
    expect(isValidIPv6('2001:db8:::1')).toBe(false); // triple colon
    expect(isValidIPv6('12345::1')).toBe(false); // hextet too long
    expect(isValidIPv6('192.168.0.1')).toBe(false); // pure IPv4
    expect(isValidIPv6('2001:db8:85a3:0:0:8a2e:370')).toBe(false); // too few, no ::
  });
});

describe('isValidIPv4', () => {
  it('accepts dotted quads in range', () => {
    expect(isValidIPv4('192.168.0.1')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
  });
  it('rejects out-of-range octets and leading zeros', () => {
    expect(isValidIPv4('256.1.1.1')).toBe(false);
    expect(isValidIPv4('192.168.01.1')).toBe(false);
    expect(isValidIPv4('1.2.3')).toBe(false);
  });
});

describe('isValidRoutingNumber', () => {
  it('accepts a checksum-valid ABA number', () => {
    expect(isValidRoutingNumber('021000021')).toBe(true); // JPMorgan Chase NY
  });
  it('rejects checksum failures', () => {
    expect(isValidRoutingNumber('021000022')).toBe(false);
  });
});

describe('isValidIBAN', () => {
  it('accepts valid IBANs (spaced or compact)', () => {
    expect(isValidIBAN('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIBAN('GB82WEST12345698765432')).toBe(true);
  });
  it('rejects mod-97 failures', () => {
    expect(isValidIBAN('DE89 3704 0044 0532 0130 01')).toBe(false);
  });
});

describe('isPlausibleEmailDomain', () => {
  it('accepts real-looking addresses', () => {
    expect(isPlausibleEmailDomain('jane@example.com')).toBe(true);
  });
  it('rejects domains without a valid TLD', () => {
    expect(isPlausibleEmailDomain('jane@localhost')).toBe(false);
    expect(isPlausibleEmailDomain('jane@example.123')).toBe(false);
  });
});
