import { CrdtManager } from '../src/crdt-manager';
import { SyncHandler } from '../src/sync-handler';
import { makeVaultMock } from './helpers/vault-mock';

// Konvergenz-Netz für den Merge-Kern.
//
// Nach Task 2 ist setContent diff-basiert (unveränderte Zeichen behalten ihre
// Item-IDs) und der Doc-Bootstrap läuft nie über den .md-Text, sondern über
// vorhandenen State (eigene .yjs bzw. adoptierte fremde Sibling-.yjs). Damit
// dedupliziert der Merge statt zu konkatenieren.
//
// Dokumentierter Grenzfall „Simultan-Erstkontakt": Zwei Replikate, die OHNE
// jede geteilte Basis und OHNE Sibling-Dateien unabhängig denselben Text
// setzen und dann direkt auf CrdtManager-Ebene mergen, bleiben prinzipbedingt
// Konkatenation (getrennte Insert-Historien, kein gemeinsamer Ursprung). Dieser
// Fall wird von Task 2 NICHT aufgelöst und daher nicht als Test geführt — der
// reale Pfad (SyncHandler.loadAndMerge mit Basis-Adoption) ist Test 1 unten.
//
// Assertions ausschliesslich mit `toBe` (exakte Gleichheit), nie `toContain`.

describe('Merge-Kern-Konvergenz', () => {
  it('Zwei-Geräte-Erstmerge über SyncHandler dedupliziert (Basis-Adoption)', async () => {
    // Realer Pfad statt Manager-Level-Simultan-Erstkontakt: Gerät B hat KEINEN
    // eigenen State, sieht aber As .yjs als Sibling und hält lokal dieselbe .md.
    // ensureDoc adoptiert As Historie als Basis und spielt die .md NICHT ein →
    // exakt ein Text, keine Verdopplung.
    const vault = makeVaultMock();
    const text = 'Hallo Welt\n';

    const A = new CrdtManager();
    A.setContent('note.md', text);
    vault._files.set(
      '.qollab/note.md.aaaa1111.yjs',
      A.encodeState('note.md').buffer as ArrayBuffer
    );

    vault._textFiles.set('note.md', text);
    const B = new CrdtManager();
    const handler = new SyncHandler(vault as any, B, 'bbbb2222');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(text);
  });

  it('Konvergenz + Korrektheit bei disjunkten Zeilen-Edits', () => {
    const base = 'Zeile 1\nZeile 2\nZeile 3\n';

    // A und B starten mit gemeinsamer Historie desselben Ausgangstextes.
    const A = new CrdtManager();
    A.setContent('note.md', base);
    const B = new CrdtManager();
    B.applyUpdate('note.md', A.encodeState('note.md'));

    // A ändert Zeile 1, B ändert Zeile 3 (jeweils via Volltext-setContent).
    A.setContent('note.md', 'A-Zeile 1\nZeile 2\nZeile 3\n');
    B.setContent('note.md', 'Zeile 1\nZeile 2\nB-Zeile 3\n');

    // Wechselseitiger Austausch.
    A.applyUpdate('note.md', B.encodeState('note.md'));
    B.applyUpdate('note.md', A.encodeState('note.md'));

    const expected = 'A-Zeile 1\nZeile 2\nB-Zeile 3\n';
    // Diff-basiert: unveränderte Zeichen behalten ihre IDs → beide Edits
    // koexistieren an ihrer Position, kein Duplikat.
    expect(A.getContent('note.md')).toBe(B.getContent('note.md'));
    expect(A.getContent('note.md')).toBe(expected);
  });

  it('Cold-Start über loadAndMerge ist idempotent', async () => {
    const vault = makeVaultMock();
    const text = 'Hallo Welt\n';

    // Note liegt als .md vor und hat eine (fremde) .yjs aus demselben Text.
    vault._textFiles.set('note.md', text);
    const source = new CrdtManager();
    source.setContent('note.md', text);
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      source.encodeState('note.md').buffer as ArrayBuffer
    );

    // Frischer Manager — Doc nicht geladen → ensureDoc adoptiert die vorhandene
    // .yjs als Basis (statt die .md als frische Historie einzuspielen).
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(text);
  });

  it('Nur-Remote-Änderung wird übernommen (lokaler State erfasst, .md nicht eingespielt)', async () => {
    // Vor Fix 2 pinnte dieser Test die alte Adopt-Semantik: kein eigener State,
    // .md = alter Basistext, Erwartung = reiner Remote-Stand (die stale .md wurde
    // NICHT eingespielt). Nach Fix 2 diff-merged der ZUSTANDSLOSE Adopt-Fall die
    // .md aber ein (dort ist sie der einzige Träger lokaler Daten) — eine stale
    // .md würde den Remote-Edit zurückrollen.
    //
    // Um hier die REINE Remote-Übernahme zu prüfen, hält die lokale Seite jetzt
    // bereits EIGENEN State (die Basis-Historie, ohne neue lokale Edits). Damit
    // greift der own-Branch von ensureDoc → die .md wird NICHT eingespielt, und
    // der Remote-Edit ist das einzige Delta. Das entspricht der Realität: ein
    // laufendes Qollab-Gerät hat immer eigenen State.
    const vault = makeVaultMock();
    const OLD = 'Zeile 1\nZeile 2\n';
    const NEW = 'Zeile 1\nZeile 2 geändert\n';

    // Gemeinsamer alter Stand als Basis-Historie.
    const base = new CrdtManager();
    base.setContent('note.md', OLD);
    const baseState = base.encodeState('note.md');

    // Lokaler eigener State = Basis-Historie (legacy → kompatibel mit dem Remote).
    vault._files.set(
      '.qollab/note.md.10ca1000.yjs',
      baseState.buffer as ArrayBuffer
    );

    // Remote baut seine Änderung auf dieser geteilten Historie auf.
    const remote = new CrdtManager();
    remote.applyUpdate('note.md', baseState);
    remote.setContent('note.md', NEW);
    vault._files.set(
      '.qollab/note.md.5e307e01.yjs',
      remote.encodeState('note.md').buffer as ArrayBuffer
    );

    // .md steht noch auf dem alten Stand — darf das Ergebnis NICHT beeinflussen,
    // da eigener State existiert (own-Branch spielt die .md nicht ein).
    vault._textFiles.set('note.md', OLD);
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(NEW);
  });

  it('Adopt ohne eigenen State: lokale .md-Zeile geht NICHT verloren (Fix 2)', async () => {
    // Frischer kollaborativer Aufbau: dieses Gerät hat KEINEN eigenen .yjs-State.
    // Es sieht eine fremde Sibling-.yjs (Basis + Remote-Edit) und hält lokal eine
    // .md. Vor Fix 2 adoptierte ensureDoc nur die fremde Basis und der
    // loadAndMerge-Write-Back überschrieb die (nie erfasste) lokale .md → die
    // lokale Zeile ging dauerhaft verloren. Nach Fix 2 wird im zustandslosen
    // Adopt-Fall die .md als Diff eingespielt (sie ist der EINZIGE Träger lokaler
    // Daten).
    //
    // Determinismus: Im Adopt-Fall erzwingt setContent Text-Gleichheit mit der
    // .md — das Ergebnis IST exakt der .md-Text (keine Zeichen-Interleaving-
    // Mehrdeutigkeit). Der Remote-Edit überlebt hier, weil die .md ihn (via
    // Datei-Sync) bereits reflektiert; die distinkte lokale Zeile ist das, was
    // Fix 2 vor dem Verlust rettet.
    const vault = makeVaultMock();
    const base = 'Gemeinsame Zeile\n';

    // Fremde Inkarnation: Basis + Remote-Edit (hängt eine Zeile an).
    const remote = new CrdtManager();
    remote.setContent('note.md', base);
    remote.setContent('note.md', 'Gemeinsame Zeile\nRemote-Zeile\n');
    vault._files.set(
      '.qollab/note.md.5e307e01.yjs',
      remote.encodeState('note.md').buffer as ArrayBuffer
    );

    // Lokale .md: Remote-Zeile (bereits per Datei-Sync da) PLUS eine distinkte
    // lokale Zeile.
    vault._textFiles.set(
      'note.md',
      'Gemeinsame Zeile\nRemote-Zeile\nLokale Zeile\n'
    );

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    // Beide überleben: Remote-Edit UND die lokale Zeile.
    expect(merged).toBe('Gemeinsame Zeile\nRemote-Zeile\nLokale Zeile\n');
  });
});
