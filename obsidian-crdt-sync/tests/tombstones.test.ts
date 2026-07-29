import { pruneTombstones, migrateTombstones, TOMBSTONE_MAX_AGE_MS } from '../src/tombstones';

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

// Test 4 (Task 15): migrateTombstones — Alt-Format-Einträge werden verworfen.
//
// RED (vor Fix A): migrateTombstones ist nicht exportiert → Import-Fehler /
//   undefined → "TypeError: migrateTombstones is not a function".
//
// GREEN (nach Fix A): Funktion existiert; Einträge ohne Leerzeichen (Alt-Format,
//   nur GUID als Schlüssel) werden verworfen; Neu-Format-Einträge (Leerzeichen
//   als Separator) werden behalten; zu alte Einträge werden zusätzlich geprüft
//   (pruneTombstones-Verhalten bleibt erhalten).
describe('migrateTombstones (Task 15 — Fix A)', () => {
  const G = 'aa'.repeat(16);
  const now = 1_000_000_000_000;

  it('ist eine exportierte Funktion', () => {
    expect(typeof migrateTombstones).toBe('function');
  });

  it('verwirft Alt-Format (kein Leerzeichen), behält Neu-Format, prüft Alter', () => {
    const input: Record<string, number> = {
      [G]: now - 1000,                              // Alt-Format → verwerfen
      [`note.md ${G}`]: now - 1000,                 // Neu-Format, frisch → behalten
      [`alt.md ${G}`]: now - TOMBSTONE_MAX_AGE_MS - 1, // Neu-Format, zu alt → prune
    };
    const result = migrateTombstones(input, now);
    expect(result).toEqual({ [`note.md ${G}`]: now - 1000 });
  });

  it('leerer Store bleibt leer', () => {
    expect(migrateTombstones({}, now)).toEqual({});
  });

  it('Nur Alt-Format-Einträge → alle verworfen', () => {
    expect(migrateTombstones({ [G]: now - 1000 }, now)).toEqual({});
  });

  it('mutiert die Eingabe nicht', () => {
    const input = { [G]: now - 1000, [`p ${G}`]: now - 1000 };
    migrateTombstones(input, now);
    expect(Object.keys(input)).toEqual([G, `p ${G}`]);
  });
});
