// Fund 36 — Backup-Rückspielung bei geschlossener App wird lautlos rückgängig
// gemacht.
//
// Ablauf, wie ihn eine Nutzerin herstellt: Obsidian zu, den alten Stand einer
// Notiz aus einem Backup zurückkopieren (Explorer-Copy, ZIP entpacken,
// „vorherige Version wiederherstellen"), Obsidian wieder auf. Beide
// Kopiervorgänge übernehmen den ZEITSTEMPEL der Sicherung — die
// zurückgespielte `.md` ist also älter als die eigene Hilfsdatei, die den
// später getippten Stand trägt.
//
// Der Startup-Sweep fragte an dieser Stelle „ist die Hilfsdatei neuer?"
// (`stat.mtime >= file.stat.mtime`) und schloss aus einem Ja auf „unser
// Snapshot ist aktuell". Für die zurückgespielte Notiz ist das falsch: die
// Datei hat sich sehr wohl geändert, nur eben nach hinten. Die Notiz wurde
// übersprungen, der Doc behielt den neueren Stand — und der nächste
// Fremd-Trigger schrieb ihn über die Datei zurück. Die Rückspielung war weg,
// ohne eine einzige Meldung.
//
// Das unterscheidende Kriterium steht bereits im Fortschrittsmerker (Task
// 19/B): er hält fest, wie die `.md` aussah, als der Snapshot zuletzt
// NACHWEISLICH aktuell war. Ist sie seither anders geworden, ohne dass ihr
// Zeitstempel vorangeschritten ist, taugt der Zeitstempel-Vergleich nicht mehr
// als Aussage über den Snapshot. Der Vergleich kostet zwei Zahlen aus dem
// Speicher — kein Dateizugriff, also auch kein Rückbau des Sweep-Gewinns (die
// Treffer-Abkürzung darüber bleibt unangetastet).
//
// ABGRENZUNG zu `git-rollback.test.ts` (dort steht die Warnung, die für diese
// Änderung geschrieben wurde): Der dortige Fehl-Fix ERKENNT einen Rollback und
// UNTERDRÜCKT daraufhin den lokalen Diff — das frisst die legitime
// Offline-Löschung (Fall G) mit. Hier passiert das Gegenteil: es wird nichts
// unterdrückt, sondern eine bisher übersprungene Notiz überhaupt erst
// angesehen. Ein G)-Analogon kann daran nicht scheitern, weil kein Fall
// existiert, in dem „nicht ansehen" das gewünschte Ergebnis wäre.
//
// BEWUSST IN KAUF GENOMMEN: Wird die `.md` von etwas anderem als einer
// gewollten Rückspielung zurückdatiert, gewinnt ihr Inhalt gegen den Doc — wie
// im Fall I) der git-rollback-Suite, nur mit umgekehrtem Zeitstempel. Das ist
// dieselbe Zusage, die der Sweep für jede geänderte `.md` ohnehin gibt.

import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  tippeMd,
  type VaultMock,
  type LocalStorageMock,
} from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'aaaa1111';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.bbbb2222.yjs`;

const V1 = 'Zeile A\nZeile B\n';
const V2 = 'Zeile A\nZeile B\nSPAETER ERGAENZT\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

// Ein GERÄT über den echten onload-Pfad. `store` (Electron-Profil) und `shared`
// (data.json) überleben den Neustart, das Plugin-Objekt nicht — genau die
// Trennung, an der der Sweep-Merker hängt.
async function bootDevice(
  vault: VaultMock,
  store: LocalStorageMock,
  shared: { value: any }
): Promise<{ plugin: any; handlers: Map<string, (...args: any[]) => any> }> {
  store.saveLocalStorage('qollab-client-id', OWN_ID);
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const plugin: any = new (CrdtSyncPlugin as any)(
    {
      vault: vaultWithEvents,
      workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
      loadLocalStorage: store.loadLocalStorage,
      saveLocalStorage: store.saveLocalStorage,
    },
    {}
  );
  plugin.loadData = async () => shared.value;
  plugin.saveData = async (d: any) => {
    shared.value = JSON.parse(JSON.stringify(d));
  };
  await plugin.onload();
  return { plugin, handlers };
}

async function tippen(
  vault: VaultMock,
  handlers: Map<string, (...args: any[]) => any>,
  text: string,
  mtime: number
): Promise<void> {
  // Prozessintern geschrieben — genau das, was der Name sagt: die Nutzerin tippt.
  // Der Zeitstempel wird danach gesetzt, weil `tippeMd` selbst einen vergibt.
  await tippeMd(vault, NOTE, text);
  vault._mdMtimes.set(NOTE, mtime);
  await handlers.get('modify')!(tfile(NOTE));
}

function sidecarInhalt(bytes: ArrayBuffer): string {
  const mgr = new CrdtManager();
  mgr.applyUpdate(NOTE, decodeStateFile(new Uint8Array(bytes)).update);
  return mgr.getContent(NOTE);
}

// Sitzung 1 (die Notiz entsteht und wächst) + Sitzung 2 (Neustart, der Sweep
// stellt „Snapshot aktuell" fest und schreibt den Merker). Danach ist der
// Zustand derselbe wie an jedem normalen Abend: `.md` und Hilfsdatei tragen V2,
// der Merker kennt die `.md` mit ihrem aktuellen Zeitstempel.
async function bisV2(vault: VaultMock, store: LocalStorageMock, shared: { value: any }) {
  vault._textFiles.set(NOTE, V1);
  vault._mdMtimes.set(NOTE, 10);
  let d = await bootDevice(vault, store, shared);
  await tippen(vault, d.handlers, V1, 10);
  await tippen(vault, d.handlers, V2, 20);
  d.plugin.onunload();

  // Der letzte Write des Plugins war die Hilfsdatei — sie ist neuer als die .md.
  vault._mtimes.set(OWN_PATH, 30);

  d = await bootDevice(vault, store, shared);
  await d.plugin.runStartupSweep();
  d.plugin.onunload();
}

// Die Rückspielung selbst: alter Inhalt UND alter Zeitstempel, Hilfsdatei
// unberührt (sie liegt im Dot-Ordner und ist in keinem Notiz-Backup).
function backupZurueckspielen(vault: VaultMock): void {
  vault._textFiles.set(NOTE, V1);
  vault._mdMtimes.set(NOTE, 10);
}

beforeEach(() => {
  (Notice as any).messages = [];
});

describe('Fund 36: zurückgespieltes Backup bei geschlossener App', () => {
  it('der Merker weiß nach dem zweiten Start, wie die .md aussah', async () => {
    const vault = makeVaultMock();
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await bisV2(vault, store, shared);

    // Vorbedingung des Fixes: ohne Merker-Eintrag gibt es keine Erinnerung, an
    // der sich eine Rückdatierung messen liesse.
    const merker = store.loadLocalStorage('qollab-sweep-cursor');
    expect(merker[NOTE]).toEqual([20, V2.length]);
  });

  it('der Sweep erfasst den zurückgespielten Stand', async () => {
    const vault = makeVaultMock();
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await bisV2(vault, store, shared);

    backupZurueckspielen(vault);

    const d = await bootDevice(vault, store, shared);
    await d.plugin.runStartupSweep();

    // Was in der eigenen Hilfsdatei steht, ist das, was zum Peer wandert.
    expect(sidecarInhalt(vault._files.get(OWN_PATH)!)).toBe(V1);
  });

  it('die Rückspielung überlebt den nächsten Fremd-Trigger', async () => {
    const vault = makeVaultMock();
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await bisV2(vault, store, shared);

    // Ein zweites Gerät kennt unsere Kette und hat denselben Stand — die
    // gewöhnliche Zwei-Geräte-Lage. Seine Datei ist beim Start neu für den
    // Watcher und löst den Merge aus.
    vault._files.set(PEER_PATH, vault._files.get(OWN_PATH)!.slice(0));
    vault._mtimes.set(PEER_PATH, 31);

    backupZurueckspielen(vault);

    const d = await bootDevice(vault, store, shared);
    await d.plugin.runStartupSweep();
    await d.plugin.sidecarWatcher.poll();

    // DER SCHADEN: ohne den Fix steht hier wieder V2 — die Rückspielung ist
    // lautlos rückgängig gemacht.
    expect(vault._textFiles.get(NOTE)).toBe(V1);
  });

  it('eine vorwärts datierte .md mit aktuellem Snapshot wird weiter ohne Lesen übersprungen', async () => {
    const vault = makeVaultMock();
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await bisV2(vault, store, shared);

    // Der Regelfall, den der Sweep billig halten muss: das Plugin hat die .md
    // selbst geschrieben (Write-Back) und danach die Hilfsdatei. Der Merker
    // passt nicht mehr, der Zeitstempel ist aber VORWÄRTS gegangen — hier bleibt
    // der Zeitstempel-Vergleich die richtige und die billige Antwort.
    vault._textFiles.set(NOTE, V2 + 'aus dem Write-Back\n');
    vault._mdMtimes.set(NOTE, 40);
    vault._mtimes.set(OWN_PATH, 41);

    const d = await bootDevice(vault, store, shared);
    let gelesen = 0;
    const orig = vault.read;
    vault.read = async (f: { path: string }) => {
      if (f.path === NOTE) gelesen++;
      return orig(f);
    };
    await d.plugin.runStartupSweep();
    vault.read = orig;

    expect(gelesen).toBe(0);
    expect(store.loadLocalStorage('qollab-sweep-cursor')[NOTE]).toEqual([
      40,
      (V2 + 'aus dem Write-Back\n').length,
    ]);
  });
});

// Fund 37 — Backup-Rückspielung bei LAUFENDER App meldet eine
// Geräte-ID-Kollision, die es nicht gibt.
//
// Was der Wächter sieht: Die eigene Hilfsdatei trägt plötzlich andere Bytes,
// obwohl dieses Gerät sie nicht geschrieben hat. Was er daraus schloss:
// „zweites Gerät mit derselben Geräte-ID". Das ist eine von mehreren möglichen
// Ursachen — die zurückgespielte Sicherung ist eine andere, und sie ist die
// wahrscheinlichere, weil die echte Kollision seit Task 14 eine geerbte
// `data.json` voraussetzt.
//
// WARUM DIE ERKENNUNG NICHT SCHÄRFER WERDEN KANN: Um „ältere Fassung unserer
// eigenen Kette" von „Beitrag eines fremden Geräts" zu trennen, müsste der
// Inhalt der Datei gegen den eigenen Doc gehalten werden. Genau der fehlt im
// Regelfall: Ein Doc entsteht erst, wenn die Notiz in dieser Sitzung angefasst
// oder vom Sweep erfasst wurde; für jede andere Notiz stammt die Signatur aus
// der ersten Sichtung des Wächters, ganz ohne Doc (`isForeignSidecarWrite`,
// Ausschluss 4). Ihn aus der zurückgespielten Datei aufzubauen wäre zirkulär.
// Der Zeitstempel scheidet ebenfalls aus: Über Gerätegrenzen ist er nicht
// belastbar (bekannte Grenzen #3 und #27), ein Peer-Write kann älter aussehen
// als der eigene.
//
// Und die Neu-Provisionierung selbst ist in BEIDEN Fällen richtig: Ein
// Schreiber, der nicht wir sind, hat unseren Pfad angefasst — wir treten zur
// Seite. Falsch war allein die BEHAUPTUNG über die Ursache. Der Fix ist deshalb
// der Wortlaut, in der Meldung wie im README (dort gepinnt in
// `docs-consistency.test.ts`).

describe('Fund 37: zurückgespielte Sicherung bei laufender App', () => {
  it('meldet keine Kollision als Tatsache, wenn es kein zweites Gerät gibt', async () => {
    const vault = makeVaultMock();
    const store = makeLocalStorage();
    const shared = { value: null as any };

    vault._textFiles.set(NOTE, V1);
    vault._mdMtimes.set(NOTE, 10);
    const d = await bootDevice(vault, store, shared);
    await tippen(vault, d.handlers, V1, 10);
    // Der Stand, der später in der Sicherung liegt.
    const sicherung = vault._files.get(OWN_PATH)!.slice(0);
    await tippen(vault, d.handlers, V2, 20);
    await d.plugin.sidecarWatcher.poll(); // Baseline des Wächters

    // Es gibt genau ein Gerät und genau eine Hilfsdatei — die eigene.
    expect([...vault._files.keys()]).toEqual([OWN_PATH]);
    (Notice as any).messages = [];

    // Die Nutzerin spielt bei laufender App den Ordner aus der Sicherung zurück.
    vault._files.set(OWN_PATH, sicherung);
    vault._mtimes.set(OWN_PATH, (vault._mtimes.get(OWN_PATH) ?? 0) + 100);
    await d.plugin.sidecarWatcher.poll();

    const meldungen = (Notice as any).messages.filter((m: string) => /Geräte-ID/.test(m));
    expect(meldungen).toHaveLength(1);
    // Kein zweites Gerät im Vault — die Meldung darf keines behaupten.
    expect(meldungen[0]).toMatch(/von außen verändert/);
    expect(meldungen[0]).toMatch(/Sicherung/);

    // Das Zur-Seite-Treten bleibt: es ist in beiden Ursachen die richtige Antwort.
    expect(d.plugin.clientId).not.toBe(OWN_ID);
    // Und der Notiztext ist unberührt — die alte Fassung ist ein Teilstand
    // unserer eigenen Kette und rollt nichts zurück.
    expect(vault._textFiles.get(NOTE)).toBe(V2);
  });
});
