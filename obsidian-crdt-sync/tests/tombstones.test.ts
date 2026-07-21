import { pruneTombstones, TOMBSTONE_MAX_AGE_MS } from '../src/tombstones';

// Test 6 (Task 3): Tombstone-Cleanup — Einträge > 90 Tage werden entfernt.
// Reine Funktion, direkt testbar (kein Obsidian/Plugin nötig).

describe('pruneTombstones', () => {
  it('TOMBSTONE_MAX_AGE_MS entspricht 90 Tagen', () => {
    expect(TOMBSTONE_MAX_AGE_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('entfernt Einträge ≥ 90 Tage, behält jüngere', () => {
    const now = 1_000_000_000_000;
    const tombs = {
      alt: now - TOMBSTONE_MAX_AGE_MS - 1, // älter als 90 Tage
      grenze: now - TOMBSTONE_MAX_AGE_MS, // exakt 90 Tage → entfernt
      jung: now - 1000, // frisch
    };
    expect(pruneTombstones(tombs, now)).toEqual({ jung: now - 1000 });
  });

  it('leerer Store bleibt leer', () => {
    expect(pruneTombstones({}, 123)).toEqual({});
  });

  it('mutiert die Eingabe nicht', () => {
    const now = 1_000_000_000_000;
    const tombs = { alt: now - TOMBSTONE_MAX_AGE_MS - 1, jung: now };
    pruneTombstones(tombs, now);
    expect(Object.keys(tombs)).toEqual(['alt', 'jung']);
  });
});
