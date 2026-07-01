import { describe, expect, it } from 'vitest';
import { redactFhir } from '../src/formats/fhir.js';
import { rehydrate } from '../src/engine.js';

const PATIENT = {
  resourceType: 'Patient',
  id: 'example',
  text: {
    status: 'generated',
    div: '<div>Jane Doe, DOB 1985-03-12, reached at jane.doe@example.com</div>',
  },
  identifier: [
    {
      type: { coding: [{ system: 'v2-0203', code: 'MR' }] },
      system: 'urn:oid:1.2.36',
      value: 'A55231',
    },
    { system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' },
  ],
  name: [{ family: 'Doe', given: ['Jane', 'Q'], prefix: ['Ms.'] }],
  telecom: [
    { system: 'phone', value: '(415) 555-0132', use: 'home' },
    { system: 'email', value: 'jane.doe@example.com' },
    { system: 'fax', value: '415-555-0199' },
  ],
  gender: 'female',
  birthDate: '1985-03-12',
  address: [
    { line: ['123 Main St'], city: 'Boston', state: 'MA', postalCode: '02101' },
  ],
};

describe('redactFhir', () => {
  it('redacts PHI across FHIR datatypes and leaves clinical/non-PHI fields', async () => {
    const { redactedText, redacted } = await redactFhir(PATIENT);
    const r = redacted as any;

    // Structured fields are placeholders now.
    expect(r.name[0].family).toMatch(/^\[\[PERSON_\d+\]\]$/);
    expect(r.name[0].given[0]).toMatch(/^\[\[PERSON_\d+\]\]$/);
    expect(r.birthDate).toMatch(/^\[\[DATE_OF_BIRTH_\d+\]\]$/);
    expect(r.telecom[0].value).toMatch(/^\[\[PHONE_\d+\]\]$/);
    expect(r.telecom[1].value).toMatch(/^\[\[EMAIL_\d+\]\]$/);
    expect(r.telecom[2].value).toMatch(/^\[\[FAX_\d+\]\]$/);
    expect(r.address[0].city).toMatch(/^\[\[LOCATION_\d+\]\]$/);
    expect(r.address[0].line[0]).toMatch(/^\[\[LOCATION_\d+\]\]$/);

    // Identifier typing: MR -> MRN, SSN value detected -> SSN.
    expect(r.identifier[0].value).toMatch(/^\[\[MRN_\d+\]\]$/);
    expect(r.identifier[1].value).toMatch(/^\[\[SSN_\d+\]\]$/);

    // Non-PHI clinical/administrative fields are untouched.
    expect(r.gender).toBe('female');
    expect(r.address[0].state).toBe('MA');
    expect(r.resourceType).toBe('Patient');

    // Structured values (and the deterministic hits in narrative) are gone.
    expect(redactedText).not.toContain('123-45-6789');
    expect(redactedText).not.toContain('jane.doe@example.com');

    // Narrative free-text is swept for deterministic PHI too (email + DOB).
    expect(r.text.div).not.toContain('jane.doe@example.com');
    expect(r.text.div).not.toContain('1985-03-12');
    expect(r.text.status).toBe('generated');
    // NB: the *name* in the narrative ("Jane Doe") needs the NER layer, which
    // isn't wired in this unit test — only the structured name.family is caught.
  });

  it('gives the same value one stable placeholder (structured + narrative)', async () => {
    const { redacted, vault } = await redactFhir(PATIENT);
    const r = redacted as any;
    // The email appears in telecom AND the narrative div; one placeholder.
    const emailToken = r.telecom[1].value;
    expect(r.text.div).toContain(emailToken);
    expect(vault.get(emailToken)).toBe('jane.doe@example.com');
  });

  it('round-trips: rehydrate restores the original resource', async () => {
    const { redactedText, vault } = await redactFhir(PATIENT);
    const restored = JSON.parse(rehydrate(redactedText, vault));
    expect(restored.name[0].family).toBe('Doe');
    expect(restored.identifier[1].value).toBe('123-45-6789');
    expect(restored.telecom[0].value).toBe('(415) 555-0132');
    expect(restored.birthDate).toBe('1985-03-12');
  });

  it('walks a Bundle and redacts nested resources', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', name: [{ family: 'Smith' }] } },
        {
          resource: {
            resourceType: 'Practitioner',
            name: [{ family: 'Jones', given: ['Alan'] }],
          },
        },
      ],
    };
    const { redacted } = await redactFhir(bundle);
    const r = redacted as any;
    expect(r.entry[0].resource.name[0].family).toMatch(/^\[\[PERSON_\d+\]\]$/);
    expect(r.entry[1].resource.name[0].given[0]).toMatch(/^\[\[PERSON_\d+\]\]$/);
  });

  it('accepts a JSON string and honors a deny policy', async () => {
    const { redacted } = await redactFhir(JSON.stringify(PATIENT), {
      policy: { deny: ['DATE_OF_BIRTH'] },
    });
    const r = redacted as any;
    expect(r.birthDate).toBe('1985-03-12'); // denied -> left in the clear
    expect(r.name[0].family).toMatch(/^\[\[PERSON_\d+\]\]$/);
  });
});
