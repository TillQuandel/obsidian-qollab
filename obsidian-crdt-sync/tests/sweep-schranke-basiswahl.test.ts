// DIE BASISWAHL DER SWEEP-SCHRANKE — unter Test gestellt.
//
// Ausgangslage: Der Kandidat `basis-signatur` laesst die Suite mit 548/548 gruen.
// Das belegt, dass der Pfad nichts bricht — NICHT, dass die Basiswahl geprueft
// wird. Gemessen (Aktivitaetsprobe `helpers/schranke-probe.ts`, Lauf mit
// `QOLLAB_SWEEP_SCHRANKE=basis-signatur`): das Praedikat `fremdErklaert` wurde in
// 17 der 548 Tests ueberhaupt AUFGERUFEN und lieferte in **null** davon einen
// Befund. Die Basiswahl war damit in keinem einzigen Testlauf aktiv; die
// Regressionsschranke fuer diesen Kandidaten war blind.
//
// Diese Datei schliesst die Luecke. Jede Lage laeuft in BEIDEN Schalterstaenden
// und pinnt die Differenz — ein Test, der in beiden Staenden dasselbe gruen
// meldet, prueft die Schranke nicht. Nach dieser Datei feuert das Praedikat in
// vier Tests (dieselbe Probe, gleicher Messweg).
//
// GEGENGEMESSEN: Liefert `fremdErklaert` versuchsweise immer `null` (Modus
// `sabotage` derselben Probe), werden vier dieser Tests rot — mit dem Schaden in
// der Ausgabe, nicht nur mit einem Zaehlerstand. Gruen bleiben genau die beiden
// Lagen ohne Nachweis, und das ist richtig so: dort darf die Schranke ohnehin
// nicht greifen.
//
// DER SCHALTER WIRD HIER IMMER GESETZT, nie aus der Umgebung gelesen. Sonst waere
// jeder Test nur in einem der beiden Laeufe gruen und die Suite im jeweils anderen
// Stand rot.
//
// AUFBAU DER LAGE (fuer alle Tests derselbe, siehe `baueAusgangslage`):
//   1. Beide Geraete kennen `GRUND` — eine gemeinsame Historie, eine Kennung.
//   2. A tippt `EIGEN-EDIT` ans Ende. Die eigene Hilfsdatei traegt es; hochgeladen
//      ist sie noch nicht. Dann geht die App zu.
//   3. B leitet von genau diesem gemeinsamen Stand ab und setzt `FREMD-EDIT`
//      hinter die erste Zeile.
//   4. Der Datei-Sync legt bei geschlossener App die `.md` von B ab und
//      ueberschreibt damit die eigene.
//   5. A startet. Der Start-Sweep findet diese `.md` vor.
//
// Die beiden Bausteine sitzen bewusst an VERSCHIEDENEN Stellen des Textes: bei
// konkurrierenden Einfuegungen an derselben Position entscheidet Yjs nach
// Client-ID, und die ist je Doc zufaellig — die Reihenfolge im gemergten Text
// waere dann von Lauf zu Lauf verschieden.

import CrdtSyncPlugin from '../src/main';
import {
  SyncHandler,
  setzeSweepSchrankeStandard,
  type SweepSchranke,
} from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import {
  makeLocalStorage,
  makeVaultMock,
  tippeMd,
  toArrayBuffer,
  type VaultMock,
} from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'aaaa1111';
const PEER_ID = 'bbbb2222';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.${PEER_ID}.yjs`;

const EIGEN = 'EIGEN-EDIT';
const FREMD = 'FREMD-EDIT';
const OFFLINE = 'OFFLINE-EDIT';

// Der gemeinsame Vorfahr beider Geraete.
const GRUND = 'Titel\nZeile A\nZeile B\n';
// Der Stand, den die eigene Hilfsdatei traegt (nur bei A).
const MIT_EIGEN = `Titel\nZeile A\nZeile B\n${EIGEN}\n`;
// Der Stand, den B geschrieben und der Datei-Sync abgelegt hat.
const MIT_FREMD = `Titel\n${FREMD}\nZeile A\nZeile B\n`;

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

// Baut Schritt 1–3 auf. Danach liegen im Vault: die eigene Hilfsdatei mit
// `EIGEN-EDIT`, die fremde mit `FREMD-EDIT`, beide unter derselben Kennung.
async function baueAusgangslage(): Promise<VaultMock> {
  const vault = makeVaultMock();
  const crdt = new CrdtManager();
  const sync = new SyncHandler(vault as any, crdt, OWN_ID);

  // 1. Die Notiz entsteht; dieser Stand ist der gemeinsame Vorfahr.
  await tippeMd(vault, NOTE, GRUND);
  await sync.applyLocalContent(NOTE, GRUND);
  const gemeinsam = decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!));

  // 2. A tippt weiter. Prozessintern — die Nutzerin sitzt davor.
  await tippeMd(vault, NOTE, MIT_EIGEN);
  await sync.applyLocalContent(NOTE, MIT_EIGEN);

  // 3. B leitet vom GEMEINSAMEN Stand ab, nicht vom eigenen: die gemeinsamen
  // Zeilen tragen so dieselben Yjs-Item-IDs und der Merge dedupliziert sie.
  // `EIGEN-EDIT` kennt B nicht — es war nie hochgeladen.
  const peer = new CrdtManager();
  peer.applyUpdate(NOTE, gemeinsam.update);
  peer.setContent(NOTE, MIT_FREMD);
  vault._files.set(
    PEER_PATH,
    toArrayBuffer(encodeStateFile(gemeinsam.guid!, peer.encodeState(NOTE)))
  );

  return vault;
}

interface Befund {
  doc: string; // was der Doc nach dem Sweep traegt
  hilfsdatei: string; // was die eigene Hilfsdatei traegt — das wandert zum Peer
  zaehler: number; // wie oft die Schranke gegriffen hat
}

// Schritt 4 + 5: Der Datei-Sync legt `gefunden` ab (von aussen, NICHT ueber den
// Adapter — sonst gaelte der Text als prozessintern geschrieben), dann laeuft der
// Start-Sweep. Frischer CrdtManager und frischer Handler: der Prozess ist neu, es
// gibt keinen Doc im Speicher und keine gemerkte Diff-Basis.
async function sweep(schranke: SweepSchranke, gefunden: string): Promise<Befund> {
  const vault = await baueAusgangslage();
  vault._textFiles.set(NOTE, gefunden);

  const crdt = new CrdtManager();
  const sync = new SyncHandler(vault as any, crdt, OWN_ID);
  sync.sweepSchranke = schranke;
  await sync.applyLocalContent(NOTE, gefunden, true);

  const persistiert = new CrdtManager();
  persistiert.applyUpdate(NOTE, decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!)).update);

  return {
    doc: crdt.getContent(NOTE),
    hilfsdatei: persistiert.getContent(NOTE),
    zaehler: sync.sweepSchrankeZaehler,
  };
}

describe('Sweep-Schranke: die Basiswahl von `basis-signatur`', () => {
  // LAGE 1 — DER KERNFALL.
  //
  // Die vorgefundene `.md` IST der Stand des anderen Geraets: der Datei-Sync hat
  // sie bei geschlossener App ueberschrieben. Ohne Schranke difft der Sweep sie
  // gegen den eigenen Doc-Stand und liest daraus zweierlei ab, was nie jemand
  // getan hat — „`FREMD-EDIT` eingefuegt" (der Text stand schon im gemergten
  // Doc, `patch_apply` dedupliziert nicht) und „`EIGEN-EDIT` geloescht" (er fehlt
  // der gelieferten Datei ja nur, weil B ihn nie gesehen hat).
  it('Kernfall: der eigene Edit ueberlebt und der Fremdtext steht genau einmal', async () => {
    const aus = await sweep('aus', MIT_FREMD);
    const bs = await sweep('basis-signatur', MIT_FREMD);

    // GEGENPROBE — der Bestand. Beide Schaeden auf einmal, in einem Durchlauf.
    expect(aus.zaehler).toBe(0);
    expect(aus.doc).not.toContain(EIGEN); // stiller Verlust
    expect(zaehle(aus.doc, FREMD)).toBe(1); // Verdopplung
    // Und beides steht in der Hilfsdatei — es wandert zum Peer.
    expect(aus.hilfsdatei).not.toContain(EIGEN);

    // MIT DER SCHRANKE: der Text der erklaerenden fremden Revision ist die Basis,
    // das Delta darauf ist leer — genau das, was der Nutzer getan hat: nichts.
    // Die WIRKUNG steht vor der Aktivitaetsprobe: faellt dieser Test, soll die
    // Ausgabe den Schaden zeigen und nicht nur einen Zaehlerstand.
    expect(bs.doc).toContain(EIGEN);
    expect(zaehle(bs.doc, FREMD)).toBe(1);
    expect(bs.hilfsdatei).toContain(EIGEN);
    expect(zaehle(bs.hilfsdatei, FREMD)).toBe(1);
    expect(bs.zaehler).toBe(1);
  });

  // LAGE 2 — OFFLINE-BEARBEITUNG.
  //
  // Dieselbe Lage, aber die Nutzerin hat die ueberschriebene Datei danach noch in
  // einem anderen Editor angefasst. Der Preis der Schranke darf nicht sein, dass
  // dieser Edit verschwindet — das war der belegte Schaden der Variante `immer`
  // (144/720 Laeufe ohne den eigenen Baustein).
  it('Offline-Bearbeitung: die extern eingefuegte Zeile ueberlebt in beiden Staenden', async () => {
    const gefunden = `${MIT_FREMD}${OFFLINE}\n`;
    const aus = await sweep('aus', gefunden);
    const bs = await sweep('basis-signatur', gefunden);

    // Die Zusage der Lage gilt in BEIDEN Staenden — sie ist der Preis, den die
    // Schranke nicht kosten darf.
    expect(aus.doc).toContain(OFFLINE);
    expect(bs.doc).toContain(OFFLINE);

    // Der Unterschied liegt daneben: ohne Schranke bezahlt der Offline-Edit mit
    // dem eigenen Baustein und einer Verdopplung.
    expect(aus.zaehler).toBe(0);
    expect(aus.doc).not.toContain(EIGEN);
    expect(zaehle(aus.doc, FREMD)).toBe(1);

    expect(bs.doc).toContain(EIGEN);
    expect(zaehle(bs.doc, FREMD)).toBe(1);
    expect(bs.zaehler).toBe(1);
  });

  // LAGE 3 — OFFLINE-LOESCHUNG. Der wichtigste der vier.
  //
  // „Zurueckkehrende geloeschte Zeilen" ist das Ausschlusskriterium des Produkts.
  // Die Park-Variante `signatur` faellt genau hier: sie rettet den eigenen Edit,
  // nimmt aber den ganzen Text mit auf den Parkplatz, und der loest per
  // `unionMerge` auf — die geloeschte Zeile kommt zurueck (gemessen 180 von 720).
  // Deshalb steht sie hier als DRITTER Stand daneben: der Unterschied zwischen
  // Parken und Basis-Korrektur ist die ganze Begruendung des Kandidaten.
  it('Offline-Loeschung: die geloeschte Zeile kehrt nicht zurueck', async () => {
    const gefunden = MIT_FREMD.replace('Zeile B\n', '');
    const aus = await sweep('aus', gefunden);
    const parken = await sweep('signatur', gefunden);
    const bs = await sweep('basis-signatur', gefunden);

    // GEGENPROBE 1 — Bestand: die Loeschung kommt durch, bezahlt aber mit dem
    // eigenen Baustein und einer Verdopplung.
    expect(aus.zaehler).toBe(0);
    expect(aus.doc).not.toContain('Zeile B');
    expect(aus.doc).not.toContain(EIGEN);
    expect(zaehle(aus.doc, FREMD)).toBe(1);

    // GEGENPROBE 2 — Parken: der eigene Baustein ist gerettet, die Loeschung
    // aber nicht erfasst. `Zeile B` steht wieder im Doc UND in der Hilfsdatei,
    // wandert also zum Peer zurueck. Das ist der Preis, den `basis-signatur`
    // ablegt.
    expect(parken.doc).toContain('Zeile B');
    expect(parken.hilfsdatei).toContain('Zeile B');
    expect(parken.zaehler).toBe(1);

    // MIT DER BASIS-KORREKTUR: beides zugleich. Die Basis ist der Stand, den die
    // Datei mitgebracht hat — das Delta darauf IST die Loeschung.
    expect(bs.doc).not.toContain('Zeile B');
    expect(bs.hilfsdatei).not.toContain('Zeile B');
    expect(bs.doc).toContain(EIGEN);
    expect(zaehle(bs.doc, FREMD)).toBe(1);
    expect(bs.zaehler).toBe(1);
  });

  // LAGE 4 — KEIN NACHWEIS VORHANDEN.
  //
  // Der vorgefundene Text wird von keiner fremden Revision erklaert: die `.md`
  // traegt weiter den eigenen Stand, die Nutzerin hat bei geschlossener App eine
  // Zeile ergaenzt. Die fremde Hilfsdatei liegt zwar daneben (sie ist angekommen),
  // erklaert den Text aber nicht — ihm fehlt `FREMD-EDIT` ganz.
  //
  // Hier muss die Schranke SCHWEIGEN. Tut sie es nicht, verliert ein echter
  // Offline-Edit seine Basis.
  it('kein Nachweis (echter Offline-Edit): die Schranke greift nicht, das Ergebnis ist unveraendert', async () => {
    const gefunden = `${MIT_EIGEN}${OFFLINE}\n`;
    const aus = await sweep('aus', gefunden);
    const bs = await sweep('basis-signatur', gefunden);

    expect(aus.zaehler).toBe(0);
    expect(bs.zaehler).toBe(0);
    // GLEICHHEIT statt Unterschied: das ist die Zusage dieser Lage.
    expect(bs.doc).toBe(aus.doc);
    expect(bs.hilfsdatei).toBe(aus.hilfsdatei);
    // Und was dabei herauskommen muss: alle drei Bausteine, keiner doppelt.
    expect(bs.doc).toContain(EIGEN);
    expect(bs.doc).toContain(OFFLINE);
    expect(zaehle(bs.doc, FREMD)).toBe(1);
  });

  // LAGE 4b — die zweite Bauart ohne Nachweis: eine zurueckgespielte Sicherung.
  //
  // Sie steht hier, weil an ihr die Variante `exakt` gefallen ist (354 Faelle, in
  // denen die wiederhergestellte Sicherung stillschweigend wieder ueberschrieben
  // wurde). `basis-signatur` darf sie nicht anfassen.
  it('kein Nachweis (zurueckgespielte Sicherung): die Schranke greift nicht', async () => {
    // Eine Fassung von VOR `Zeile B` — aus einem Backup zurueckkopiert.
    const gefunden = 'Titel\nZeile A\n';
    const aus = await sweep('aus', gefunden);
    const bs = await sweep('basis-signatur', gefunden);

    expect(aus.zaehler).toBe(0);
    expect(bs.zaehler).toBe(0);
    expect(bs.doc).toBe(aus.doc);
    expect(bs.hilfsdatei).toBe(aus.hilfsdatei);
  });
});

// DIE VERDRAHTUNG.
//
// Die fuenf Tests oben rufen `applyLocalContent(…, true)` selbst. Damit ist
// bewiesen, was die Schranke TUT — nicht, dass sie im Produktivbetrieb je
// erreicht wird. `imSweep = true` steht an genau einer Stelle in `src/`
// (`main.ts:1376`); faellt die weg oder wird das Argument vergessen, bleiben alle
// fuenf gruen und der Kandidat ist wieder tot. Dieser Test schliesst die Naht.
describe('Sweep-Schranke: die Verdrahtung zum echten Start-Sweep', () => {
  // Der Standardwert des Moduls ist nicht auslesbar — ein Wegwerf-Handler liefert
  // ihn. Ohne das Zuruecksetzen truege der Lauf mit gesetzter Umgebungsvariable
  // hinterher einen anderen Standard als vorher.
  const standardLesen = (): SweepSchranke =>
    new SyncHandler(makeVaultMock() as any, new CrdtManager(), OWN_ID).sweepSchranke;

  async function ueberDenSweep(schranke: SweepSchranke): Promise<{
    doc: string;
    datei: string;
    zaehler: number;
  }> {
    const vault = await baueAusgangslage();
    // Der Datei-Sync hat die `.md` zuletzt angefasst — sonst ueberspringt der
    // Sweep sie (Zeitstempel-Vergleich gegen die eigene Hilfsdatei).
    vault._textFiles.set(NOTE, MIT_FREMD);
    vault._mdMtimes.set(NOTE, 9999);

    const vorher = standardLesen();
    try {
      setzeSweepSchrankeStandard(schranke);
      const storage = makeLocalStorage();
      storage.saveLocalStorage('qollab-client-id', OWN_ID);
      const app = {
        vault: Object.assign(vault, {
          on: (event: string) => ({ __event: event }),
          offref: () => {},
        }),
        workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
        loadLocalStorage: storage.loadLocalStorage,
        saveLocalStorage: storage.saveLocalStorage,
      };
      const plugin: any = new (CrdtSyncPlugin as any)(app, {});
      plugin._data = { enabled: true, statusNotice: false, tombstones: {} };
      await plugin.onload();
      await plugin.runStartupSweep();
      return {
        doc: plugin.crdtManager.getContent(NOTE),
        datei: vault._textFiles.get(NOTE)!,
        zaehler: plugin.syncHandler.sweepSchrankeZaehler,
      };
    } finally {
      setzeSweepSchrankeStandard(vorher);
    }
  }

  it('der Start-Sweep aus main.ts erreicht die Schranke und veraendert das Ergebnis', async () => {
    const aus = await ueberDenSweep('aus');
    const bs = await ueberDenSweep('basis-signatur');

    expect(aus.zaehler).toBe(0);
    expect(aus.doc).not.toContain(EIGEN);
    expect(zaehle(aus.doc, FREMD)).toBe(1);

    expect(bs.doc).toContain(EIGEN);
    expect(zaehle(bs.doc, FREMD)).toBe(1);
    // Der Write-Back des Sweeps traegt den gemergten Stand in die Datei — dort
    // sieht die Nutzerin ihn.
    expect(bs.datei).toContain(EIGEN);
    expect(zaehle(bs.datei, FREMD)).toBe(1);
    expect(bs.zaehler).toBe(1);
  });
});
