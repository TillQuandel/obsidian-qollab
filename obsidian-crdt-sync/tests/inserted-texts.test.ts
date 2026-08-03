// Testlücke aus der Mutationsmessung (Runde 3): `insertedTexts` (text-merge.ts)
// hatte keinen einzigen Test.
//
// Die Funktion beantwortet in `chooseLocalDiffBase` genau eine Frage: „Trägt der
// gerade gelesene `.md`-Inhalt schon Text, den der Doc uns gegenüber voraus hat?"
// Fällt die Antwort fälschlich auf `ja`, wird der VORAUSLAUFENDE Doc-Stand zur
// Diff-Basis — und das Delta „Doc → .md" ist dann exakt die LÖSCHUNG des
// Fremd-Edits. `setContent` schreibt sie als Delete-Op, der Sync trägt sie zum
// Peer: der Doc-Vorlauf-Fund, gegen den Task 16 gebaut wurde.
//
// Der Whitespace-Filter (`.filter((text) => text.trim() !== '')`) ist genau die
// Sperre dagegen. Ohne ihn enthält `lead` bei jedem Fremd-Edit, der eine Leerzeile
// mitbringt, ein reines `"\n"` — und `content.includes("\n")` ist in JEDER
// mehrzeiligen Notiz trivial wahr.
//
// Zwei Ebenen: die Funktion selbst und der Schadensweg, an dem sie hängt.

import { insertedTexts } from '../src/text-merge';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer, VaultMock } from './helpers/vault-mock';

describe('insertedTexts: nur echte Einfügungen, nur nicht-leere', () => {
  it('gleicher Text → nichts eingefügt', () => {
    expect(insertedTexts('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('meldet den hinzugekommenen Text', () => {
    expect(insertedTexts('L1\nL2\n', 'L1\nL2\nL3\n')).toEqual(['L3\n']);
  });

  it('meldet Löschungen NICHT (nur die Richtung from → to zählt)', () => {
    expect(insertedTexts('L1\nL2\nL3\n', 'L1\nL2\n')).toEqual([]);
  });

  it('reine Whitespace-Einfügungen fallen weg — sie machen jede Prüfung trivial wahr', () => {
    // Der Kern des Filters: eine eingefügte Leerzeile ist in jedem mehrzeiligen
    // Text enthalten. Ohne den Filter stünde hier ['\n'].
    expect(insertedTexts('A\nB\n', 'A\n\nB\n')).toEqual([]);
  });

  it('mischt sich Whitespace unter echten Text, bleibt nur der echte Text übrig', () => {
    // Der Fall aus der Praxis: der Peer setzt eine Leerzeile UND schreibt einen
    // Absatz. Der Diff liefert beides als getrennte Einfügungen.
    expect(insertedTexts('L1\nL2\nL3\n', 'L1\n\nL2\nL3\nFREMD\n')).toEqual(['FREMD\n']);
  });

  it('mehrere echte Einfügungen kommen alle zurück', () => {
    const lead = insertedTexts('A\nC\n', 'A\nNEU-B\nC\nNEU-D\n');
    expect(lead.join('')).toContain('NEU-B');
    expect(lead.join('')).toContain('NEU-D');
  });
});

// ---------------------------------------------------------------------------
// Der Schadensweg. Aufbau wie in doc-ahead-local-diff.test.ts, mit EINEM
// Unterschied: der Fremd-Edit bringt eine Leerzeile mit. Genau daran scheidet
// sich der Whitespace-Filter — die bestehenden Doc-Vorlauf-Tests benutzen alle
// einen Fremd-Edit ohne Leerzeile und bleiben deshalb auch ohne ihn grün.
// ---------------------------------------------------------------------------
const NOTE = 'note.md';
const OWN_ID = 'aaaa1111';
const FOREIGN_ID = 'bbbb2222';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const FOREIGN_PATH = `.qollab/${NOTE}.${FOREIGN_ID}.yjs`;

const BASE = 'L1\nL2\nL3\n';
// Der Peer setzt eine Leerzeile hinter L1 UND hängt FREMD an.
const MIT_FREMD = 'L1\n\nL2\nL3\nFREMD\n';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

function placeForeignSidecar(vault: VaultMock): void {
  const own = decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!));
  const peer = new CrdtManager();
  peer.applyUpdate(NOTE, own.update);
  peer.setContent(NOTE, MIT_FREMD);
  vault._files.set(FOREIGN_PATH, toArrayBuffer(encodeStateFile(own.guid!, peer.encodeState(NOTE))));
  vault._mtimes.set(FOREIGN_PATH, (vault._mtimes.get(OWN_PATH) ?? 0) + 1);
}

describe('Doc-Vorlauf mit Leerzeile im Fremd-Edit', () => {
  it('der zweite Tastendruck verbucht den Fremd-Absatz nicht als Löschung', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    // Eigener Stand: Doc, Sidecar und Diff-Basis stehen auf BASE.
    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);

    // Der Datei-Sync legt die Sidecar des Peers ab (seine .md ist noch unterwegs).
    placeForeignSidecar(vault);

    // Tastendruck 1: der Fremd-Stand kommt in den Doc, die .md bleibt zurück —
    // der Doc läuft ihr jetzt voraus (kein Write-Back auf Handler-Ebene).
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    expect(manager.getContent(NOTE)).toContain('FREMD');

    // Tastendruck 2 auf derselben, vorlauf-freien .md. Hier entscheidet
    // `chooseLocalDiffBase`, und `lead` enthält ohne den Whitespace-Filter das
    // reine "\n" der Leerzeile → `content.includes("\n")` → Basis kippt auf den
    // vorauslaufenden Doc → der Fremd-Absatz wird als lokale Löschung geschrieben.
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);

    const doc = manager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // ohne Whitespace-Filter: 0
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
  });

  it('die Löschung steht auch nicht in der eigenen Hilfsdatei (das trägt der Sync zum Peer)', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);
    placeForeignSidecar(vault);

    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);

    const persistiert = new CrdtManager();
    persistiert.applyUpdate(
      NOTE,
      decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!)).update
    );
    expect(count(persistiert.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('Gegenprobe: eine .md, die den Fremd-Absatz schon trägt, verdoppelt ihn nicht', async () => {
    // Die andere Richtung derselben Entscheidung: hier IST der Vorlauf in der
    // Datei angekommen (Sync-Overwrite mit der gemergten Peer-Fassung), und die
    // Basis muss auf den Doc-Stand kippen. Würde man den Filter zu breit fassen
    // (z.B. alle Einfügungen verwerfen), bliebe die Basis auf dem alten .md-Stand
    // und `patch_apply` fügte den Fremd-Absatz ein zweites Mal ein.
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);
    placeForeignSidecar(vault);

    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    expect(count(manager.getContent(NOTE), 'FREMD')).toBe(1);

    // Der Sync legt die gemergte Peer-Fassung ab (trägt FREMD, nicht LOKAL1).
    vault._textFiles.set(NOTE, MIT_FREMD);
    await handler.applyLocalContent(NOTE, MIT_FREMD);

    expect(count(manager.getContent(NOTE), 'FREMD')).toBe(1);
  });
});
