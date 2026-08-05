// Fund 40 (Szenariosuche Runde 2) — eine verirrte Hilfsdatei kippt fremden Text
// in eine unbeteiligte Notiz.
//
// SCHADENSWEG: Zu welcher Notiz eine Hilfsdatei gehört, wird AUSSCHLIESSLICH aus
// ihrem Dateipfad rekonstruiert (`filterYjsFiles`, sync-handler.ts:23, und jeder
// Aufrufer über `listYjsInDir`). Eine Gegenprobe gegen den Inhalt gibt es
// nirgends. Liegt die Datei von `gehalt.md` unter dem Dateinamen von
// `einkauf.md`, gilt ihre Historie als Historie von `einkauf.md`; je nach
// Tie-Break wird sie adoptiert oder gewinnt den Wechsel, und `unionMerge` legt
// ihren Text zum Text der unbeteiligten Notiz.
//
// ERGEBNIS DIESER RUNDE: GEPINNTE GRENZE, KEIN FIX. Die Begründung ist gemessen,
// nicht abgewogen:
//
//   1. Das Dateiformat trägt den Note-Pfad NICHT (`state-file.ts`: 4 Byte Magic +
//      16 Byte GUID + Yjs-Update, sonst nichts). Test „Format" unten hält das
//      fest: gleicher Inhalt unter zwei Note-Pfaden ergibt Byte für Byte
//      dieselbe Datei. Eine Gegenprobe wäre also ein FORMAT-ZUSATZ, kein Guard.
//   2. Der Zusatz wäre nicht nur ein Abwärtskompatibilitäts-Bruch (Bestandsdateien
//      tragen das Feld nicht, „ohne Feld ablehnen" entwertet jede vorhandene
//      Historie) — er wäre im LAUFENDEN BETRIEB falsch. Der rename-Handler zieht
//      die Hilfsdateien der ANDEREN Geräte mit um und fasst ihre Bytes dabei nicht
//      an (main.ts:344-363, `adapter.rename`; ein fremdes Sidecar umzuschreiben
//      verbietet die Ein-Schreiber-Regel). Nach jeder Umbenennung stünde in jeder
//      fremden Datei der alte Pfad. Test „Rename" unten misst genau das. Eine
//      harte Prüfung verwürfe dort reihenweise LEBENDE Historie, eine weiche
//      erzeugte nach jeder Umbenennung Fehlalarme in einem Kanal, der ohnehin
//      schon überlastet ist (Ausschlussliste #42).
//   3. Der Code sagt dasselbe von der anderen Seite: Eine Inkarnation lebt
//      ausdrücklich unter mehreren Pfaden (Rename, Adoption) — deshalb ist der
//      Tombstone seit Task 15 an das PAAR (notePath, guid) gebunden statt an die
//      GUID allein (sync-handler.ts:127-136). Ein Pfad IM Zustand widerspräche
//      diesem Modell.
//   4. Der Auslöser verlangt Handarbeit an einer Binärdatei in einem versteckten
//      Ordner. Die realistischere Variante ist die zweite unten: Der Dateiname
//      bleibt beim Kopieren erhalten, es genügt also ein zweiter Vault, in dem
//      zufällig eine Notiz DESSELBEN Pfades liegt.
//
// Was die Tests deshalb halten: die exakte Reichweite des Schadens, und dass er
// nicht stumm ist. Der Meldekanal aus Task 19/C feuert (mit unpassendem
// Wortlaut — es sind nicht zwei Fassungen einer Notiz, sondern zwei Notizen);
// verstummt er, fällt dieser Test.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const G_KLEIN = '00000000000000000000000000000000'; // gewinnt den Tie-Break
const G_GROSS = 'ffffffffffffffffffffffffffffffff'; // verliert

const TEXT_GEHALT = 'Gehaltsverhandlung\nUntergrenze 68k\n';
const TEXT_EINKAUF = 'Einkaufsliste\nMilch\n';

const EINKAUF = 'einkauf.md';
const EIGENE = '.qollab/einkauf.md.10ca1000.yjs';
// Die verirrte Datei: geschrieben vom Gerät `5e307e01` für `gehalt.md`, hier
// unter dem Dateinamen von `einkauf.md`.
const VERIRRT = '.qollab/einkauf.md.5e307e01.yjs';

// Bytes einer Hilfsdatei mit QLB1-Header und dem State eines Docs, der `text`
// trägt. `docKey` ist der Note-Pfad, unter dem der State ENTSTANDEN ist — er
// taucht in den Bytes nirgends auf, genau darum geht es hier.
function sidecarBytes(guid: string, docKey: string, text: string): Uint8Array {
  const m = new CrdtManager();
  m.setContent(docKey, text);
  return encodeStateFile(guid, m.encodeState(docKey));
}

function lege(vault: any, dateiPfad: string, guid: string, docKey: string, text: string): void {
  vault._files.set(dateiPfad, toAB(sidecarBytes(guid, docKey, text)));
}

interface Kanaele {
  unverwandt: string[];
  verworfen: string[];
}

function baue(vault: any): { handler: SyncHandler; kanaele: Kanaele } {
  const kanaele: Kanaele = { unverwandt: [], verworfen: [] };
  const handler = new SyncHandler(
    vault,
    new CrdtManager(),
    '10ca1000',
    undefined,
    undefined,
    undefined,
    undefined,
    (notePath: string) => kanaele.unverwandt.push(notePath),
    (notePath: string, guid: string) => kanaele.verworfen.push(`${notePath}|${guid}`)
  );
  return { handler, kanaele };
}

describe('Fund 40: verirrte Hilfsdatei — gepinnte Grenze', () => {
  // Der Adopt-Zweig: `einkauf.md` hat auf diesem Gerät noch keinen eigenen Stand
  // (frisch installiert, Notiz nie editiert). `ensureDoc` adoptiert, was unter dem
  // Dateinamen liegt — hier die Historie von `gehalt.md`.
  it('Adopt-Zweig: der Text der fremden Notiz landet in der unbeteiligten Notiz', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(EINKAUF, TEXT_EINKAUF);
    lege(vault, VERIRRT, G_KLEIN, 'gehalt.md', TEXT_GEHALT);

    const { handler, kanaele } = baue(vault);
    const merged = await handler.loadAndMerge(EINKAUF);

    // GEPINNTER SCHADEN — das ist keine Zusicherung, sondern eine Messung.
    expect(merged).toBe('Gehaltsverhandlung\nUntergrenze 68k\nEinkaufsliste\nMilch\n');
    // Nicht stumm: der Kanal aus Task 19/C feuert genau einmal.
    expect(kanaele.unverwandt).toEqual([EINKAUF]);
    // Kein Textverlust — die eigene Notiz steht vollständig darin.
    expect(merged).toContain('Milch');
  });

  // Der Tie-Break-Wechsel: `einkauf.md` hat eine lebende eigene Inkarnation, die
  // verirrte Datei trägt die kleinere Kennung und gewinnt. `switchToGuid` baut auf
  // der fremden Historie neu auf und vereinigt den lokalen Stand hinein.
  it('Tie-Break-Wechsel: die kleinere fremde Kennung kippt ihren Text in die lebende Notiz', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(EINKAUF, TEXT_EINKAUF);
    lege(vault, EIGENE, G_GROSS, EINKAUF, TEXT_EINKAUF);
    lege(vault, VERIRRT, G_KLEIN, 'gehalt.md', TEXT_GEHALT);

    const { handler, kanaele } = baue(vault);
    const merged = await handler.loadAndMerge(EINKAUF);

    expect(merged).toBe('Gehaltsverhandlung\nUntergrenze 68k\nEinkaufsliste\nMilch\n');
    expect(kanaele.unverwandt).toEqual([EINKAUF]);
  });

  // Die Gegenrichtung desselben Vergleichs — der Schaden ist ein Münzwurf, keine
  // Gewissheit. Verliert die verirrte Datei den Tie-Break, kippt nichts; gemeldet
  // wird stattdessen eine „zweite Fassung", die es nicht gibt.
  it('Kontrolle: verliert die verirrte Datei den Tie-Break, bleibt die Notiz sauber', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(EINKAUF, TEXT_EINKAUF);
    lege(vault, EIGENE, G_KLEIN, EINKAUF, TEXT_EINKAUF);
    lege(vault, VERIRRT, G_GROSS, 'gehalt.md', TEXT_GEHALT);

    const { handler, kanaele } = baue(vault);
    const merged = await handler.loadAndMerge(EINKAUF);

    expect(merged).toBe(TEXT_EINKAUF);
    expect(kanaele.unverwandt).toEqual([]);
    expect(kanaele.verworfen).toEqual([`${EINKAUF}|${G_GROSS}`]);
  });

  // Die realistischere Variante: NICHT von Hand umbenannt, sondern in den
  // `.qollab`-Ordner eines zweiten Vaults kopiert. Der Dateiname bleibt dabei
  // erhalten — es genügt, dass dort eine ANDERE Notiz unter demselben Pfad liegt
  // (`Untitled.md`, `README.md`, eine Tagesnotiz).
  it('gleicher Pfad, anderer Vault: der Dateiname allein entscheidet', async () => {
    const zweiterVault = makeVaultMock() as any;
    zweiterVault._textFiles.set('notizen/2026-08-02.md', 'Zahnarzt 9 Uhr\n');
    // Aus dem ersten Vault kopiert: dort trug `notizen/2026-08-02.md` einen ganz
    // anderen Text. Dateiname unverändert.
    zweiterVault._files.set(
      '.qollab/notizen/2026-08-02.md.5e307e01.yjs',
      toAB(sidecarBytes(G_KLEIN, 'notizen/2026-08-02.md', 'Umzugskisten packen\n'))
    );

    const { handler } = baue(zweiterVault);
    const merged = await handler.loadAndMerge('notizen/2026-08-02.md');

    expect(merged).toBe('Umzugskisten packen\nZahnarzt 9 Uhr\n');
  });

  // BEGRÜNDUNG 1 der Grenze: Die Datei kann nicht sagen, wohin sie gehört.
  it('Format: die Datei ist restlos Magic + Kennung + Update — kein Platz für den Note-Pfad', () => {
    const m = new CrdtManager();
    m.setContent('gehalt.md', TEXT_GEHALT);
    const update = m.encodeState('gehalt.md');
    const datei = encodeStateFile(G_KLEIN, update);

    // Jedes Byte ist erklärt: 4 Magic ('QLB2') + 4 Integritäts-Hash + 16 GUID +
    // Update. Bliebe irgendwo Platz für einen Note-Pfad, fiele diese Gleichung.
    expect(datei.length).toBe(4 + 4 + 16 + update.length);
    expect([...datei.subarray(0, 4)]).toEqual([0x51, 0x4c, 0x42, 0x32]);
    expect([...datei.subarray(24)]).toEqual([...update]);
    // Der Note-Pfad kommt in den Bytes nicht vor.
    expect(Buffer.from(datei).includes('gehalt.md')).toBe(false);
    // Und das Lesen kennt nur diese zwei Felder. Kommt hier je ein Pfad dazu, ist
    // das ein Format-Zusatz — dann gehört auch die Grenze im README neu bewertet.
    expect(Object.keys(decodeStateFile(datei)).sort()).toEqual(['guid', 'update']);
  });
});

// BEGRÜNDUNG 2 der Grenze: Warum ein Pfad-Feld im Format auch ohne die
// Kompatibilitätsfrage falsch wäre.
describe('Fund 40: warum kein Pfad im Dateiformat', () => {
  function tfile(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.name = path.split('/').pop() ?? path;
    return f;
  }

  async function ladePlugin(vault: VaultMock) {
    const handlers = new Map<string, (...args: any[]) => any>();
    const vaultMitEvents = Object.assign(vault, {
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    });
    const storage = makeLocalStorage();
    const app = {
      vault: vaultMitEvents,
      workspace: {
        on: (event: string, cb: (...args: any[]) => any) => {
          handlers.set('ws:' + event, cb);
          return { __event: 'ws:' + event };
        },
        offref: () => {},
        onLayoutReady: () => {}, // Sweep bewusst nicht starten
      },
      loadLocalStorage: storage.loadLocalStorage,
      saveLocalStorage: storage.saveLocalStorage,
    };
    const plugin = new (CrdtSyncPlugin as any)(app, {});
    await plugin.onload();
    return { plugin, handlers };
  }

  it('Rename: die Hilfsdatei des anderen Geräts zieht Byte für Byte unverändert mit um', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set('alt.md', TEXT_EINKAUF);
    // Fremde Hilfsdatei des Geräts `beef1234` — sie gehört zu `alt.md`.
    const fremdeBytes = sidecarBytes(G_KLEIN, 'alt.md', TEXT_EINKAUF);
    vault._files.set('.qollab/alt.md.beef1234.yjs', toAB(fremdeBytes));

    const { handlers } = await ladePlugin(vault);

    // Obsidian benennt um; `TFile.path` mutiert in place.
    const datei = tfile('alt.md');
    vault._textFiles.delete('alt.md');
    vault._textFiles.set('neu.md', TEXT_EINKAUF);
    datei.path = 'neu.md';
    datei.name = 'neu.md';
    await handlers.get('rename')!(datei, 'alt.md');

    // Die fremde Datei liegt unter dem NEUEN Pfad …
    const umgezogen = vault._files.get('.qollab/neu.md.beef1234.yjs');
    expect(umgezogen).toBeDefined();
    // … und ihre Bytes sind unangetastet. Stünde ein Note-Pfad darin, stünde
    // jetzt `alt.md` in einer Datei, die zu `neu.md` gehört — und eine
    // Gegenprobe gegen den Dateipfad verwürfe eine LEBENDE fremde Historie.
    expect([...new Uint8Array(umgezogen!)]).toEqual([...fremdeBytes]);
    expect(vault._files.has('.qollab/alt.md.beef1234.yjs')).toBe(false);
  });
});
