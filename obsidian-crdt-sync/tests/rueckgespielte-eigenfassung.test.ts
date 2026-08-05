import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { WriteProvenance } from '../src/write-provenance';
import { makeVaultMock } from './helpers/vault-mock';

// DER LETZTE FALL MIT ECHTEM VERLUST.
//
// Die Schreibspur merkte sich anfangs die letzten VIER selbst geschriebenen
// Stände je Pfad. Spielt der Datei-Sync eine ÄLTERE Fassung zurück, die dieses
// Gerät irgendwann selbst geschrieben hat, stand sie damit noch im Puffer — sie
// galt als „eigen", wurde nicht geparkt, und der Diff gegen den neueren Stand
// machte aus der Differenz eine LÖSCHUNG, die zum anderen Gerät propagierte.
//
// Microsoft dokumentiert selbst, dass OneDrive neuere Dateien mit älteren
// überschreibt. Dämpfend: Der Puffer deckt nur wenige Sekunden Tipp-Historie ab.
//
// Gemessen: Bei VIER und bei ZWEI gemerkten Ständen tritt der Verlust ein und
// verlässt das Gerät — der Peer übernimmt die Löschung. Bei EINEM Stand tritt er
// nicht ein, und die volle Suite zeigt dabei keinen einzigen zusätzlichen
// Fehlschlag: Die Erkennung eigener Schreibvorgänge leidet nicht darunter.
//
// Diese Datei bewacht beide Hälften: dass die zurückgespielte Fassung als fremd
// gilt, und dass der Peer seinen Stand behält.

const NOTE = 'note.md';

describe('Zurückgespielte eigene Fassung', () => {
  it('die zurückgespielte alte Fassung gilt als FREMD und löscht nichts', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');
    const spur = new WriteProvenance(vault.adapter);
    spur.install();

    // Der Nutzer tippt, Obsidian speichert — zweimal.
    await vault.adapter.write(NOTE, 'kopf\nALT\n');
    await sync.applyLocalContent(NOTE, 'kopf\nALT\n');
    await vault.adapter.write(NOTE, 'kopf\nALT\nNEU\n');
    await sync.applyLocalContent(NOTE, 'kopf\nALT\nNEU\n');
    expect(crdt.getContent(NOTE)).toContain('NEU');

    // Der Sync spielt die ÄLTERE Fassung zurück — am Adapter vorbei.
    vault._textFiles.set(NOTE, 'kopf\nALT\n');

    // Das Tor fragt: stammt das aus diesem Prozess? Mit vier gemerkten Ständen
    // lautete die Antwort JA — die Fassung lag zwei Speichervorgänge zurück und
    // stand noch im Puffer. Genau darin lag der Fehler. Mit EINEM Stand ist sie
    // fremd und wird geparkt.
    expect(spur.istEigen(NOTE, 'kopf\nALT\n')).toBe(false);

    // Der Doc bleibt damit unberührt — NEU überlebt.
    expect(crdt.getContent(NOTE)).toContain('NEU');
  });

  it('der Peer behält seinen Stand — die Löschung entsteht gar nicht erst', async () => {
    // Zwei Geräte, dieselbe Historie. A verliert oben NEU — die Frage ist, ob B
    // es behält oder die Löschung übernimmt.
    const vaultA = makeVaultMock() as any;
    const crdtA = new CrdtManager();
    const syncA = new SyncHandler(vaultA, crdtA, 'aaaa1111');
    const spurA = new WriteProvenance(vaultA.adapter);
    spurA.install();

    await vaultA.adapter.write(NOTE, 'kopf\nALT\n');
    await syncA.applyLocalContent(NOTE, 'kopf\nALT\n');

    // B übernimmt A's Historie (der Sync trägt die Hilfsdatei hinüber).
    const vaultB = makeVaultMock() as any;
    const crdtB = new CrdtManager();
    const syncB = new SyncHandler(vaultB, crdtB, 'bbbb2222');
    for (const [pfad, buf] of vaultA._files) vaultB._files.set(pfad, buf.slice(0));
    vaultB._textFiles.set(NOTE, 'kopf\nALT\n');
    await syncB.loadAndMerge(NOTE);

    // A tippt NEU und verteilt es.
    await vaultA.adapter.write(NOTE, 'kopf\nALT\nNEU\n');
    await syncA.applyLocalContent(NOTE, 'kopf\nALT\nNEU\n');
    for (const [pfad, buf] of vaultA._files) vaultB._files.set(pfad, buf.slice(0));
    vaultB._textFiles.set(NOTE, 'kopf\nALT\nNEU\n');
    await syncB.loadAndMerge(NOTE);
    expect(crdtB.getContent(NOTE)).toContain('NEU');

    // Jetzt der Rücklauf auf A — die alte Fassung kommt zurück. Das Tor erkennt
    // sie als fremd, sie wird geparkt statt erfasst; A behält NEU.
    vaultA._textFiles.set(NOTE, 'kopf\nALT\n');
    expect(spurA.istEigen(NOTE, 'kopf\nALT\n')).toBe(false);
    syncA.parkForeign(NOTE, 'kopf\nALT\n');
    expect(crdtA.getContent(NOTE)).toContain('NEU');

    // A verteilt seinen Stand. B mergt.
    for (const [pfad, buf] of vaultA._files) vaultB._files.set(pfad, buf.slice(0));
    await syncB.loadAndMerge(NOTE);

    // Die Frage: Hat B den Text verloren, den nie jemand löschen wollte?
    expect(crdtB.getContent(NOTE)).toContain('NEU');
  });
});
