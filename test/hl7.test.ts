import { describe, expect, it } from 'vitest';
import { redactHl7 } from '../src/formats/hl7.js';
import { rehydrate } from '../src/engine.js';

const MSG = [
  'MSH|^~\\&|SENDING|FAC|RECEIVING|FAC|20240101120000||ADT^A01|MSG001|P|2.5',
  'PID|1||MRN12345^^^HOSP^MR||DOE^JOHN^Q||19850312|M|||123 MAIN ST^^BOSTON^MA^02101||(415)555-0132|||||ACC998877|123-45-6789|D9988776',
  'NK1|1|DOE^JANE|SPO||(415)555-0199',
  'NTE|1||Patient jane@example.com called about SSN 123-45-6789.',
].join('\r');

describe('redactHl7', () => {
  it('redacts PHI fields in PID and leaves structural markers + non-PHI', async () => {
    const { redactedText } = await redactHl7(MSG);
    const pid = redactedText.split('\r')[1].split('|');

    expect(pid[3]).toMatch(/^\[\[MRN_\d+\]\]\^\^\^HOSP\^MR$/); // id typed by MR code
    expect(pid[5]).toMatch(/^\[\[PERSON_\d+\]\]\^\[\[PERSON_\d+\]\]\^\[\[PERSON_\d+\]\]$/);
    expect(pid[7]).toMatch(/^\[\[DATE_OF_BIRTH_\d+\]\]$/);
    expect(pid[13]).toMatch(/^\[\[PHONE_\d+\]\]$/);
    expect(pid[18]).toMatch(/^\[\[ACCOUNT_NUMBER_\d+\]\]$/);
    expect(pid[19]).toMatch(/^\[\[SSN_\d+\]\]$/);
    expect(pid[20]).toMatch(/^\[\[DRIVERS_LICENSE_\d+\]\]$/);

    // Address: street/city/zip redacted, state kept.
    const addr = pid[11].split('^');
    expect(addr[0]).toMatch(/^\[\[LOCATION_\d+\]\]$/); // 123 MAIN ST
    expect(addr[2]).toMatch(/^\[\[LOCATION_\d+\]\]$/); // BOSTON
    expect(addr[3]).toBe('MA'); // state left in the clear
    expect(addr[4]).toMatch(/^\[\[LOCATION_\d+\]\]$/); // 02101

    // Raw values gone from the whole message.
    expect(redactedText).not.toContain('123-45-6789');
    expect(redactedText).not.toContain('jane@example.com');
    expect(redactedText).not.toContain('998877');

    // MSH untouched; delimiters and segment structure intact.
    expect(redactedText.startsWith('MSH|^~\\&|SENDING')).toBe(true);
    expect(redactedText.split('\r')).toHaveLength(4);
  });

  it('gives the SSN one token across PID-19 and the NTE note', async () => {
    const { redactedText, vault } = await redactHl7(MSG);
    const ssnToken = redactedText.split('\r')[1].split('|')[19];
    expect(redactedText.split('\r')[3]).toContain(ssnToken); // reused in NTE-3
    expect(vault.get(ssnToken)).toBe('123-45-6789');
  });

  it('round-trips exactly via rehydrate', async () => {
    const { redactedText, vault } = await redactHl7(MSG);
    expect(rehydrate(redactedText, vault)).toBe(MSG);
  });

  it('reads delimiters from MSH rather than assuming them', async () => {
    const custom = 'MSH#@~\\&#S#F#R#F#20240101##ADT^A01#M#P#2.5\rPID#1##ID@@@H@MR##SMITH@ANN';
    const { redactedText } = await redactHl7(custom);
    // field sep '#', component sep '@' — PID-5 name still redacted
    const pid = redactedText.split('\r')[1].split('#');
    expect(pid[5]).toMatch(/^\[\[PERSON_\d+\]\]@\[\[PERSON_\d+\]\]$/);
  });
});
