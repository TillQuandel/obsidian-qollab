// Tombstone-Scope-Tests (Task 15)
//
// Verifiziert, dass Tombstones nach Fix A/B per (notePath, guid)-Paar gelten statt
// GUID-global. Zwei Befunde aus audit-2026-07-27.json:
//
//   Befund 1/2: Sync-vermittelter Rename: delete(alt.md) setzt Tombstone auf G,
//               danach trifft Gerät-A-Sidecar fuer neu.md (GUID G) ein. Heute wird
//               sie geloescht (GUID-globaler Tombstone). Nach Fix: bleibt erhalten.
//
//   Befund 5:   Dieselbe GUID G an zwei Pfaden: pfad1 wird getombstont, eigene
//               Sidecar von pfad2 (GUID G) wird faelschlich geloescht. Nach Fix: bleibt.
//
// Jeder Test laeuft auf Plugin-Ebene, damit die ECHTE tombstoneStore-Implementierung
// (main.ts) verwendet wird — das ist der Schluessel zum RED/GREEN-Verhalten:
//   VOR Fix A/B: tombstoneStore.add(G) schreibt {G: timestamp} (global).
//                decodeSiblings prueft has(G) → findet G → Sidecar geloescht → RED.
//   NACH Fix A/B: tombstoneStore.add(G, path) schreibt {'path\0G': timestamp}.
//                decodeSiblings prueft has(G, otherPath) → kein Treffer → GREEN.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

// Bekannte GUID fuer alle Tests (reproduzierbar).
const G = 'ee'.repeat(16);
const A_ID = 'deadbeef'; // Fremdes Geraet A

// Hilfsfunktion: Sidecar-ArrayBuffer mit GUID und beliebigem Text.
function buildSidecar(guid: string, text: string, docKey = 'note.md'): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(docKey, text);
  const state = mgr.encodeState(docKey);
  const buf = encodeStateFile(guid, state);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

// Minimaler Plugin-Bootstrep — analog zu main-handlers.test.ts loadPlugin,
// ohne onLayoutReady (kein automatischer Sweep).
async function bootPlugin(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const storage = makeLocalStorage();
  const app = {
    vault: {
      ...vault,
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
    },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

// --------------------------------------------------------------------------
// Test 1: Sync-Rename-Critical (Befund 1+2)
//
// Szenario: Geraet B hat alt.md und neu.md. Sync liefert delete(alt.md) →
// Tombstone auf G. Danach trifft Geraet-A-Sidecar fuer neu.md (GUID G) ein.
//
// RED (vor Fix A/B): tombstoneStore.add(G) → {G: timestamp} (global).
//   decodeSiblings fuer neu.md: has(G) → true → Geraet-A-Sidecar wird geloescht.
//   Assertion SCHEITERT.
//
// GREEN (nach Fix A/B): tombstoneStore.add(G, 'alt.md') → {'alt.md\0G': timestamp}.
//   decodeSiblings fuer neu.md: has(G, 'neu.md') → 'neu.md\0G' nicht gefunden → false
//   → Geraet-A-Sidecar bleibt. Assertion BESTEHT.
// --------------------------------------------------------------------------
describe('Test 1 - Sync-Rename: Geraet-A-Sidecar unter neu.md ueberlebt delete(alt.md)', () => {
  it('Geraet-A-Sidecar bleibt nach Tombstone auf alt.md und loadAndMerge(neu.md) erhalten', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    // alt.md existiert mit GUID G (eigene Sidecar, damit currentGuid G liefert).
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, 'alt-inhalt', 'alt.md'));
    vault._textFiles.set('alt.md', 'alt-inhalt');

    // neu.md existiert (nach Rename).
    vault._textFiles.set('neu.md', 'alt-inhalt');

    // Geraet-A-Sidecar fuer neu.md mit GUID G (Inkarnation laeuft auf neu.md weiter).
    const A_SIDECAR = `.qollab/neu.md.${A_ID}.yjs`;
    vault._files.set(A_SIDECAR, buildSidecar(G, 'a-inhalt', 'neu.md'));

    // Sync-zugestelltes delete(alt.md): Tombstone auf G wird gesetzt.
    await handlers.get('delete')!(tfile('alt.md'));

    // Geraet-A-Sidecar fuer neu.md darf NICHT durch den Tombstone geloescht werden.
    await plugin.onRemoteYjsUpdate('neu.md');

    expect(vault._files.has(A_SIDECAR)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Test 2: Eigene Sidecar ueberlebt (Befund 5)
//
// Szenario: Geraet B hat pfad1.md und pfad2.md, beide mit GUID G (Adopt-Szenario).
// pfad1.md wird geloescht → Tombstone auf G. loadAndMerge(pfad2.md) darf die
// eigene Sidecar von pfad2 NICHT loeschen.
//
// Technischer Hinweis: saveState re-erstellt die Datei nach der unerwuenschten
// Loeschung durch decodeSiblings. Daher pruefen wir nicht nur File-Existenz
// am Ende, sondern ob adapter.remove() auf die eigene Sidecar aufgerufen wurde.
//
// RED (vor Fix A/B): tombstoneStore.add(G) → {G: timestamp} (global).
//   decodeSiblings fuer pfad2: has(G) → true → removeSidecar() auf eigene Sidecar.
//   Spy faengt den Remove-Aufruf → removedPfad2Own = true → Assertion SCHEITERT.
//
// GREEN (nach Fix A/B): tombstoneStore.add(G, 'pfad1.md') → {'pfad1.md\0G': ...}.
//   decodeSiblings fuer pfad2: has(G, 'pfad2.md') → 'pfad2.md\0G' nicht gefunden → false
//   → kein removeSidecar auf eigene Sidecar → removedPfad2Own = false → Assertion BESTEHT.
// --------------------------------------------------------------------------
describe('Test 2 - Eigene Sidecar ueberlebt: Tombstone auf pfad1 greift nicht auf pfad2', () => {
  it('eigene .yjs von pfad2.md wird nicht von decodeSiblings geloescht (remove-Spy)', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    const PFAD1 = 'pfad1.md';
    const PFAD2 = 'pfad2.md';
    const OWN_SIDECAR_PFAD2 = `.qollab/${PFAD2}.${OWN_ID}.yjs`;
    // Review I-1: Die FREMDE Sidecar unter pfad2 ist die Fix-A-Sonde. Der
    // Fix-B-Guard schuetzt ausschliesslich stateFilePath(pfad2) — auf eine fremde
    // Datei wirkt er nicht. Faellt Fix A weg (GUID-globaler Schluessel), trifft der
    // Tombstone von pfad1 auch hier und loescht sie.
    const FOREIGN_SIDECAR_PFAD2 = `.qollab/${PFAD2}.${A_ID}.yjs`;

    // Beide Pfade tragen GUID G (Adopt-Szenario: gleiche Inkarnation, zwei Pfade).
    vault._files.set(
      `.qollab/${PFAD1}.${OWN_ID}.yjs`,
      buildSidecar(G, 'pfad1-inhalt', PFAD1)
    );
    vault._files.set(OWN_SIDECAR_PFAD2, buildSidecar(G, 'pfad2-inhalt', PFAD2));
    vault._files.set(FOREIGN_SIDECAR_PFAD2, buildSidecar(G, 'fremd-pfad2', PFAD2));
    vault._textFiles.set(PFAD1, 'pfad1-inhalt');
    vault._textFiles.set(PFAD2, 'pfad2-inhalt');

    // Delete pfad1 → Tombstone auf G (global vor Fix, pfad-spezifisch nach Fix).
    await handlers.get('delete')!(tfile(PFAD1));

    // Remove-Spy: prueft ob eigene Sidecar von pfad2 durch decodeSiblings geloescht wird.
    // (saveState re-erstellt die Datei danach — Datei-Existenz am Ende ist kein Beleg.)
    let removedPfad2Own = false;
    const origRemove = vault.adapter.remove;
    vault.adapter.remove = async (path: string) => {
      if (path === OWN_SIDECAR_PFAD2) removedPfad2Own = true;
      return origRemove(path);
    };

    // loadAndMerge fuer pfad2 darf eigene Sidecar NICHT via Tombstone loeschen.
    await plugin.onRemoteYjsUpdate(PFAD2);

    // Fix-A-Sonde: pfad-spezifischer Tombstone (pfad1) greift nicht auf pfad2,
    // die fremde Sidecar bleibt liegen. Ohne Fix A wird sie geloescht.
    expect(vault._files.has(FOREIGN_SIDECAR_PFAD2)).toBe(true);
    // Fix-B-Sonde: die eigene Sidecar wird ueber den Tombstone-Zweig nie geloescht.
    expect(removedPfad2Own).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Test 6 (Review C-1): rename VOR dem delete — der Tombstone muss die ganze
// Pfad-Historie der Inkarnation decken, nicht nur den zuletzt bewohnten Pfad.
//
// Szenario (nur Standard-Handler, Standard-Betriebsmodus Datei-Sync):
//   1. alt.md lebt mit Inkarnation G, eigene Sidecar vorhanden.
//   2. Nutzer benennt um: alt.md → neu.md (Sidecars ziehen mit, KEIN Tombstone).
//   3. Nutzer loescht neu.md → Tombstone.
//   4. Geraet A war offline und liefert verspaetet .qollab/alt.md.<A>.yjs (GUID G).
//   5. Nutzer legt eine neue, inhaltlich unbeteiligte Note alt.md an.
//
// RED (vor C-1-Fix): Tombstone steht nur auf (neu.md, G). Unter alt.md findet
//   decodeSiblings keinen Tombstone → ensureDoc adoptiert die Fremd-Inkarnation
//   und unionMerge schiebt den Inhalt der GELOESCHTEN Note in die neue alt.md.
//   Das ist eine Regression gegen master (dort griff der GUID-globale Tombstone).
//
// GREEN (nach C-1-Fix): der delete-Handler tombstont alle Pfade, unter denen die
//   Inkarnation auf DIESEM Geraet gelebt hat → (neu.md, G) UND (alt.md, G).
// --------------------------------------------------------------------------
describe('Test 6 - C-1: rename dann delete, Fremd-Sidecar unter dem ALTEN Pfad', () => {
  it('die neue, unbeteiligte alt.md bleibt unkontaminiert und die Leiche wird geraeumt', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    const GEHEIM = 'GEHEIM alter inhalt\n';
    const NEUTRAL = 'brandneu und unbeteiligt\n';
    const A_SIDECAR_ALT = `.qollab/alt.md.${A_ID}.yjs`;

    // 1. alt.md lebt mit Inkarnation G.
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, GEHEIM, 'alt.md'));
    vault._textFiles.set('alt.md', GEHEIM);

    // 2. Rename alt.md → neu.md.
    vault._textFiles.delete('alt.md');
    vault._textFiles.set('neu.md', GEHEIM);
    await handlers.get('rename')!(tfile('neu.md'), 'alt.md');

    // Review F-3: Der Rename selbst tombstont NICHT. Das ist die im Kommentar an
    // `priorPaths` (sync-handler.ts) ausdruecklich verworfene Alternative — sie
    // wuerde alt.md fuer eine LEBENDE Inkarnation entwerten. Ohne diese Zeile
    // bewacht kein Test die Entscheidung.
    expect(Object.keys(plugin.settings.tombstones)).toEqual([]);

    // 3. Delete neu.md.
    vault._textFiles.delete('neu.md');
    await handlers.get('delete')!(tfile('neu.md'));

    // 4. Verspaetete Fremd-Sidecar von Geraet A unter dem ALTEN Pfad, GUID G.
    vault._files.set(A_SIDECAR_ALT, buildSidecar(G, GEHEIM, 'alt.md'));

    // 5. Neue, inhaltlich unbeteiligte Note unter dem alten Namen.
    vault._textFiles.set('alt.md', NEUTRAL);

    await plugin.onRemoteYjsUpdate('alt.md');

    expect(vault._textFiles.get('alt.md')).toBe(NEUTRAL);
    expect(vault._files.has(A_SIDECAR_ALT)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Test 7 (Review C-1, Gegenprobe): Der C-1-Fix darf Fix A nicht zuruecknehmen.
//
// Zweitgeraet-Sicht auf denselben Rename: B hat NIE einen Rename gesehen, der
// Datei-Sync stellt ihn als delete(alt.md) + create(neu.md) zu. Die Pfad-Historie
// dieser Inkarnation ist auf B also LEER — der Tombstone darf ausschliesslich auf
// alt.md landen, sonst entwertet er neu.md fuer eine LEBENDE Inkarnation und
// reisst genau die Luecke wieder auf, die Fix A geschlossen hat.
//
// Runde 3 (Review F-3): auf den tragenden Teil reduziert. Gestrichen sind
//   - `not.toContain('neu.md\0G')` und `toHaveLength(1)` als Einzelaussagen:
//     im Setup existiert kein Rename, der String 'neu.md' ist dem Plugin zum
//     Delete-Zeitpunkt unbekannt — keine plausible Fehlimplementierung von
//     incarnationPaths kann ihn erzeugen;
//   - der zweite Abschnitt (Fremd-Sidecar unter neu.md ueberlebt
//     onRemoteYjsUpdate): identische Konstellation und Aussage wie Test 1.
// Was bleibt, ist echt diskriminierend: EIN exakter Schluessel-Satz. Er faellt
// bei GUID-globalem Schluessel (Fix A) und bei jeder Ausweitung des Tombstones
// auf zusaetzliche Pfade oder GUIDs.
// --------------------------------------------------------------------------
describe('Test 7 - C-1-Grenze: ohne lokalen Rename bleibt der Tombstone auf dem geloeschten Pfad', () => {
  it('delete(alt.md) tombstont exakt (alt.md, G) und sonst nichts', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    // B kennt alt.md mit GUID G (eigene Sidecar) und hat neu.md nie umbenannt.
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, 'alt-inhalt', 'alt.md'));
    vault._textFiles.set('alt.md', 'alt-inhalt');

    // Sync-zugestelltes delete(alt.md).
    await handlers.get('delete')!(tfile('alt.md'));

    expect(Object.keys(plugin.settings.tombstones)).toEqual([`alt.md\0${G}`]);
  });
});

// --------------------------------------------------------------------------
// Test 8 (Review F-1): Die Note ist NUR durch eine FREMDE Sidecar bekannt.
//
// Sie kam per Datei-Sync an (.md + Sidecar des anderen Geraets) und wurde hier
// nie geoeffnet oder editiert — es gibt also weder einen Eintrag in `guids` noch
// eine eigene Sidecar. `currentGuid` liefert dann null und der delete-Handler
// setzt GAR KEINEN Tombstone, auch nicht fuer den aktuellen Pfad.
//
// Kein Task-15-Regress: `currentGuid` ist gegenueber master unveraendert, v0.4.0
// verhaelt sich identisch. Es gehoert aber in die Delete-/Tombstone-Semantik,
// die Task 15 aufraeumt.
//
// RED (vor F-1): keine GUID → kein Tombstone. Die verspaetete Fremd-Sidecar
//   trifft spaeter auf eine gleichnamige NEUE Note, ensureDoc adoptiert die tote
//   Inkarnation, unionMerge schiebt ihren Inhalt hinein.
// GREEN (nach F-1): der Delete-Pfad faellt auf die dekodierbaren GUIDs der
//   Fremd-Siblings zurueck → (note.md, G) ist getombstont.
// --------------------------------------------------------------------------
describe('Test 8 - F-1: Note nur durch fremde Sidecar bekannt', () => {
  it('delete tombstont die fremde Inkarnation; die neue gleichnamige Note bleibt sauber', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);

    const GEHEIM = 'GEHEIM alter inhalt\n';
    const NEUTRAL = 'brandneu und unbeteiligt\n';
    const A_SIDECAR = `.qollab/note.md.${A_ID}.yjs`;

    // 1. Per Sync angekommen: .md + FREMDE Sidecar. Keine eigene Sidecar, kein
    //    Doc, kein guids-Eintrag — die Note wurde hier nie angefasst.
    vault._textFiles.set('note.md', GEHEIM);
    vault._files.set(A_SIDECAR, buildSidecar(G, GEHEIM, 'note.md'));

    // 2. Nutzer loescht note.md.
    vault._textFiles.delete('note.md');
    await handlers.get('delete')!(tfile('note.md'));

    expect(Object.keys(plugin.settings.tombstones)).toEqual([`note.md\0${G}`]);

    // 3. Geraet A war offline und liefert die Sidecar der toten Inkarnation
    //    verspaetet nach.
    vault._files.set(A_SIDECAR, buildSidecar(G, GEHEIM, 'note.md'));

    // 4. Nutzer legt unter demselben Namen eine neue, unbeteiligte Note an.
    vault._textFiles.set('note.md', NEUTRAL);

    await plugin.onRemoteYjsUpdate('note.md');

    expect(vault._textFiles.get('note.md')).toBe(NEUTRAL);
    expect(vault._files.has(A_SIDECAR)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Test 9 (Review F-1, Guard): Ein IO-Fehler ist NICHT „keine GUID".
//
// Beide Faelle sind vor UND nach dem Fix gruen — sie sind keine RED-Tests,
// sondern Waechter ueber der neuen Fallback-Logik. Ihr Wert steht in der
// Mutationsprobe: laesst man den Lesefehler durchrutschen (`continue` statt
// Abbruch), entstehen Tombstones auf Halbwissen und beide Tests fallen.
//
// Regel: im Zweifel KEIN Tombstone. Das ist exakt das Vorverhalten (Task-12-
// Kommentar an `currentGuid`) — ein transienter EBUSY darf keine Inkarnation
// beerdigen, die vielleicht noch lebt.
// --------------------------------------------------------------------------
describe('Test 9 - F-1-Guard: unlesbare Sidecar erzeugt keinen Tombstone', () => {
  const G2 = 'cc'.repeat(16);
  const A2_ID = 'beefcafe';

  it('unlesbares Fremd-Sibling bricht ab, obwohl ein anderes eine GUID liefert', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);

    const READABLE = `.qollab/note.md.${A_ID}.yjs`;
    const BUSY = `.qollab/note.md.${A2_ID}.yjs`;
    vault._textFiles.set('note.md', 'inhalt\n');
    vault._files.set(READABLE, buildSidecar(G, 'inhalt\n', 'note.md'));
    vault._files.set(BUSY, buildSidecar(G2, 'inhalt\n', 'note.md'));

    const origRead = vault.adapter.readBinary;
    vault.adapter.readBinary = async (p: string) => {
      if (p === BUSY) throw new Error('EBUSY: resource busy or locked');
      return origRead(p);
    };

    vault._textFiles.delete('note.md');
    await handlers.get('delete')!(tfile('note.md'));

    expect(plugin.settings.tombstones).toEqual({});
  });

  it('unlesbare EIGENE Sidecar faellt nicht auf die Fremd-Siblings durch', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    const OWN = `.qollab/note.md.${OWN_ID}.yjs`;
    const FOREIGN = `.qollab/note.md.${A_ID}.yjs`;
    vault._textFiles.set('note.md', 'inhalt\n');
    vault._files.set(OWN, buildSidecar(G2, 'inhalt\n', 'note.md'));
    vault._files.set(FOREIGN, buildSidecar(G, 'inhalt\n', 'note.md'));

    const origRead = vault.adapter.readBinary;
    vault.adapter.readBinary = async (p: string) => {
      if (p === OWN) throw new Error('EBUSY: resource busy or locked');
      return origRead(p);
    };

    vault._textFiles.delete('note.md');
    await handlers.get('delete')!(tfile('note.md'));

    expect(plugin.settings.tombstones).toEqual({});
  });
});

// --------------------------------------------------------------------------
// Test 10 (Review F-2): `switchToGuid` tauscht die Inkarnation unter einem Pfad
// aus — die Pfad-Historie gehoert danach zur AUFGEGEBENEN Inkarnation.
//
// Szenario: alt.md (eigene Inkarnation G_BIG) wird nach neu.md umbenannt →
// priorPaths['neu.md'] = ['alt.md']. Unter neu.md gewinnt danach die kleinere
// fremde GUID W den Tie-Break, switchToGuid wechselt darauf. W hat unter alt.md
// nie gelebt.
//
// RED (vor F-2): delete(neu.md) schreibt (neu.md, W) UND (alt.md, W) — ein
//   Fix-A-Falsch-Positiv genau der Klasse, die Task 15 beseitigen wollte.
// GREEN (nach F-2): switchToGuid leert priorPaths['neu.md'] → nur (neu.md, W).
// --------------------------------------------------------------------------
describe('Test 10 - F-2: switchToGuid verwirft die Pfad-Historie der aufgegebenen Inkarnation', () => {
  it('nach dem Inkarnations-Wechsel tombstont delete nur noch den aktuellen Pfad', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    const G_BIG = 'ff'.repeat(16);
    const W = 'aa'.repeat(16); // kleiner → gewinnt den Tie-Break

    // 1. alt.md mit eigener Inkarnation G_BIG.
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G_BIG, 'alt-inhalt\n', 'alt.md'));
    vault._textFiles.set('alt.md', 'alt-inhalt\n');

    // 2. Rename alt.md → neu.md (Historie: neu.md ← alt.md).
    vault._textFiles.delete('alt.md');
    vault._textFiles.set('neu.md', 'alt-inhalt\n');
    await handlers.get('rename')!(tfile('neu.md'), 'alt.md');

    // 3. Fremde Sidecar mit kleinerer GUID unter neu.md → switchToGuid(W).
    vault._files.set(`.qollab/neu.md.${A_ID}.yjs`, buildSidecar(W, 'fremd-inhalt\n', 'neu.md'));
    await plugin.onRemoteYjsUpdate('neu.md');

    // 4. Delete neu.md.
    vault._textFiles.delete('neu.md');
    await handlers.get('delete')!(tfile('neu.md'));

    expect(Object.keys(plugin.settings.tombstones)).toEqual([`neu.md\0${W}`]);
  });
});

// --------------------------------------------------------------------------
// Test 11 (Review F-4): Ein Delete schreibt data.json genau EINMAL, egal wie
// viele (Pfad, GUID)-Paare dabei getombstont werden.
//
// RED (vor F-4): der delete-Handler ruft `tombstoneStore.add` pro Pfad, jedes
//   `add` ein volles `saveSettings()` → `saveData` → kompletter data.json-Write.
// GREEN (nach F-4): Tombstones werden in-memory gesammelt, ein Write am Ende.
// --------------------------------------------------------------------------
describe('Test 11 - F-4: ein data.json-Write pro Delete', () => {
  it('zwei Tombstones (aktueller Pfad + Historie) kosten genau ein saveData', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, 'inhalt\n', 'alt.md'));
    vault._textFiles.set('alt.md', 'inhalt\n');

    vault._textFiles.delete('alt.md');
    vault._textFiles.set('neu.md', 'inhalt\n');
    await handlers.get('rename')!(tfile('neu.md'), 'alt.md');

    let saves = 0;
    const origSave = plugin.saveData.bind(plugin);
    plugin.saveData = async (data: unknown) => {
      saves++;
      return origSave(data);
    };

    vault._textFiles.delete('neu.md');
    await handlers.get('delete')!(tfile('neu.md'));

    // Beide Pfade der Inkarnation sind getombstont …
    expect(Object.keys(plugin.settings.tombstones).sort()).toEqual(
      [`alt.md\0${G}`, `neu.md\0${G}`].sort()
    );
    // … aber data.json wurde nur einmal geschrieben.
    expect(saves).toBe(1);
  });
});
