import { cleanLiveryName } from '../codex-detail.component';
import { akteProse } from './codex-holo-akte.component';

describe('cleanLiveryName', () => {
  it('gives a title-cased acronym its capitals back', () => {
    expect(cleanLiveryName('Gladius Gladius Rp', 'Gladius')).toBe('Gladius RP');
  });

  it('keeps real words and the usual trims', () => {
    expect(cleanLiveryName('Gladius Frostbite Camo Livery', 'Gladius')).toBe('Frostbite Camo');
    expect(cleanLiveryName('Gladius (Standard)', 'Gladius')).toBe('Standard');
  });
});

describe('akteProse', () => {
  it('drops the leading maker and focus lines of a CIG description', () => {
    const raw = 'Hersteller: Aegis Dynamics\nFokus: Leichter Jäger\n\nBei der Gladius handelt es sich um ein älteres Design.';
    expect(akteProse(raw)).toBe('Bei der Gladius handelt es sich um ein älteres Design.');
  });

  it('handles CRLF line ends and English labels', () => {
    expect(akteProse('Manufacturer: Aegis Dynamics\r\nFocus: Light Fighter\r\n\r\nThe Gladius is a fighter.')).toBe('The Gladius is a fighter.');
  });

  it('keeps prose that has no data lines', () => {
    expect(akteProse('Die Gladius ist ein Jäger. Sie ist schnell: sehr schnell.')).toBe('Die Gladius ist ein Jäger. Sie ist schnell: sehr schnell.');
  });

  it('keeps a text that is nothing but data lines', () => {
    expect(akteProse('Hersteller: Aegis Dynamics\nFokus: Leichter Jäger')).toBe('Hersteller: Aegis Dynamics\nFokus: Leichter Jäger');
  });

  it('keeps a long first line that only happens to contain a colon', () => {
    const raw = 'Achtung: Diese Beschreibung beginnt mit einem langen Satz, der weit mehr als eine Datenzeile ist.\nZweite Zeile.';
    expect(akteProse(raw)).toBe(raw);
  });
});
