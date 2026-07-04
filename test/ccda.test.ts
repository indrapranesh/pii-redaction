import { describe, expect, it } from 'vitest';
import { redactCcda } from '../src/formats/ccda.js';
import { rehydrate } from '../src/engine.js';

const DOC = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.19.5" extension="MRN-12345"/>
      <id root="2.16.840.1.113883.4.1" extension="123-45-6789"/>
      <addr>
        <streetAddressLine>123 Main St</streetAddressLine>
        <city>Boston</city>
        <state>MA</state>
        <postalCode>02101</postalCode>
      </addr>
      <telecom value="tel:+1-415-555-0132" use="HP"/>
      <telecom value="mailto:jane@example.com"/>
      <patient>
        <name><given>Jane</given><family>Doe</family></name>
        <administrativeGenderCode code="F"/>
        <birthTime value="19850312"/>
      </patient>
    </patientRole>
  </recordTarget>
  <component><structuredBody><component><section>
    <text>Patient Jane Doe, SSN 123-45-6789, seen today.</text>
  </section></component></structuredBody></component>
</ClinicalDocument>`;

describe('redactCcda', () => {
  it('redacts patient identifiers, name, address, telecom, and birth time', async () => {
    const { redactedText } = await redactCcda(DOC);

    expect(redactedText).toMatch(/<given>\[\[PERSON_\d+\]\]<\/given>/);
    expect(redactedText).toMatch(/<family>\[\[PERSON_\d+\]\]<\/family>/);
    expect(redactedText).toMatch(/<streetAddressLine>\[\[LOCATION_\d+\]\]<\/streetAddressLine>/);
    expect(redactedText).toMatch(/<city>\[\[LOCATION_\d+\]\]<\/city>/);
    expect(redactedText).toMatch(/<postalCode>\[\[LOCATION_\d+\]\]<\/postalCode>/);
    expect(redactedText).toMatch(/<birthTime value="\[\[DATE_OF_BIRTH_\d+\]\]"/);
    expect(redactedText).toMatch(/<telecom value="\[\[PHONE_\d+\]\]"/);
    expect(redactedText).toMatch(/<telecom value="\[\[EMAIL_\d+\]\]"/);

    // Identifier typing: bare "MRN-12345" -> generic IDENTIFIER; SSN value -> SSN.
    expect(redactedText).toMatch(/extension="\[\[IDENTIFIER_\d+\]\]"/);
    expect(redactedText).toMatch(/extension="\[\[SSN_\d+\]\]"/);

    // State is kept (Safe Harbor allows it); raw PHI is gone.
    expect(redactedText).toContain('<state>MA</state>');
    expect(redactedText).not.toContain('123-45-6789');
    expect(redactedText).not.toContain('jane@example.com');
    expect(redactedText).not.toContain('Main St');
  });

  it('sweeps the section narrative for deterministic PHI', async () => {
    const { redactedText } = await redactCcda(DOC);
    // The SSN in the narrative is redacted (and shares the id's token).
    expect(redactedText).toMatch(/SSN \[\[SSN_\d+\]\], seen today/);
    // NB: the name "Jane Doe" in the narrative needs the NER layer, not wired here.
  });

  it('round-trips exactly via rehydrate', async () => {
    const { redactedText, vault } = await redactCcda(DOC);
    expect(rehydrate(redactedText, vault)).toBe(DOC);
  });
});
