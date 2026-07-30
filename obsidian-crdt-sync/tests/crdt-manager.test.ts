import { CrdtManager, carriesYjsOps } from '../src/crdt-manager';

// Task 17 / R-1 — Der Nachweis muss „trägt Ops" verlangen, nicht „parst"
//
// Yjs liest `[0x00, 0x00]` als „0 Struct-Clients, 0 Delete-Set-Clients" und
// ignoriert den Rest. Jeder nullgefüllte Puffer ab 2 Byte parst damit
// fehlerfrei zu einem LEEREN Doc — genau die Erscheinungsform, die eine
// fehlgeschlagene OneDrive-Hydrierung bzw. ein abgebrochener NTFS-Extend
// hinterlässt. Ein reiner Parse-Check hält sie für einen nachgewiesenen
// v0.1-State.
describe('R-1: Ops-Nachweis für Sidecar-Bytes', () => {
  const realUpdate = () => {
    const m = new CrdtManager();
    m.setContent('note.md', 'Gemeinsamer Text\n');
    return m.encodeState('note.md');
  };

  it('nullgefüllte Puffer ab 2 Byte tragen keine Ops', () => {
    expect(carriesYjsOps(new Uint8Array(0))).toBe(false);
    expect(carriesYjsOps(new Uint8Array(2))).toBe(false);
    expect(carriesYjsOps(new Uint8Array(64))).toBe(false);
    expect(carriesYjsOps(new Uint8Array(4096))).toBe(false);
  });

  it('zerschossener 20-Byte-Header vor intakter Nutzlast trägt keine Ops', () => {
    // Der Puffer trägt den VOLLSTÄNDIGEN State — gelesen wird er trotzdem als
    // leer, weil der genullte Kopf die Struct-Anzahl auf 0 setzt. Als
    // „nachgewiesener Legacy-State" gewertet, wäre das die schlimmste Lage:
    // die Datei mit den echten Daten wird gelöscht.
    const real = realUpdate();
    const broken = new Uint8Array(20 + real.length);
    broken.set(real, 20);
    expect(carriesYjsOps(broken)).toBe(false);
  });

  it('ein echter State mit Inhalt trägt Ops', () => {
    expect(carriesYjsOps(realUpdate())).toBe(true);
  });

  it('nicht lesbare Bytes tragen keine Ops', () => {
    expect(carriesYjsOps(new Uint8Array(64).fill(0xff))).toBe(false);
  });
});

describe('CrdtManager', () => {
  it('speichert und liest Inhalt', () => {
    const m = new CrdtManager();
    m.setContent('note.md', 'Hallo Welt');
    expect(m.getContent('note.md')).toBe('Hallo Welt');
  });

  it('merged zwei gleichzeitige Änderungen ohne Konflikt', () => {
    const alice = new CrdtManager();
    const bob = new CrdtManager();

    // Beide starten mit gleichem Inhalt
    alice.setContent('note.md', 'Zeile 1\n');
    const baseState = alice.encodeState('note.md');
    bob.applyUpdate('note.md', baseState);

    // Alice fügt vorne ein, Bob hinten
    alice.setContent('note.md', 'Alice\nZeile 1\n');
    bob.setContent('note.md', 'Zeile 1\nBob\n');

    // Merge: Alice nimmt Bobs Update auf
    const bobState = bob.encodeState('note.md');
    alice.applyUpdate('note.md', bobState);

    const result = alice.getContent('note.md');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).toContain('Zeile 1');
  });

  it('encodiert und decodiert State ohne Datenverlust', () => {
    const m = new CrdtManager();
    m.setContent('note.md', 'Test-Inhalt');
    const state = m.encodeState('note.md');

    const m2 = new CrdtManager();
    m2.applyUpdate('note.md', state);
    expect(m2.getContent('note.md')).toBe('Test-Inhalt');
  });

  it('gibt leeren String für unbekannte Note zurück', () => {
    const m = new CrdtManager();
    expect(m.getContent('unbekannt.md')).toBe('');
  });

  it('gleichzeitige Bearbeitung derselben Zeile: Konvergenz (Gewinner per Yjs-Tie-Break)', () => {
    const alice = new CrdtManager();
    const bob = new CrdtManager();

    alice.setContent('note.md', 'Gemeinsame Zeile\n');
    bob.applyUpdate('note.md', alice.encodeState('note.md'));

    alice.setContent('note.md', 'Alices Version\n');
    bob.setContent('note.md', 'Bobs Version\n');

    // Beide nehmen den Stand des anderen auf
    alice.applyUpdate('note.md', bob.encodeState('note.md'));
    bob.applyUpdate('note.md', alice.encodeState('note.md'));

    const resultAlice = alice.getContent('note.md');
    const resultBob = bob.getContent('note.md');

    // Harte Konvergenz-Assertion: beide sehen dasselbe
    expect(resultAlice).toBe(resultBob);

    // Beide Edits sind im Ergebnis erkennbar (Yjs-CRDT: Character-Interleaving oder
    // klarer Gewinner — beides erfüllt diesen Check)
    expect(resultAlice).toMatch(/Al.*Bob|Bob.*Al|Alices Version|Bobs Version/);
  });

  it('dispose räumt Doc auf', () => {
    const m = new CrdtManager();
    m.setContent('note.md', 'x');
    m.disposeDoc('note.md');
    expect(m.getContent('note.md')).toBe('');
  });
});
