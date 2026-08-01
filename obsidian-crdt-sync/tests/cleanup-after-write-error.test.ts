// Nach einem gescheiterten `saveState` darf nichts aufgeräumt werden
//
// Szenariosuche 2026-07-31: `saveState` schluckt Schreibfehler bewusst
// (Task 17/F-6) — es markiert die Note als „nicht persistiert", meldet über den
// Rückkanal und kehrt NORMAL zurück. Der Aufrufer lief danach ungebremst in
// `cleanupLegacyFile`, dessen eigener Kommentar als Vorbedingung behauptet: „Wird
// nach saveState aufgerufen: zu dem Zeitpunkt existiert GUID-tragender State."
// Genau die gilt dann nicht.
//
// Folge ohne den Guard: Für diese Note existiert anschliessend KEIN einziges
// State-File mehr — die Legacy-Datei war der letzte Träger der Historie, und ihre
// Löschung wandert über den Datei-Sync auch noch zum zweiten Gerät.
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'notiz.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const LEGACY_PATH = `.qollab/${NOTE}.yjs`;

// v0.1-Form: kein Kopf, nur das nackte Yjs-Update.
function legacyDatei(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(mgr.encodeState(NOTE));
}

describe('Aufräumen nach Schreibfehler', () => {
  it('die Legacy-Datei überlebt, wenn der eigene State nicht geschrieben werden konnte', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_PATH, legacyDatei('Bestand aus v0.1\n'));
    vault._textFiles.set(NOTE, 'Bestand aus v0.1\n');

    // Der Sync-Dienst hält ein Handle auf die eigene Hilfsdatei: jeder Write
    // scheitert, der Rest des Adapters arbeitet normal.
    const gemeldet: string[] = [];
    vault.adapter.writeBinary = async () => {
      const e = new Error('EBUSY: injiziert') as NodeJS.ErrnoException;
      e.code = 'EBUSY';
      throw e;
    };

    const handler = new SyncHandler(
      vault as any,
      new CrdtManager(),
      OWN_ID,
      undefined,
      undefined,
      undefined,
      (p) => gemeldet.push(p)
    );

    await handler.applyLocalContent(NOTE, 'Bestand aus v0.1\nund etwas Neues\n');

    // Der Schreibfehler ist gemeldet worden — der Rückkanal aus Task 17/F-6.
    expect(gemeldet).toContain(OWN_PATH);
    // Und die Historie ist noch da.
    expect(vault._files.has(LEGACY_PATH)).toBe(true);
  });

  it('bei erfolgreichem Schreiben wird weiterhin aufgeräumt', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_PATH, legacyDatei('Bestand aus v0.1\n'));
    vault._textFiles.set(NOTE, 'Bestand aus v0.1\n');

    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID);
    await handler.applyLocalContent(NOTE, 'Bestand aus v0.1\nund etwas Neues\n');

    expect(vault._files.has(OWN_PATH)).toBe(true);
    expect(vault._files.has(LEGACY_PATH)).toBe(false);
  });
});
