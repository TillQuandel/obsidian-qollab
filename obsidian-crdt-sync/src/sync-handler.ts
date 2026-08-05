import { CrdtManager, carriesYjsOps, isEmptyYjsState, textFromUpdate } from './crdt-manager';
import { encodeStateFile, decodeStateFile, generateGuid } from './state-file';
import type { SidecarAdapter, DirListingCache } from './sidecar-io';
import {
  ensureSidecarFolder,
  dirname,
  readSidecar,
  sidecarExists,
  statSidecar,
} from './sidecar-io';
import { threeWayMerge, unionMerge, insertedTexts } from './text-merge';

export const QOLLAB_DIR = '.qollab';

// Filtert alle Pfade auf die .yjs-Sibling-Dateien EXAKT dieser Note. Ein Pfad ist
// ein Sibling, wenn er entweder die Legacy-Form `.qollab/<notePath>.yjs` hat ODER
// die per-Client-Form `.qollab/<notePath>.<8-hex-clientId>.yjs`. String-basiert
// statt Regex, damit Sonderzeichen im notePath kein Escaping-Problem erzeugen.
//
// Fix B: der vormalige Prefix-Match (`startsWith('.qollab/<notePath>.')`) fasste
// die Sidecars einer eigenständigen Note `note.md.archive.md` fälschlich als
// Siblings von `note.md` auf (Cross-Note-Merge / Mit-Löschen fremder Sidecars).
export function filterYjsFiles(allPaths: string[], notePath: string): string[] {
  const legacy = `${QOLLAB_DIR}/${notePath}.yjs`;
  const prefix = `${QOLLAB_DIR}/${notePath}.`;
  return allPaths.filter((p) => {
    if (p === legacy) return true;
    if (!p.startsWith(prefix)) return false;
    // Rest muss exakt `<8-hex-clientId>.yjs` sein — keine weiteren Punkt-Segmente.
    return /^[0-9a-f]{8}\.yjs$/.test(p.slice(prefix.length));
  });
}

// Gerätelokaler Tombstone-Store, von main.ts injiziert. Merkt sich gelöschte
// Note-Inkarnationen, damit stale fremde .yjs derselben Inkarnation nicht wieder
// gemergt werden.
//
// Task 15: Ein Tombstone gilt für genau ein Paar (notePath, guid). Lebt dieselbe
// GUID unter einem anderen Pfad weiter (Rename, Adoption), ist sie dort unberührt
// — deshalb tragen beide Methoden den Note-Pfad.
//
// Review F-4: Geschrieben wird das Kreuzprodukt in EINEM Zug. Ein Delete kann
// mehrere Pfade (Rename-Historie) und mehrere GUIDs (Split-Brain-Reste unter dem
// gelöschten Pfad) betreffen; jedes Paar einzeln zu persistieren hieß je ein
// vollständiger `data.json`-Write.
export interface TombstoneStore {
  has(guid: string, notePath: string): boolean;
  addAll(guids: string[], notePaths: string[]): Promise<void>;
}

const NO_TOMBSTONES: TombstoneStore = {
  has: () => false,
  addAll: async () => {},
};

// Kombiniertes IO-Interface: die indizierte .md-Note läuft über die Vault-API
// (getAbstractFileByPath/read), sämtliche Sidecars (.qollab/…) über den Adapter.
// Grund: Obsidians Vault-Index ist blind für Dot-Ordner — die .md ist indiziert,
// die .yjs-Sidecars sind es nie (siehe sidecar-io.ts).
interface VaultLike {
  // .md-Note (indiziert).
  getAbstractFileByPath(path: string): { path: string } | null;
  read(file: { path: string }): Promise<string>;
  // Sidecars (.qollab/…) — nur über den Adapter erreichbar.
  adapter: SidecarAdapter;
  // Adapter-gestütztes Listen der .yjs-Siblings dieser Note (async, weil
  // adapter.list async ist). Der optionale Cache gilt für die Dauer eines
  // Startup-Sweeps (Task 19/B, siehe DirListingCache in sidecar-io).
  listYjsFiles(notePath: string, cache?: DirListingCache): Promise<string[]>;
}

interface DecodedSibling {
  path: string;
  guid: string | null;
  update: Uint8Array;
}

// Task 12: Eine Sidecar existiert, ihr Read wirft aber (EBUSY, offenes Handle,
// Sync-Tool schreibt gerade). Das ist strikt etwas anderes als „korrupt" (Read
// gelingt, Parse/applyUpdate scheitert): korrupt heißt Datei überspringen und
// weiterarbeiten, ein IO-Fehler heißt „wir kennen den Stand nicht". Würde er wie
// bisher zu null degradiert, hielte der Aufrufer eine vorhandene Fremd-Op für
// nicht existent und erfände sie beim .md-Diff als eigene Op (Duplikat). Deshalb
// eigener Fehlertyp, der den laufenden Merge abbricht.
//
// Der Abbruch heilt NICHT von allein: loadAndMerge injiziert den .md-Text im
// own-Branch bewusst nicht, und der Watcher dedupliziert seine Trigger per
// lastSeen. Deshalb hängen zwei Rückkanäle daran — `abortedReads` (lokaler Edit
// nicht erfasst → onRemoteYjsUpdate holt nach und schreibt vorher nichts zurück)
// und der false-Rückgabewert von onRemoteYjsUpdate (Trigger nicht verbraucht).
class SidecarReadError extends Error {
  constructor(readonly path: string) {
    super(`Sidecar nicht lesbar: ${path}`);
    this.name = 'SidecarReadError';
  }
}

// Task 14: Signatur des zuletzt von UNS geschriebenen Stands einer eigenen
// Sidecar-Datei. (mtime,size) erkennt den Normalfall ohne Lesezugriff, der Hash
// entscheidet die Zweifelsfälle (mtime-Bump durch ein Sync-Tool bei identischen
// Bytes ist keine Kollision). In-memory und pro Prozess — es geht um „hat seit
// unserem letzten Write jemand anders geschrieben", nicht um Persistenz.
interface OwnSidecarSignature {
  mtime: number;
  size: number;
  hash: number;
}

// FNV-1a (32 bit). Kein Krypto-Anspruch: der Hash vergleicht unsere eigenen Bytes
// mit dem Disk-Stand, ein Angreifer-Modell gibt es hier nicht. Zusammen mit der
// Länge reicht das, um einen fremden Yjs-State von unserem zu unterscheiden.
function hashBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class SyncHandler {
  // Note-Pfad → GUID der aktuell geladenen Inkarnation.
  private guids = new Map<string, string>();

  // Task 15 / Review C-1: aktueller Note-Pfad → Pfade, unter denen DIESELBE
  // Inkarnation auf DIESEM Gerät vorher gelebt hat (Rename-Historie der Sitzung).
  //
  // Grund: Der Tombstone ist seit Fix A an das Paar (notePath, guid) gebunden,
  // der delete-Handler sieht aber nur den zuletzt bewohnten Pfad. Nach
  // `alt.md → neu.md → delete` stünde der Tombstone allein auf `neu.md`; eine
  // verspätet ankommende Fremd-Sidecar unter `alt.md` mit derselben GUID fände
  // dort keinen — und sobald unter `alt.md` wieder eine (neue, unbeteiligte)
  // Note liegt, adoptiert ensureDoc die tote Inkarnation und unionMerge schiebt
  // ihren Inhalt in die fremde Note. Deshalb tombstont der delete-Handler die
  // ganze Pfad-Historie dieser Inkarnation, nicht nur den aktuellen Pfad.
  //
  // Bewusst NICHT beim Rename selbst tombstont: das entwertete `alt.md` für eine
  // LEBENDE Inkarnation und risse genau die Lücke wieder auf, die Fix A
  // geschlossen hat, sobald der Datei-Sync die .md unter dem alten Pfad
  // zurückspielt.
  //
  // „DIESELBE Inkarnation" ist wörtlich gemeint: `switchToGuid` tauscht die
  // Inkarnation unter einem Pfad aus und verwirft deshalb den Eintrag (Review
  // F-2) — die Historie gehört zur aufgegebenen, nicht zur neuen GUID.
  //
  // Grenze: rein in-memory und damit sitzungslokal. Nach einem App-Neustart ist
  // die Historie weg, ein Rename VOR dem Neustart und ein Delete DANACH tombstont
  // wieder nur den neuen Pfad. Vertretbar, weil Tombstones ohnehin gerätelokal
  // sind und der häufige Fall (Rename und Delete in derselben Sitzung) gedeckt
  // ist; die persistente Lösung ist Löschen als CRDT-Operation (Issue #11).
  private priorPaths = new Map<string, string[]>();

  constructor(
    private vault: VaultLike,
    private crdtManager: CrdtManager,
    private clientId: string,
    private tombstones: TombstoneStore = NO_TOMBSTONES,
    // R2: optionaler Callback für korrupte Dateien (einmalige Notice-Logik liegt beim Aufrufer).
    private onCorruptFile?: (path: string) => void,
    // Task 12: optionaler Callback für UNLESBARE (nicht korrupte) Dateien. Feuert
    // bei jedem Abbruch; die Schwellen-/Notice-Logik liegt beim Aufrufer.
    private onUnreadableFile?: (path: string) => void,
    // Task 17/F-6: Gegenstück für den SCHREIBpfad. Feuert bei jedem
    // fehlgeschlagenen Sidecar-Write; Schwelle und Notice liegen wie oben beim
    // Aufrufer.
    private onUnwritableFile?: (path: string) => void,
    // Task 19/C: Zwei unverwandte Änderungsketten derselben Note wurden
    // vereinigt, und BEIDE haben etwas beigetragen — der Nutzer hat jetzt
    // womöglich doppelte Absätze in der Datei. Feuert bei jedem Vorkommnis;
    // Dedup und Wortlaut liegen wie bei den anderen Kanälen beim Aufrufer.
    private onUnrelatedMerge?: (notePath: string) => void,
    // Task 20: Das Gegenstück — eine getrennt entstandene Fassung wurde NICHT
    // übernommen. Der Realtest (r25/r27) hat gezeigt, dass `onUnrelatedMerge`
    // systematisch die falsche Seite erreicht: Es meldet nur, wo vereinigt wird,
    // also beim Wechsel auf die fremde Kette. Gewinnt die eigene Kette, wird die
    // fremde still verworfen — und genau dort fehlt dem Nutzer hinterher Text.
    private onDiscardedIncarnation?: (notePath: string, guid: string) => void,
    // Sichert einen Textstand als eigene Notiz im Vault, BEVOR er überschrieben
    // wird. Der Aufrufer bestimmt Ort und Namen; der Handler kennt nur den
    // Anlass. Fehlt der Kanal, unterbleibt die Sicherung — dann verhält sich der
    // Nachtrag wie zuvor.
    private onSaveCopy?: (notePath: string, text: string) => Promise<void>
  ) {}

  // Task 17/F-6: Notes, deren Stand beim letzten `saveState` NICHT auf die Platte
  // kam. Der Doc trägt ihn weiter, es fehlt nur die Persistenz — deshalb genügt es,
  // die Note zu markieren und den nächsten Trigger den Write wiederholen zu lassen.
  // Der Aufrufer nutzt die Markierung, um den Trigger unverbraucht zu lassen
  // (`onRemoteYjsUpdate` gibt dann `false`), damit dieser nächste Trigger auch
  // kommt.
  private unpersisted = new Set<string>();

  hasUnpersistedState(notePath: string): boolean {
    return this.unpersisted.has(notePath);
  }

  // Notes, deren letzter applyLocalContent wegen eines IO-Fehlers abgebrochen ist,
  // samt dem Text, der dabei NICHT in den CRDT kam. Solange ein Eintrag steht, darf
  // kein Write-Back die .md überschreiben (Review F-2b).
  //
  // Warum der Text mitgespeichert wird und der Nachhol-Versuch nicht einfach den
  // aktuellen .md-Inhalt nimmt: Bricht der Lauf im pending-Zweig von
  // onRemoteYjsUpdate ab (R2-1), hat das vorangegangene loadAndMerge den Doc bereits
  // auf den Remote-Stand gezogen, ohne dass er je in die .md geschrieben wurde. Ein
  // späterer Diff „.md gegen Doc" hielte den Remote-Edit dann für eine lokale
  // Löschung und würde ihn zurückrollen (cross-device Datenverlust — der Spiegelfall
  // von I-1 aus Task 11). Der gemerkte Text ist dagegen genau das, was schon einmal
  // als korrekt berechnet wurde; ihn erneut anzuwenden ist idempotent.
  private abortedReads = new Map<string, string>();

  // Task 16: Note-Pfad → gemeinsamer Vorfahr des nächsten lokalen .md-Diffs. Im
  // Normalfall ist das der .md-Text, wie dieses Plugin ihn zuletzt gesehen hat
  // (Read im modify-Handler/Sweep, eigener Write-Back).
  //
  // Warum nicht weiter der Doc-Text: `applyLocalContent` zieht ausstehende
  // Fremd-Sidecars in den Doc, schreibt die .md aber nicht zurück (das tut allein
  // der Write-Back in onRemoteYjsUpdate, ausgelöst vom 30-s-Poll). Zwischen
  // Fremd-Merge und Poll ist der Doc der Datei also legitim VORAUS. Nimmt der
  // nächste Tastendruck den Doc als Basis, ist das Delta „Basis → .md" genau die
  // Löschung des Fremd-Edits — als Delete-Op persistiert und zum Peer propagiert
  // (fund-endzustaende.md Fund 1: stiller, unheilbarer Verlust auf beiden Geräten).
  // Gegen den zuletzt gesehenen .md-Text gediffed, ist der Vorlauf per Konstruktion
  // keine lokale Änderung.
  //
  // Fehlt ein Eintrag (frischer Prozess, Note erstmals angefasst), bleibt es beim
  // Doc-Text: dort ist er der letzte von uns erfasste .md-Stand und die Basis
  // korrekt. Grenze: rein in-memory. Ging die App zwischen Fremd-Merge und
  // Write-Back aus, ist der aus der eigenen Sidecar rekonstruierte Doc weiterhin
  // voraus und der Fallback wieder falsch — dieses Fenster schließt der Initial-Scan
  // des Watchers (Write-Back vor dem ersten modify), nicht diese Map.
  private localDiffBase = new Map<string, string>();

  // ERSTKONTAKT — der Parkplatz: `.md`-Text, den nicht dieser Prozess geschrieben
  // hat und der deshalb NICHT als eigene Operation verbucht wird.
  //
  // Der Schaden entsteht nicht dadurch, dass zwei Geräte unabhängig prägen,
  // sondern dadurch, dass eine per Datei-Sync gelieferte `.md` als eigene
  // Bearbeitung materialisiert wird — vier unabhängige Untersuchungen führen
  // 100 % des gemessenen Schadens dorthin.
  //
  // Warum ein EIGENER Zustand und nicht `abortedReads` mitbenutzt: Der Poll holt
  // einen dort abgelegten Text über `pendingLocalContent` ungeprüft nach — mit
  // genau dem Inhalt, den das Tor abgewiesen hat. Gemessen: das Tor wäre
  // wirkungslos.
  //
  // Rein in-memory, wie `localDiffBase` und `abortedReads`. Nach einem Neustart
  // ist ein Parkplatz weg, und der Startup-Sweep erfasst die Datei wie bisher —
  // Bestandsverhalten. Das ist bewusst so: Beim Start ist Herkunft nicht
  // ableitbar (gemessen, sechs Änderungswege, kein eindeutiger Merkmalsvektor),
  // und für den Sweep ist der Bestand nachweislich die beste bekannte Regel
  // (verliert nie, verdoppelt genau einmal sichtbar).
  private parked = new Map<string, { text: string; ticks: number; gesamt: number }>();

  // Obergrenze des Kanal-Tors. Der Reset unten haengt daran, dass der Merge den
  // Doc VERAENDERT hat — nicht daran, dass er dem geparkten Text naeherkommt.
  // Ein Peer, der laufend Updates schickt, die den geparkten Stand nie decken,
  // haelt die Frist sonst unbegrenzt zurueck (Cross-Model-Review 2026-08-04).
  // `gesamt` zaehlt jeden Tick und wird NIE zurueckgesetzt: nach diesem Vielfachen
  // der Frist wird nachgetragen, egal was der Kanal tut.
  private static readonly PARK_OBERGRENZE = 8;

  // Deckt `doc` den Text `text` bereits ab — trägt `text` also nichts bei, was im
  // Doc fehlt? `unionMerge(text, doc)` gibt `doc` zurück und hängt nur die Zeilen
  // an, die ausschließlich `text` kennt. Bleibt das Ergebnis `doc`, ist nichts
  // offen. Die Argumentreihenfolge ist der ganze Punkt: andersherum gefragt
  // („trägt der Doc nichts bei?") ist die Bedingung fast nur bei Gleichheit wahr,
  // und ein geparkter Stand löste sich nicht mehr auf, sobald der Doc etwas
  // Eigenes trug — etwa einen Tastendruck.
  private deckt(doc: string, text: string): boolean {
    return unionMerge(text, doc) === doc;
  }

  // Der gelesene Text stammt nicht aus diesem Prozess: zwischenlagern statt
  // erfassen. Die Diff-Basis wandert MIT — sonst ist das Delta des nächsten
  // Tastendrucks („Basis → Datei") die Löschung genau dieses Textes, und der Fix
  // erzeugte den Schaden, den er verhindern soll.
  parkForeign(notePath: string, content: string): void {
    const alt = this.parked.get(notePath);
    this.parked.set(notePath, {
      text: content,
      ticks: alt?.ticks ?? 0,
      gesamt: alt?.gesamt ?? 0,
    });
    this.localDiffBase.set(notePath, content);
  }

  hasParked(notePath: string): boolean {
    return this.parked.has(notePath);
  }

  parkedText(notePath: string): string | undefined {
    return this.parked.get(notePath)?.text;
  }

  // Die Uhr braucht die Liste, weil sie an keinem Datei-Ereignis haengt. Kopie,
  // damit ein Nachtrag waehrend der Iteration den Parkplatz raeumen darf.
  parkedPaths(): string[] {
    return [...this.parked.keys()];
  }

  // Beim Abschalten des Plugins: Der Parkplatz haelt `.md`-Texte im Speicher, und
  // ohne laufende Uhr wird er weder aufgeloest noch nachgetragen. Statt ihn
  // liegen zu lassen, wird jeder Stand JETZT nachgetragen — der Nutzer schaltet
  // Qollab aus, also gilt ab hier wieder Bestandsverhalten.
  async flushParked(frist: number): Promise<void> {
    for (const notePath of this.parkedPaths()) {
      await this.tickParked(notePath, frist);
      // Auch ein noch nicht faelliger Stand wird hier faellig: die Uhr steht ab
      // jetzt, ein spaeterer Nachtrag kaeme nie.
      const p = this.parked.get(notePath);
      if (p) {
        p.ticks = frist;
        await this.tickParked(notePath, frist);
      }
    }
  }

  // Deckt der Doc den geparkten Stand inzwischen ab? Dann ist die Historie
  // eingetroffen, das Parken hat seinen Zweck erfüllt und wird beendet — ohne
  // dass je eine eigene Op für fremden Text entstanden ist.
  resolveParked(notePath: string): boolean {
    const p = this.parked.get(notePath);
    if (!p) return true;
    if (!this.deckt(this.crdtManager.getContent(notePath), p.text)) return false;
    this.parked.delete(notePath);
    return true;
  }

  // Ein Tick der Frist-Uhr. Sie hängt bewusst am 30-s-Intervall des Wächters und
  // nicht an eintreffenden Hilfsdateien: Eine Notiz, deren Hilfsdatei NIE kommt
  // (Peer ohne Qollab, `.qollab` vom Sync ausgeschlossen, externer Editor),
  // bekäme sonst nie wieder einen Auslöser — aus „später entscheiden" würde „nie
  // entscheiden", und gemessen fielen so 60 % der Notizen dauerhaft aus dem
  // Abgleich.
  async tickParked(notePath: string, frist: number): Promise<void> {
    const p = this.parked.get(notePath);
    if (!p) return;
    if (this.resolveParked(notePath)) return;
    p.ticks++;
    p.gesamt++;
    // Entweder die Frist ist abgelaufen — oder die Obergrenze ist erreicht und
    // das Kanal-Tor hat lange genug zurueckgesetzt.
    if (p.ticks < frist && p.gesamt < frist * SyncHandler.PARK_OBERGRENZE) return;

    // Guard „keine `.md` ⇒ kein Nachtrag". Ohne ihn prägt ein Fristablauf nach
    // dem Löschen eine PHANTOM-INKARNATION: `ensureDoc` setzt die frische GUID,
    // bevor es den fehlenden `.md` bemerkt, und `saveState` legt danach eine
    // Hilfsdatei für eine Notiz an, die es nicht mehr gibt — von keinem Tombstone
    // gedeckt, weil der auf die alte GUID gesetzt wurde.
    this.parked.delete(notePath);
    if (!this.vault.getAbstractFileByPath(notePath)) return;

    // Die Basis wird VOR dem Nachtrag auf den Doc-Stand zurückgesetzt. Beim
    // Parken steht sie auf dem geparkten Text (damit ein Tastendruck darauf nur
    // seine eigene Differenz erzeugt); bliebe sie stehen, wäre das Delta hier
    // leer und der Nachtrag ein No-op — der erste Entwurf hat auf diese Weise
    // 100 % der externen Bearbeitungen verloren.
    const doc = this.crdtManager.getContent(notePath);
    this.localDiffBase.set(notePath, doc);

    // SICHERN VOR DEM ÜBERSCHREIBEN. Der geparkte Text und der Doc-Stand sind
    // zwei Fassungen ohne gemeinsamen Vorfahren; welche die gewollte ist, kann
    // dieses Gerät nicht wissen — genau das ist das Herkunftsproblem. Statt zu
    // raten wird die Fassung gesichert, die der Nachtrag gleich verdrängt.
    //
    // Das ist die Regel des Kompensations-Musters: eine Korrektur darf einen
    // alten Zustand nie ZURÜCKSCHREIBEN, nur als zusätzliche Fassung
    // wiederherstellen — sonst überschreibt sie parallele Änderungen. Und es ist
    // das Muster, das Obsidian Sync selbst fährt (`storeTextFileBackup` vor
    // jedem Download-Write).
    //
    // Erst dadurch ist der nächste Schritt vertretbar: Der geparkte Stand wird
    // als DIFF erfasst statt vereinigt. Vereinigen konnte nie etwas löschen und
    // hat deshalb gelöschte Zeilen wiederbelebt — was ein `git checkout` oder
    // einen bewussten Löschvorgang im externen Editor unterläuft. Der Diff bildet
    // den Willen des Schreibers ab; die Fassung, die er verdrängt, liegt in der
    // Sicherung.
    // VEREINIGEN, nicht diffen — und die reine Fassung sichern.
    //
    // Beide Wege sind verlustfrei, sie unterscheiden sich darin, WO die Unordnung
    // landet. Ein Diff bildet den Willen des Schreibers ab, verdrängt aber alles,
    // was nur der Doc kennt: gemessen 18–22 % der Läufe mit einer Extra-Datei.
    // Vereinigen kann nie etwas löschen, mischt dafür zwei Fassungen in der Notiz
    // — und belebt gelöschte Zeilen wieder, was ein `git checkout` unterläuft.
    //
    // Die Auflösung ist nicht die Wahl zwischen beiden, sondern die Sicherung:
    // Die Notiz bekommt die Vereinigung (nichts geht verloren), und die REINE
    // Fassung des fremden Schreibers liegt als eigene Notiz daneben — damit ist
    // ein `git checkout` mit einem Handgriff wiederherstellbar, statt in der
    // Mischung unterzugehen.
    //
    // Gesichert wird nur, wenn die Vereinigung dem geparkten Text tatsächlich
    // etwas hinzufügt. Deckt er den Doc-Stand ohnehin ab, ist die Vereinigung
    // gleich dem geparkten Text und es gibt keine reine Fassung zu retten.
    const vereinigt = unionMerge(p.text, doc);
    if (vereinigt !== p.text) await this.onSaveCopy?.(notePath, p.text);
    await this.applyLocalContent(notePath, vereinigt);
  }

  // Solange etwas geparkt ist, trägt die `.md` Text, den dieses Gerät nicht
  // geschrieben hat. Sie ist dann KEIN Zeuge des lokalen Stands — der Doc ist es.
  //
  // Das ist die zweite Tür: `ensureDoc` (Adopt-Zweig) und `switchToGuid` lesen die
  // `.md` selbst und vereinigen sie, ohne je durch `applyLocalContent` zu laufen.
  // Ein Tor allein im modify-Pfad deckte einen von vier Aufrufern ab.
  private lokalerZeuge(notePath: string, mdText: string): string {
    if (!this.parked.has(notePath)) return mdText;
    return this.crdtManager.getContent(notePath);
  }

  // Setzt die Basis explizit. Zwei Anlässe in onRemoteYjsUpdate: nach dem
  // Write-Back (die Datei trägt jetzt den gemergten Stand) und vor dem
  // `applyLocalContent(threeWay)` des pending-Zweigs (dessen Text setzt auf dem
  // gemergten Doc auf, nicht auf dem alten .md-Stand).
  //
  // Ohne diesen Kanal bliebe die Basis nach einem Write-Back auf dem ALTEN .md-Text
  // stehen; das Delta enthielte dann die Fremd-Einfügung, die der Doc bereits hat,
  // und `threeWayMerge` fügte sie ein zweites Mal ein (patch_apply dedupliziert
  // nicht — siehe WARNUNG in text-merge.ts).
  noteLocalDiffBase(notePath: string, content: string): void {
    this.localDiffBase.set(notePath, content);
  }

  // True, solange für diese Note ein abgebrochener Lauf nachzuholen ist.
  hasAbortedRead(notePath: string): boolean {
    return this.abortedReads.has(notePath);
  }

  // Der Text, dessen Erfassung abgebrochen ist — für den Nachhol-Versuch.
  pendingLocalContent(notePath: string): string | undefined {
    return this.abortedReads.get(notePath);
  }

  // Szenariosuche Welle 2, Fund 1: Derselbe Rückkanal von AUSSEN gemeldet.
  //
  // Der Pfad-Abbruch in main.ts (modify-Handler und Sweep, `file.path !==
  // notePath`) stellt exakt den Zustand her, für den `abortedReads` gebaut wurde:
  // Der `.md`-Text ist gelesen, aber weder im Doc noch in der eigenen Sidecar —
  // er lebt allein in der Datei. Der Unterschied zum IO-Abbruch oben ist nur, WER
  // abgebrochen hat; die Folge ist dieselbe, und ohne Markierung schreibt
  // `onRemoteYjsUpdate` beim nächsten Fremd-Trigger über `data === preMerge` den
  // Doc-Stand zurück, der den Edit nicht kennt (kein Delete-Op, keine Meldung,
  // kein Weg zurück).
  //
  // Gemeldet wird unter `notePath`, dem Schlüssel der Warteschlange — nicht unter
  // dem inzwischen gültigen `file.path`. Der Abbruch existiert gerade deshalb,
  // weil der neue Pfad hier nicht gedeckt ist; ihn als Schlüssel zu benutzen
  // wiederholte den Fehler, den er verhindert. Auf den neuen Pfad hebt der
  // rename-Handler die Markierung (siehe `renameNote`) zusammen mit GUID, Doc und
  // Sidecars — derselbe Weg, den der gesamte übrige Zustand nimmt.
  noteUncapturedLocalContent(notePath: string, content: string): void {
    this.abortedReads.set(notePath, content);
  }

  // Task 14: Signatur unserer eigenen Sidecars + Pfade, die wir gerade schreiben
  // (writingPaths-Analogon für Sidecars). Beides zusammen hält das False-Positive-
  // Fenster der Kollisionserkennung klein.
  private ownSignatures = new Map<string, OwnSidecarSignature>();
  private writingSidecars = new Set<string>();

  stateFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
  }

  // Task 19/C — der EINE Ort, an dem zwei unverwandte Änderungsketten vereinigt
  // werden. Bis hierher taten das drei Aufrufer auf eigene Rechnung; jetzt geht
  // jeder durch diese Tür, und die Tür meldet, was sie sieht.
  //
  // Gemeldet wird nur, wenn BEIDE Seiten etwas beigetragen haben. Ist eine Seite
  // in der anderen enthalten — der häufigste Fall: leere `.md`, noch nicht
  // nachgezogene Datei, identischer Stand beim Erstkontakt —, gibt `unionMerge`
  // eine der Eingaben unverändert zurück, es entsteht keine Dopplung, und es gibt
  // nichts zu melden. Genau diese Kürzung hält die Meldung von einem Dauerton
  // fern.
  //
  // Warum hier nicht VERWEIGERT wird, obwohl der Task so heißt: Ein Abbruch
  // müsste einen der beiden Stände fallen lassen oder in eine Konfliktkopie
  // auslagern. Beides senkt die Menge dessen, was in der Note steht — gemessen
  // am deterministischen Fuzzer wäre das ein Anstieg der Verlust-Kategorie, und
  // „Verlust darf nicht steigen" ist die harte Auflage. Verweigert wird deshalb
  // die STILLE: die Vereinigung bleibt, sie wird nur nicht mehr verschwiegen.
  private unite(notePath: string, other: string, local: string): string {
    const merged = unionMerge(other, local);
    if (merged !== other && merged !== local) this.onUnrelatedMerge?.(notePath);
    return merged;
  }

  // Task 14: Neue Geräte-ID nach erkannter Kollision. Die bisherigen Signaturen
  // gehören zu Pfaden, die uns ab jetzt nicht mehr gehören (sie sind Fremd-Sidecars
  // des anderen Geräts) — deshalb verwerfen statt mitschleppen.
  setClientId(clientId: string): void {
    this.clientId = clientId;
    this.ownSignatures.clear();
  }

  // Task 14: Hat ein FREMDER Schreiber unsere eigene Sidecar-Datei überschrieben?
  // Das ist das Symptom einer geklonten clientId (mitgesyncte data.json): beide
  // Geräte schreiben denselben Pfad, und der Self-Ignore des Watchers verschluckt
  // den Peer dauerhaft. Aufrufer ist der Poll, der die (mtime,size)-Änderung schon
  // festgestellt hat; `cur` ist genau dieser Stand.
  //
  // Ausschlüsse in dieser Reihenfolge (lieber ein verpasster als ein erfundener Fund
  // — Neu-Provisionierung ist zwar gutartig, aber nicht gratis):
  //   1. Wir schreiben diesen Pfad gerade selbst.
  //   2. Signatur passt exakt → unser letzter Write.
  //   3. Bytes identisch mit unserem letzten Stand → Sync-Tool hat unsere eigene
  //      Datei zurückkopiert (neue mtime, gleicher Inhalt).
  //   4. Keine Signatur (erste Sichtung nach dem Start) → Baseline setzen; über
  //      einen Schreiber lässt sich hier nichts aussagen.
  //   5. Unlesbar oder verschwunden → keine Aussage (transienter IO-Fehler).
  async isForeignSidecarWrite(
    path: string,
    cur?: { mtime: number; size: number }
  ): Promise<boolean> {
    if (this.writingSidecars.has(path)) return false;
    const known = this.ownSignatures.get(path);
    if (known && cur && known.mtime === cur.mtime && known.size === cur.size) return false;

    let buffer: ArrayBuffer | null;
    try {
      buffer = await readSidecar(this.vault.adapter, path);
    } catch {
      return false;
    }
    if (buffer === null) return false;

    const bytes = new Uint8Array(buffer);
    const signature: OwnSidecarSignature = {
      mtime: cur?.mtime ?? known?.mtime ?? 0,
      size: bytes.length,
      hash: hashBytes(bytes),
    };
    if (!known) {
      this.ownSignatures.set(path, signature);
      return false;
    }
    if (known.hash === signature.hash && known.size === signature.size) {
      this.ownSignatures.set(path, signature);
      return false;
    }
    return true;
  }

  // Aktuelle GUID der Note: aus der Map, sonst aus dem Header der eigenen .yjs.
  // Reiner Lese-Zugriff auf die EIGENE Sicht. Der delete-Handler nutzt seit
  // Review F-1 `guidsToTombstone` (siehe dort); hier bleibt bewusst alles wie
  // gehabt, damit der Merge-/Adopt-Pfad unberührt ist.
  async currentGuid(notePath: string): Promise<string | null> {
    const mapped = this.guids.get(notePath);
    if (mapped) return mapped;
    // Task 12: Ein IO-Fehler darf den delete-Handler nicht scheitern lassen — er
    // räumt dann ohne Tombstone auf (bisheriges Verhalten). Kein Abbruch-Fall:
    // hier entsteht kein Merge und keine Op.
    const own = await this.readStateFile(this.stateFilePath(notePath)).catch(() => null);
    return own?.guid ?? null;
  }

  // NUR für den Delete-Pfad (Review F-1): welche Inkarnationen sind unter diesem
  // Pfad zu beerdigen?
  //
  // `currentGuid` kennt ausschließlich die eigene Sicht (guids-Map + eigene
  // Sidecar). Eine Note, die per Datei-Sync mit einer FREMDEN Sidecar ankam und
  // hier nie geöffnet oder editiert wurde, hat beides nicht — sie lieferte `null`,
  // und der delete-Handler setzte gar keinen Tombstone, auch nicht für den
  // aktuellen Pfad. Trifft danach eine stale Fremd-Sidecar auf eine gleichnamige
  // Neuanlage, adoptiert ensureDoc die tote Inkarnation und unionMerge zieht ihren
  // Inhalt hinein. (Kein Task-15-Regress: master/v0.4.0 verhalten sich identisch.)
  //
  // Deshalb: findet sich keine eigene GUID, zählen die dekodierbaren GUIDs der
  // Fremd-Siblings. Bewusst ALLE, nicht nur die Tie-Break-Gewinnerin:
  //   - Der Schlüssel ist (notePath, guid). Ein Tombstone auf eine Verlierer-GUID
  //     an DIESEM Pfad kann dieselbe Inkarnation unter einem anderen Pfad nicht
  //     treffen — der Schaden, den Fix A beseitigt hat, entsteht hier nicht.
  //   - Nur die Gewinnerin zu tombstonen risse die Lücke direkt wieder auf: ist
  //     deren Sidecar weg, wählt pickWinnerGuid schlicht die nächstkleinere
  //     verbliebene GUID, und der Adopt-Zweig belebt die Note darüber wieder.
  //   - Was hier liegt, hat unter diesem Pfad gelebt; der Nutzer hat den Pfad
  //     gelöscht. Split-Brain-Reste sind mehrere Leichen, nicht weniger.
  //
  // Rückgabe `null` heißt „Stand unbekannt" (transienter IO-Fehler) — der Aufrufer
  // setzt dann GAR KEINEN Tombstone, statt auf Halbwissen eine womöglich lebende
  // Inkarnation zu beerdigen. Das leere Array heißt „nachweislich keine GUID".
  async guidsToTombstone(notePath: string): Promise<string[] | null> {
    const mapped = this.guids.get(notePath);
    if (mapped) return [mapped];

    const ownPath = this.stateFilePath(notePath);
    try {
      const own = await this.readStateFile(ownPath);
      if (own?.guid) return [own.guid];

      const foreign = (await this.vault.listYjsFiles(notePath)).filter((p) => p !== ownPath);
      const guids = new Set<string>();
      for (const path of foreign) {
        const d = await this.readStateFile(path);
        if (d?.guid) guids.add(d.guid);
      }
      return [...guids];
    } catch {
      // Unlesbare Sidecar (SidecarReadError: EBUSY, offenes Handle) oder ein
      // fehlgeschlagenes Listing. Beides heißt „wir kennen den Stand nicht" und
      // darf NICHT als „keine GUID" durchgehen — sonst beerdigt ein transienter
      // IO-Fehler nichts, ein halb gelesenes Verzeichnis dagegen zu wenig.
      // Bewusst breit gefangen: hier gibt es keinen Fehler, bei dem ein Tombstone
      // die sicherere Antwort wäre. Das entspricht dem Vorverhalten von
      // `currentGuid` (Task-12-Kommentar dort).
      return null;
    }
  }

  // Pfade, unter denen die aktuell unter `notePath` geladene Inkarnation auf
  // diesem Gerät gelebt hat — der aktuelle Pfad zuerst, dann die Rename-Historie.
  // Der delete-Handler tombstont sie alle (Review C-1, siehe `priorPaths`).
  // Dedupliziert: ein Hin-und-Zurück-Rename (a → b → a) führte sonst zu einem
  // doppelten Tombstone-Write inklusive doppeltem saveSettings.
  incarnationPaths(notePath: string): string[] {
    return [...new Set([notePath, ...(this.priorPaths.get(notePath) ?? [])])];
  }

  // Note vergessen (delete-Handler): Doc + GUID-Map-Eintrag entfernen.
  disposeNote(notePath: string): void {
    this.guids.delete(notePath);
    this.abortedReads.delete(notePath);
    // Der Parkplatz ist der Zwilling von `abortedReads` (Text, der nur in der
    // `.md` lebt) und gehoert deshalb an dieselbe Stelle. Bliebe er stehen,
    // praegte ein spaeterer Fristablauf eine Inkarnation fuer eine geloeschte
    // Notiz.
    this.parked.delete(notePath);
    // Task 16: Die Datei ist weg; ihr letzter gesehener Inhalt beschreibt nichts
    // mehr.
    //
    // Runde 2 (Review F-4), Richtigstellung: Die ursprüngliche Begründung („sonst
    // wäre er die Diff-Basis einer gleichnamig NEU angelegten Note") hält NICHT
    // stand. Nach `disposeNote` ist der Doc verworfen und der eigene State weg;
    // eine gleichnamige Neuanlage läuft deshalb in den Adopt-Zweig von
    // `ensureDoc`, und dort wird die Basis gar nicht gelesen (`adopted ?
    // undefined`). Bleibt der eigene State ausnahmsweise liegen, baut `ensureDoc`
    // den Doc aus ihm neu auf — und der ist genau der zuletzt gesehene .md-Text,
    // die Basis also identisch. Es gibt folglich keinen erreichbaren Pfad, auf dem
    // dieses `delete` das Ergebnis ändert; eine Mutationsprobe (Zeile entfernt,
    // volle Suite) bleibt grün.
    //
    // Die Zeile bleibt trotzdem stehen: sie hält die Aufräum-Symmetrie zu
    // `guids`/`abortedReads`/`priorPaths`/`ownSignatures` in dieser Methode, und
    // ein Eintrag, der eine gelöschte Datei beschreibt, ist Ballast, sobald ein
    // künftiger Pfad `ensureDoc` doch mit `adopted === false` erreicht.
    this.localDiffBase.delete(notePath);
    // Die Inkarnation ist tot; ihre Pfad-Historie hat keinen Adressaten mehr.
    // (Der delete-Handler hat sie vorher über incarnationPaths ausgelesen.)
    this.priorPaths.delete(notePath);
    // Task 14: Die Signatur beschreibt eine Datei, die es nicht mehr gibt.
    this.ownSignatures.delete(this.stateFilePath(notePath));
    this.crdtManager.disposeDoc(notePath);
  }

  // Rename: gleiche Inkarnation, GUID bleibt erhalten — Map-Eintrag umziehen.
  //
  // Szenariosuche F3: Der Doc wird MITGENOMMEN statt verworfen. Früher wurde er
  // verworfen und beim nächsten Zugriff aus den (bereits umbenannten) .yjs unter
  // dem neuen Pfad neu aufgebaut — das setzte voraus, dass der Dateiumzug im
  // rename-Handler vollständig gelungen ist. Genau der kann scheitern (Details in
  // `CrdtManager.renameDoc` und im Handler). Nebenbei behoben: Ein Rename nach
  // einem gescheiterten `saveState` warf den nur im Doc lebenden Stand weg.
  renameNote(oldPath: string, newPath: string): void {
    const guid = this.guids.get(oldPath);
    this.guids.delete(oldPath);
    if (guid) this.guids.set(newPath, guid);
    // Eine offene „lokaler Edit nicht erfasst"-Markierung zieht mit um.
    const uncaptured = this.abortedReads.get(oldPath);
    this.abortedReads.delete(oldPath);
    if (uncaptured !== undefined) this.abortedReads.set(newPath, uncaptured);

    // Wie `abortedReads`: Der geparkte Stand gehoert zur NOTIZ, nicht zum Pfad.
    // Bliebe er auf dem alten Pfad, liefe ein Fristablauf dort ins Leere — die
    // `.md` und die Hilfsdateien sind laengst umgezogen.
    const geparkt = this.parked.get(oldPath);
    this.parked.delete(oldPath);
    if (geparkt !== undefined) this.parked.set(newPath, geparkt);
    // Task 16: Der Inhalt zieht beim Rename mit — es ist dieselbe Datei unter neuem
    // Namen. Bliebe der Eintrag auf dem alten Pfad, wäre die Basis unter dem neuen
    // Pfad leer und fiele auf den Doc-Text zurück (der Vorlauf wäre wieder blind).
    const seen = this.localDiffBase.get(oldPath);
    this.localDiffBase.delete(oldPath);
    if (seen !== undefined) this.localDiffBase.set(newPath, seen);
    // Review C-1: Pfad-Historie der Inkarnation mitziehen. Bewusst unabhängig
    // davon, ob oben eine GUID gefunden wurde — sie steht oft erst im Header der
    // Sidecar und wird erst vom delete-Handler (currentGuid) aufgelöst. Wer die
    // Historie an eine bekannte GUID knüpfte, verlöre genau die Renames, die vor
    // dem ersten Doc-Zugriff passieren.
    // Review F-4: beim Anhängen deduplizieren. Ein Ping-Pong `a→b→a→b…` legte die
    // Liste sonst linear in der Länge der Rename-Folge an, obwohl der Inhalt zwei
    // Einträge hat; geräumt wird erst mit `disposeNote`.
    const prior = this.priorPaths.get(oldPath) ?? [];
    this.priorPaths.delete(oldPath);
    this.priorPaths.set(newPath, [...new Set([...prior, oldPath])]);
    // Task 14 (Review I-1): Die Sidecar wandert im rename-Handler am SyncHandler
    // vorbei mit (kein saveState) — die Signatur des alten Pfads beschreibt danach
    // eine Datei, die dort nicht mehr liegt. Bliebe sie stehen, träfe sie nach einem
    // Rename ZURÜCK auf die inzwischen editierte Datei: Rename erhält mtime und
    // size, der Byte-Vergleich schlägt fehl → erfundene Kollision. Signatur des
    // neuen Pfads ebenfalls verwerfen: dort liegen jetzt fremde (= unsere alten)
    // Bytes, für die wir nie eine Signatur geschrieben haben. Löschen genügt in
    // beiden Fällen — die nächste Sichtung setzt eine frische Baseline.
    this.ownSignatures.delete(this.stateFilePath(oldPath));
    this.ownSignatures.delete(this.stateFilePath(newPath));
    this.crdtManager.renameDoc(oldPath, newPath);
  }

  // Löscht eine Sidecar, falls vorhanden (Ersatz für das frühere
  // getAbstractFileByPath-if(file)-delete-Muster über den Adapter).
  private async removeSidecar(path: string): Promise<void> {
    // Frischer Existenz-Check: eine stale „existiert nicht"-Antwort ließe eine
    // getombstonte/Legacy-Leiche liegen (Löschen bleibt auf dem Adapter).
    if (await sidecarExists(this.vault.adapter, path)) await this.vault.adapter.remove(path);
  }

  async saveState(notePath: string): Promise<void> {
    let guid = this.guids.get(notePath);
    if (!guid) {
      guid = generateGuid();
      this.guids.set(notePath, guid);
    }
    const update = this.crdtManager.encodeState(notePath);
    const state = encodeStateFile(guid, update);
    const stateFile = this.stateFilePath(notePath);
    // Resave-Loop-Schutz: writeBinary bumpt die mtime auch bei byte-identischem
    // State. Schreibt loadAndMerge/saveState nach einer Konvergenz unbedingt, sieht
    // der Peer-Poll den mtime-Bump → merge → resave → … (endloser 30s-Zyklus
    // zwischen konvergierten Peers, Sync-Churn, .yjs-Konfliktkopien). Deshalb: nur
    // schreiben, wenn sich die encodierten Bytes vom Disk-Stand unterscheiden.
    if (await this.sidecarBytesEqual(stateFile, state)) {
      // Der Disk-Stand IST unser Stand — Signatur trotzdem auffrischen, sonst
      // hinge die Kollisionserkennung an einer veralteten mtime.
      await this.rememberOwnSidecar(stateFile, state);
      this.unpersisted.delete(notePath);
      return;
    }
    // Task 14: Das Schreibfenster ausnehmen, damit ein parallel laufender Poll den
    // halb geschriebenen eigenen Stand nicht als fremden Schreiber liest.
    this.writingSidecars.add(stateFile);
    try {
      await ensureSidecarFolder(this.vault.adapter, dirname(stateFile));
      // adapter.writeBinary legt an ODER überschreibt in einem Aufruf — kein
      // create/modify-Split und kein Race-Fallback mehr nötig (der frühere,
      // index-basierte Split war in echten Vaults ein Silent-No-Op).
      await this.vault.adapter.writeBinary(stateFile, state);
      await this.rememberOwnSidecar(stateFile, state);
      this.unpersisted.delete(notePath);
    } catch {
      // Task 17/F-6: Der Write ist gescheitert (OneDrive hält ein Handle, Pfad zu
      // lang, Volume voll). Bisher verließ der Wurf `saveState` ungefiltert und
      // endete als unbehandelte Promise im modify-Handler bzw. im leeren `catch`
      // des Sweeps: keine Markierung, kein Zähler, keine Notice, kein Retry.
      //
      // Nicht weiterwerfen: der Doc trägt den Stand, alles nach `saveState`
      // (Legacy-Cleanup, `abortedReads`-Freigabe, Diff-Basis) ist korrekt und
      // würde sonst übersprungen — ein Wurf hier ließe also mehr kaputt als er
      // meldet. Stattdessen markieren, melden und den nächsten Trigger den Write
      // wiederholen lassen. Das ist der minimale Rückkanal, kein Retry-Scheduler.
      this.unpersisted.add(notePath);
      this.onUnwritableFile?.(stateFile);
    } finally {
      this.writingSidecars.delete(stateFile);
    }
  }

  // Merkt sich, was wir zuletzt unter dem eigenen Pfad abgelegt haben (Task 14).
  private async rememberOwnSidecar(path: string, bytes: Uint8Array): Promise<void> {
    const stat = await statSidecar(this.vault.adapter, path).catch(() => null);
    this.ownSignatures.set(path, {
      mtime: stat?.mtime ?? 0,
      size: stat?.size ?? bytes.length,
      hash: hashBytes(bytes),
    });
  }

  // True, wenn die Sidecar existiert und byteweise identisch mit bytes ist.
  // Lese-/Decode-Fehler oder Nichtexistenz → false (dann normal schreiben).
  private async sidecarBytesEqual(path: string, bytes: Uint8Array): Promise<boolean> {
    try {
      const buffer = await readSidecar(this.vault.adapter, path);
      if (buffer === null) return false;
      const disk = new Uint8Array(buffer);
      if (disk.length !== bytes.length) return false;
      for (let i = 0; i < bytes.length; i++) {
        if (disk[i] !== bytes[i]) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readStateFile(path: string): Promise<DecodedSibling | null> {
    // Task 12/F-1: readSidecar liest cache-frei (Desktop: direkt am Dateisystem)
    // und trennt „existiert nachweislich nicht" (null) von „unlesbar" (wirft).
    // Der frühere adapter.exists-Vorabcheck ist damit weg — er lief über dieselbe
    // verzögerte Sicht und konnte eine frisch gelistete Datei wieder wegvetoen.
    let buffer: ArrayBuffer | null;
    try {
      buffer = await readSidecar(this.vault.adapter, path);
    } catch {
      // Read-Fehler ist transient (IO) → der Aufrufer bricht ab. NICHT als
      // „existiert nicht" durchreichen.
      this.onUnreadableFile?.(path);
      throw new SidecarReadError(path);
    }
    if (buffer === null) return null;
    // R2: Decode-Fehler (leere/trunkierte Datei) = korrupt → überspringen.
    try {
      const { guid, update } = decodeStateFile(new Uint8Array(buffer));
      return { path, guid, update };
    } catch {
      this.onCorruptFile?.(path);
      return null;
    }
  }

  // Dekodiert Sibling-Pfade und wendet die Tombstone- und Legacy-Regeln an:
  //   C.3: Eine für DIESEN Pfad getombstonte GUID → Datei als stale Leiche
  //        löschen und ausschließen. Der Tombstone gilt seit Task 15 pro Paar
  //        (notePath, guid), deshalb braucht die Prüfung den Pfad.
  //   R1:  Legacy-Dateien (v0.1) dienen nur dem Erst-Import. Existiert unter den
  //        übergebenen Pfaden mindestens ein GUID-tragender Sidecar, werden sie
  //        ignoriert und gelöscht.
  //
  // Task 17/F-1: „Legacy" verlangt einen POSITIVEN Nachweis, nicht mehr den
  // Negativbefund „trägt keine GUID". `hasMagic` (state-file.ts) liefert für jede
  // Datei unter 20 Byte `false` — auch für 0 Byte —, und `decodeStateFile` meldet
  // dann `guid: null`. Damit galt jede unvollständig materialisierte Fremd-Datei
  // als v0.1-Leiche und wurde von der Platte gelöscht; der bidirektionale Sync
  // trug die Löschung zurück und vernichtete dort den echten State. Auslöser sind
  // real (fehlgeschlagene OneDrive-Hydrierung, abgebrochener Transfer,
  // Sicherheitssoftware), und die Asymmetrie war das eigentliche Ärgernis: eine
  // Datei AB 20 Byte mit kaputtem Inhalt wurde schonend behandelt (übersprungen,
  // `onCorruptFile`), die harmlosere darunter gelöscht.
  //
  // Der Nachweis läuft über die PFADFORM, nicht über den Inhalt: v0.1 schrieb
  // `.qollab/<note>.yjs` ohne clientId-Segment (`legacyFilePath`). Das clientId-
  // Segment und der QLB1-Header kamen gemeinsam in v0.4.0 (Commit `9095f3c` ist in
  // keinem Tag außer `v0.4.0` enthalten, und der trägt auch `e2dd21c`) — eine
  // Datei mit gültigem `<8-hex>.yjs`-Namen ohne Header ist deshalb NIE eine
  // v0.1-Datei, sondern unfertig oder korrupt. Zusätzlich muss der Inhalt als
  // Yjs-Update lesbar sein, sonst ist auch eine Datei in Legacy-Pfadform nur
  // „Stand unbekannt". Alles ohne Nachweis: überspringen, melden, NIE löschen.
  //
  // Damit erübrigt sich der `ownPath`-Schutz, den der Tombstone-Zweig unten trägt:
  // `ownPath` hat per Konstruktion ein clientId-Segment und kann den Legacy-Zweig
  // nicht mehr erreichen. Kein toter Vergleich, sondern eine stärkere Zusage.
  //
  // Die frühere Begründung, die eigene Datei könne nie fälschlich gelöscht werden
  // („die eigene GUID landet nie im Tombstone-Set"), war nachweislich falsch: ein
  // sync-vermittelter Rename stellt eine Umbenennung als delete+create zu und
  // tombstont damit eine LEBENDE Inkarnation, und im Adopt-Zweig hängt dieselbe
  // GUID ohnehin an mehreren Pfaden. Stattdessen gilt hart: über den
  // Tombstone-Zweig wird die eigene Sidecar nie gelöscht, nur vom Ergebnis
  // ausgeschlossen (siehe unten).
  private async decodeSiblings(notePath: string, paths: string[]): Promise<DecodedSibling[]> {
    // Alle Dateien lesen, dann in einem zweiten Durchlauf entscheiden.
    const decoded: Array<DecodedSibling | null> = [];
    for (const path of paths) {
      decoded.push(await this.readStateFile(path));
    }

    // R1: Prüfen ob mindestens ein GUID-tragender Sidecar existiert.
    const hasGuidState = decoded.some((d) => d !== null && d.guid !== null);

    const ownPath = this.stateFilePath(notePath);
    const legacyPath = this.legacyFilePath(notePath);
    const result: DecodedSibling[] = [];
    for (let i = 0; i < paths.length; i++) {
      const d = decoded[i];
      if (!d) continue;

      // Tombstone-Prüfung (C.3) — pfadgebunden (Task 15 Fix A).
      if (d.guid !== null && this.tombstones.has(d.guid, notePath)) {
        // Fix B: Die eigene Sidecar wird hier NIE gelöscht — sie ist unser
        // lebender State. Löschte man sie, legte der saveState am Ende desselben
        // Laufs sie sofort wieder an: Löschen-Neuschreiben-Schleife bei jedem
        // Trigger. Ausschließen genügt; ihr Stand steckt bereits im Doc
        // (ensureDoc hat ihn im own-Branch angewandt).
        if (paths[i] !== ownPath) await this.removeSidecar(paths[i]);
        continue;
      }

      if (d.guid === null) {
        // Task 17/F-1, Schritt 1 — INHALTS-Nachweis: Trägt die Datei keine
        // nachweisbare Yjs-Op, ist der Stand UNBEKANNT. Überspringen und melden
        // (die R2-Policy, die dieser Zweig bisher umging), aber nichts löschen und
        // nichts in den Merge nehmen. Task 17/R-1: „lesbar" war zu schwach —
        // nullgefüllte Puffer sind lesbar und leer (siehe carriesYjsOps).
        //
        // Task 19/A (Merge-Review M-1): Eine Ausnahme, und zwar genau eine. v0.1
        // rief `saveState` auch für eine NIE BEFÜLLTE Note; das Ergebnis ist der
        // leere State (`[0x00, 0x00]`, siehe isEmptyYjsState). Die Datei ist
        // gesund und vollständig — sie trägt nur nichts. Ohne die Ausnahme meldet
        // dieser Zweig sie als „beschädigt", und `cleanupLegacyFile` weigert sich
        // dauerhaft, sie abzuräumen: eine Falschmeldung pro Sitzung, unbegrenzt.
        //
        // Gebunden an die v0.1-PFADFORM, nicht nur an die Bytes: Das
        // clientId-Segment kam gemeinsam mit dem QLB1-Header (siehe die
        // Begründung oben), eine per-Client benannte 2-Byte-Datei kann deshalb
        // keine v0.1-Datei sein. Für sie bleibt es bei „Stand unbekannt" — sonst
        // wertete man eine unfertige Fremd-Datei als gültigen leeren Stand.
        const legitimatelyEmpty = paths[i] === legacyPath && isEmptyYjsState(d.update);
        if (!carriesYjsOps(d.update) && !legitimatelyEmpty) {
          this.onCorruptFile?.(paths[i]);
          continue;
        }
        // R1 (unverändert): ein nachgewiesen op-tragender headerloser State wird
        // ignoriert, sobald GUID-State existiert — sein Inhalt steckt dann bereits
        // darin. Ohne GUID-State bleibt es beim Erst-Import (unten mitgemergt).
        if (hasGuidState) {
          // Task 17/F-1, Schritt 2 — PFADFORM-Nachweis, und zwar erst vor dem
          // destruktiven Teil: Gelöscht wird ausschließlich die v0.1-Form ohne
          // clientId-Segment. Ein per-Client benannter headerloser Sidecar ist
          // keine v0.1-Datei — ihn zu löschen hieße, fremden State auf Verdacht zu
          // vernichten. Er wird nur ignoriert und bleibt liegen.
          if (paths[i] === legacyPath) await this.removeSidecar(paths[i]);
          continue;
        }
      }

      result.push(d);
    }
    return result;
  }

  // Bytewise/lexikografisch kleinste GUID gewinnt (deterministisch auf allen
  // Geräten). Legacy-Siblings (guid null) tragen keine GUID bei — sie sind mit
  // allem kompatibel. ownGuid ist immer Kandidat, wenn gesetzt.
  private pickWinnerGuid(
    siblings: DecodedSibling[],
    ownGuid: string | undefined
  ): string | undefined {
    let winner = ownGuid;
    for (const s of siblings) {
      if (s.guid === null) continue;
      if (winner === undefined || s.guid < winner) winner = s.guid;
    }
    return winner;
  }

  // Bootstrappt den Doc NIE aus dem .md-Text, immer aus persistiertem State und
  // etabliert dabei die GUID der Inkarnation.
  //   1. eigener State vorhanden → dessen Header-GUID übernehmen (Legacy → neue
  //      GUID), Update anwenden.
  //   2. sonst fremde Siblings adoptieren: getombstonte löschen, per Tie-Break
  //      die Gewinner-GUID bestimmen und alle kompatiblen (Gewinner-GUID +
  //      Legacy) mergen.
  //   3. gar nichts → neue GUID, leerer Doc (lazy).
  //
  // Rückgabe: true, wenn der Adopt-Zweig gelaufen ist UND dabei der lokale
  // .md-Text in den Doc vereinigt wurde. Der Aufrufer darf den .md-Text dann
  // nicht ein zweites Mal einspielen (siehe mergeForLocalDiff).
  private async ensureDoc(notePath: string): Promise<boolean> {
    if (this.crdtManager.hasDoc(notePath)) {
      if (!this.guids.has(notePath)) {
        const own = await this.readStateFile(this.stateFilePath(notePath));
        this.guids.set(notePath, own?.guid ?? generateGuid());
      }
      return false;
    }

    const own = await this.readStateFile(this.stateFilePath(notePath));
    // Task 17/F-1, zweite Schadensrichtung: Der own-Branch lief bisher für JEDE
    // vorhandene eigene Datei — auch für eine 0-Byte-Datei. `applyUpdate` warf,
    // wurde gefangen, und `own.guid ?? generateGuid()` prägte eine FRISCHE
    // Inkarnation über eine lebende Historie: Spaltung, danach Tie-Break und
    // `unionMerge` ohne gemeinsamen Vorfahren, also doppelte Zeilen in der Note.
    // Bedingung ist jetzt derselbe positive Nachweis wie in `decodeSiblings` —
    // GUID im Header ODER headerloser State mit nachweisbaren Ops (v0.1-Migration:
    // der bekommt wie dokumentiert eine frische GUID, sein Inhalt ist ja gerettet).
    // Task 17/R-1: Auch hier reicht „parst" nicht — eine nullgefüllte eigene
    // Sidecar nahm sonst diesen Zweig, `applyUpdate` gelang als No-op und
    // `own.guid ?? generateGuid()` prägte die Spaltung, die der Fix verhindern soll.
    if (own && (own.guid !== null || carriesYjsOps(own.update))) {
      // Halb angekommene eigene Sidecar: Kopf (`QLB1` + GUID) vollständig,
      // Nutzlast abgeschnitten — Stromausfall im Write, halb materialisierter
      // Sync-Download, abgebrochener NTFS-Extend. Weil die GUID in der Bedingung
      // oben VORNE im ODER steht, wird dieser Zweig allein wegen des intakten
      // Kopfes genommen; die Nutzlast wird nie beurteilt.
      //
      // Früher wurde der Wurf hier nur gemeldet und dann weitergemacht. Das war
      // der Schadensweg, gemessen: Der Doc ist nach dem gescheiterten
      // `applyUpdate` LEER, bekommt unten aber die GUID der echten Inkarnation —
      // ein leerer Doc gibt sich als lebende Historie aus. (1) Der nächste lokale
      // Diff nimmt ihn als Basis und materialisiert den GESAMTEN Notiztext als
      // EIGENE Ops. (2) Liefert der Sync dieselbe Datei später vollständig nach,
      // ist sie GUID-gleich, gilt als kompatibel und wird gemergt — Yjs
      // dedupliziert nach Item-ID, nicht nach Inhalt. Ergebnis: jede Zeile
      // zweimal.
      //
      // Ein unverwertbarer eigener Stand ist dasselbe wie ein abgebrochener
      // Lesevorgang: Der Aufrufer bricht ab, schreibt nichts zurück und wiederholt
      // beim nächsten Trigger; ist die Datei dauerhaft kaputt, meldet der
      // bestehende Rückkanal sie nach dem dritten Versuch. Lieber eine Notiz, die
      // bis zur Meldung nicht synct, als eine, die sich stillschweigend verdoppelt.
      //
      // `disposeDoc` gehört untrennbar dazu: `applyUpdate` legt den Doc an, BEVOR
      // es wirft, und integriert je nach Schnittstelle auch schon Structs. Bliebe
      // dieser halbe Doc liegen, nähme der nächste Lauf den `hasDoc`-Zweig ganz
      // oben — der eigene State käme nie mehr über diesen Zweig in den Doc, der
      // lokale Diff liefe gegen einen leeren Vorstand, und die Verdopplung
      // entstünde erneut, nur eine Etage tiefer im 3-Wege-Merge (gemessen).
      // Verworfen wird dabei ausschließlich der Doc, den dieser Aufruf selbst
      // erzeugt hat: ein vorhandener wäre oben schon zurückgekehrt.
      try {
        this.crdtManager.applyUpdate(notePath, own.update);
      } catch {
        this.crdtManager.disposeDoc(notePath);
        this.onCorruptFile?.(own.path);
        throw new SidecarReadError(own.path);
      }
      this.guids.set(notePath, own.guid ?? generateGuid());
      return false;
    }
    if (own) {
      // Nicht lesbar und ohne Header → „Stand unbekannt". Behandeln, als gäbe es
      // keinen eigenen State: der Adopt-Zweig unten übernimmt die GUID der
      // lebenden Fremd-Inkarnation, statt eine zu erfinden. Der Text ist dabei
      // nicht in Gefahr — er liegt in der `.md` und wird dort vereinigt. Erst wenn
      // es gar nichts zu adoptieren gibt, entsteht eine neue GUID; dann gibt es
      // aber auch keine Inkarnation, von der sie sich abspalten könnte.
      this.onCorruptFile?.(own.path);
    }

    const ownPath = this.stateFilePath(notePath);
    const foreign = await this.decodeSiblings(
      notePath,
      (await this.vault.listYjsFiles(notePath)).filter((p) => p !== ownPath)
    );
    const winner = this.pickWinnerGuid(foreign, undefined);
    this.guids.set(notePath, winner ?? generateGuid());
    this.mergeCompatible(notePath, foreign);
    // Task 20: Beim Adoptieren gewinnt genau eine fremde Kette; liegen mehrere
    // getrennt entstandene vor, werden die übrigen hier endgültig verworfen.
    this.reportDiscarded(notePath, foreign);

    // Adopt-Fall (KEIN eigener State): Nach dem Adoptieren der fremden Basis den
    // lokalen .md-Text als Diff einspielen — analog zu switchToGuid. Asymmetrie
    // zum own-Branch: OHNE eigenen State ist die .md der EINZIGE Träger lokaler
    // Daten; würde sie nicht eingediffed, überschriebe der loadAndMerge-Write-Back
    // die (nie erfasste) lokale Note mit dem reinen Fremd-Stand → dauerhafter
    // lokaler Datenverlust bei frischen kollaborativen Setups. MIT eigenem State
    // sind lokale Edits dagegen bereits im CRDT erfasst; die .md darf in
    // loadAndMerge dann NICHT re-injiziert werden (würde ankommende Remote-Edits
    // zurückrollen) — deshalb sitzt dieser Diff ausschließlich hier im Adopt-Zweig.
    //
    // Task 13/A: Der lokale Text wird VEREINIGT statt als 2-Wege-Diff eingespielt.
    // `setContent(mdText)` zwang den frisch adoptierten Doc exakt auf die lokale
    // Datei — adoptierter Fremd-Inhalt, den die .md (noch) nicht kannte, wurde
    // dabei gelöscht, inklusive Delete-Ops, die den Verlust über den nächsten
    // Merge zum Peer zurücktragen. Zwischen der fremden Inkarnation und dem
    // lokalen Dateistand gibt es keinen gemeinsamen Vorfahren → unionMerge
    // (Details dort). Damit entfällt auch das frühere transiente Zurückrollen
    // fremder Edits durch eine veraltete .md.
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return false;
    const mdText = this.lokalerZeuge(notePath, await this.vault.read(file));
    this.crdtManager.setContent(
      notePath,
      this.unite(notePath, this.crdtManager.getContent(notePath), mdText)
    );
    return true;
  }

  // Task 20: Meldet EINMAL, wenn unter den Siblings eine Fassung liegt, die
  // gerade endgültig verworfen wurde — abweichende Kennung und tatsächlich
  // Operationen an Bord.
  //
  // Bewusst NICHT in `mergeCompatible` selbst: die Funktion läuft auch aus
  // `mergePendingForeign` (modify-Pfad), und dort ist das Übergehen einer
  // fremden Kennung ausdrücklich vorläufig — der Tie-Break entscheidet erst im
  // Poll. Eine Meldung dort wäre ein Fehlalarm für eine Lage, die sich Sekunden
  // später von selbst auflöst (und die dann `onUnrelatedMerge` korrekt meldet).
  //
  // `carriesYjsOps` ist die zweite Engführung: Eine leere oder halb
  // materialisierte Datei trägt nichts, was verloren gehen könnte. Ohne diese
  // Prüfung meldete jede 0-Byte-Sidecar aus dem OneDrive-Hauptauslöser einen
  // Verlust, den es nicht gibt.
  private reportDiscarded(notePath: string, siblings: DecodedSibling[]): void {
    if (!this.onDiscardedIncarnation) return;
    const guid = this.guids.get(notePath);
    const eigenerText = this.crdtManager.getContent(notePath);
    for (const s of siblings) {
      if (s.guid === null || s.guid === guid) continue;
      if (!carriesYjsOps(s.update)) continue;
      // Dritte Engführung (Nachtrag aus der Szenariosuche): Operationen zu tragen
      // heisst nicht, dass uns etwas fehlt. Beim Erstkontakt ist der Regelfall
      // sogar, dass beide Geräte denselben `.md`-Text als je eigene Kette
      // materialisiert haben — dann ist nichts verloren, und eine Meldung
      // „bitte von Hand übertragen" führte geradewegs zur Dopplung.
      //
      // Die Verlierer-Seite stellt dieselbe Frage längst (`switchToGuid`:
      // `winnerText === localText` → kein `unite`); hier fehlte sie. Gemessen
      // wird mit derselben Vereinigung, die auch den Merge macht: Fügt der
      // fremde Text unserem Stand nichts hinzu, gibt es nichts zu melden.
      const fremderText = textFromUpdate(s.update);
      if (unionMerge(eigenerText, fremderText) === eigenerText) continue;
      // Eine Meldung je Vorgang, nicht je verworfener Datei: Für den Nutzer ist
      // die Aussage „von dieser Notiz gibt es eine andere Fassung" — wie viele
      // Geräte daran hängen, ändert daran nichts.
      this.onDiscardedIncarnation(notePath, s.guid);
      return;
    }
  }

  // Merged alle Siblings, deren GUID der aktuellen entspricht oder die Legacy
  // (null) sind. Fremde, nicht getombstonte Verlierer-GUIDs werden ignoriert.
  // R2: korrupte Updates (ungültige Yjs-Bytes) werden pro Sibling gefangen;
  // der Gesamtmerge läuft mit den verbleibenden validen Siblings weiter.
  private mergeCompatible(notePath: string, siblings: DecodedSibling[]): void {
    const guid = this.guids.get(notePath);
    for (const s of siblings) {
      if (s.guid === null || s.guid === guid) {
        try {
          this.crdtManager.applyUpdate(notePath, s.update);
        } catch {
          this.onCorruptFile?.(s.path);
        }
      }
    }
  }

  // C.4 Verlierer-Fall: eigene Historie verwerfen, auf die Gewinner-Inkarnation
  // wechseln. Aktuellen .md-Text merken, Doc verwerfen, aus den Gewinner-GUID-
  // Siblings neu aufbauen, GUID setzen, gemerkten .md-Text als Diff einspielen.
  private async switchToGuid(
    notePath: string,
    winner: string,
    siblings: DecodedSibling[]
  ): Promise<void> {
    // Fehlt die .md (z.B. extern gelöscht bei geschlossener App, danach triggert
    // eine kleinere fremde GUID den Tie-Break), dürfen wir die eigene Historie
    // NICHT verwerfen: disposeDoc + setContent('') würde den Doc leeren und
    // dieser leere Stand als delete-all auf andere Geräte propagieren
    // (Cross-Device-Datenverlust). Ohne aktuellen Text keine Konvergenz erzwingen
    // — eigene Inkarnation behalten und verschieben, bis die .md wieder da ist.
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return;
    const mdText = this.lokalerZeuge(notePath, await this.vault.read(file));
    // Task 13/A: Den lokalen Stand VOR dem Verwerfen sichern — Doc UND .md. Der
    // Doc kann der Datei voraus sein (bereits gemergter, noch nicht
    // zurückgeschriebener Stand) und die Datei dem Doc (externer Edit).
    // Task 19/C, bewusst NICHT über `unite`: Doc und `.md` sind hier beide der
    // lokale Stand DIESES Geräts — der Doc dem Text voraus, oder der Text dem Doc
    // (externer Edit). Das ist kein Aufeinandertreffen zweier Ketten, sondern das
    // Zusammenlegen der eigenen. Gemeldet wird erst die Vereinigung mit der
    // fremden Kette unten.
    const localText = unionMerge(this.crdtManager.getContent(notePath), mdText);
    this.crdtManager.disposeDoc(notePath);
    this.guids.set(notePath, winner);
    // Review F-2: Die Pfad-Historie beschreibt die Renames der JETZT aufgegebenen
    // Inkarnation — die Gewinnerin hat unter den alten Pfaden nie gelebt. Bliebe
    // sie stehen, tombstonte ein späteres Delete `(alterPfad, winner)` und räumte
    // dort eine fremde Sidecar der Gewinner-GUID fälschlich ab. Genau das
    // Falsch-Positiv, das Fix A beseitigt hat.
    this.priorPaths.delete(notePath);
    for (const s of siblings) {
      if (s.guid === winner) {
        // R2: Korrupte Gewinner-Sidecars überspringen statt den Switch abzubrechen.
        try {
          this.crdtManager.applyUpdate(notePath, s.update);
        } catch {
          this.onCorruptFile?.(s.path);
        }
      }
    }
    // Task 18 — HASH-GATE. Sind der Gewinner-Doc und der lokale Stand hier
    // byte-identisch, gibt es nichts zu vereinigen: der Wechsel ist verlustfrei,
    // der Doc trägt danach ausschließlich Gewinner-Ops, und genau das ist die
    // gewünschte Lage. Jede eigene Op, die wir stattdessen einbrächten, wäre eine
    // zweite Kette für denselben Text — und die ist nach Task 18/Teil 1 die
    // Ursache der Erstkontakt-Verdopplung (Yjs dedupliziert nach Item-ID, nicht
    // nach Inhalt; sichtbar wird sie erst beim nächsten `mergeCompatible`).
    // Dieselbe Prüfung haben vier Systeme unabhängig erfunden: synch
    // (`hashMatches`), obsidian-livesync (`isSame`), Relay (`remapIfHashMatches`),
    // Git über den Blob-SHA.
    //
    // WIRKUNG, gemessen statt vermutet: keine. `unionMerge` gibt bei Gleichheit
    // den Eingabestand unverändert zurück, und `setContent` bricht bei
    // `current === content` vor der ersten Op ab — beide Kurzschlüsse zusammen
    // taten das hier bereits. Die gepaarte Fuzz-Messung (40 Seeds × 3 Modi) ist
    // vorher wie nachher identisch, und die Tests in `hash-gate.test.ts` sind
    // auch ohne diese Zeilen grün. Sie stehen trotzdem hier, weil die Invariante
    // damit an ihrem Ort steht statt als Nebenwirkung zweier fremder Guards: wer
    // künftig einen dieser Kurzschlüsse anfasst, bricht sie sonst still.
    //
    // NICHT übersprungen wird der `saveState` des Aufrufers. Der Doc hat die
    // Inkarnation gewechselt, unsere eigene Sidecar trägt aber noch die
    // aufgegebene GUID; bliebe sie stehen, baute `ensureDoc` beim nächsten Start
    // die tote Inkarnation aus ihr wieder auf, und bis dahin bewürbe unsere Datei
    // eine GUID, gegen die andere Geräte weiter Tie-Breaks fahren. Der Write ist
    // also der Preis des Wechsels, nicht der überflüssige Schreibvorgang, den ein
    // Gate einsparen könnte (Gegenprobe in `hash-gate.test.ts`).
    const winnerText = this.crdtManager.getContent(notePath);
    if (winnerText === localText) return;

    // Task 13/A: Früher `setContent(mdText)` — ein 2-Wege-Diff, der den frisch
    // aufgebauten Gewinner-Doc exakt auf die lokale Datei zwang. Inhalt, der nur
    // im Verlierer-Doc lebte, verschwand ersatzlos; Gewinner-Inhalt, den die
    // lokale .md noch nicht kannte, wurde als DELETE-Op geschrieben und über den
    // nächsten Merge zum Gewinner zurückpropagiert (Realtest S05: 10/10
    // divergent). Beide Inkarnationen haben keinen gemeinsamen Vorfahren →
    // unionMerge. Auf Op-Ebene bleibt der Wechsel prinzipbedingt verlustbehaftet:
    // der lokale Beitrag zählt danach als frische Einfügung dieses Geräts.
    this.crdtManager.setContent(notePath, this.unite(notePath, winnerText, localText));
  }

  // Pfad der clientId-losen Legacy-Datei (v0.1-Ära).
  private legacyFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.yjs`;
  }

  // R1: Löscht die Legacy-Datei (v0.1-Form ohne clientId-Segment) einer Note, falls
  // sie noch existiert. Wird nach saveState aufgerufen: zu dem Zeitpunkt existiert
  // GUID-tragender State, sodass die Legacy-Datei nicht mehr gebraucht wird.
  //
  // Task 17/F-1: Gelöscht wird nur bei positivem Nachweis — die Datei muss
  // nachweisbare Yjs-Ops tragen (Task 17/R-1: „lesbar" genügte nicht, siehe
  // carriesYjsOps). Sonst räumte genau dieser Aufruf die 0-Byte- bzw.
  // nullgefüllte Fassung einer noch nicht hydrierten v0.1-Datei ab, hinter dem
  // Rücken des Guards in `decodeSiblings`. Kein zusätzlicher IO im Normalfall:
  // existiert keine Legacy-Datei (der Regelfall), bleibt es beim einen `stat`.
  private async cleanupLegacyFile(notePath: string): Promise<void> {
    // Szenariosuche 2026-07-31: Nur aufräumen, wenn der eigene State auch
    // wirklich auf der Platte liegt. `saveState` schluckt Schreibfehler bewusst
    // (Task 17/F-6) und kehrt normal zurück — die Vorbedingung oben („zu dem
    // Zeitpunkt existiert GUID-tragender State") gilt dann nicht. Ohne diesen
    // Guard löschte der nächste Schritt die Legacy-Datei, obwohl sie der letzte
    // verbliebene Träger der Historie war; die Löschung wandert über den
    // Datei-Sync auch noch zum zweiten Gerät.
    if (this.unpersisted.has(notePath)) return;
    const path = this.legacyFilePath(notePath);
    let buffer: ArrayBuffer | null;
    try {
      buffer = await readSidecar(this.vault.adapter, path);
    } catch {
      return; // unlesbar → Stand unbekannt, liegen lassen
    }
    if (buffer === null) return;
    const { guid, update } = decodeStateFile(new Uint8Array(buffer));
    // Task 19/A: Dieselbe Ausnahme wie in `decodeSiblings` — der Pfad IST hier
    // per Konstruktion die v0.1-Form. Eine nie befüllte v0.1-Note hinterlässt den
    // leeren State; er trägt nichts, was noch zu importieren wäre, und ist ab dem
    // eigenen GUID-State genauso obsolet wie ein gefüllter.
    if (guid !== null || !(carriesYjsOps(update) || isEmptyYjsState(update))) return;
    await this.vault.adapter.remove(path);
  }

  // Review I-3: Entscheidungsgrundlage für den Startup-Sweep — könnte ensureDoc
  // für diese Note eine FREMDE Inkarnation adoptieren? Bewusst über dieselbe
  // decodeSiblings-Kette wie ensureDoc (Tombstone-, Legacy- und Korrupt-Regeln
  // inklusive), damit Sweep und Adoption nicht auseinanderdriften.
  //
  // Reine Datei-Existenz genügt nicht: eine korrupte oder halb kopierte Sidecar
  // (Sync-Dienst schreibt gerade — der von Task 12 belegte Realfall), eine
  // getombstete oder eine reine Legacy-Datei liefert KEINE GUID. pickWinnerGuid
  // gäbe dann `undefined` zurück und ensureDoc prägte genau die frische
  // Inkarnation, die Fix B verhindern soll (Split-Brain durch die Hintertür).
  // Deshalb: adoptierbar = mindestens ein Sibling mit dekodierbarer GUID.
  //
  // Legacy-Dateien fallen bewusst NICHT darunter: ihr Erst-Import bleibt Sache
  // des Watchers (er triggert auch auf die Legacy-Form), der ihn mit vorhandener
  // .md über loadAndMerge fährt — der Sweep muss dafür nicht blind prägen.
  // Nebeneffekt wie in ensureDoc: getombstete und obsolete Legacy-Dateien werden
  // dabei aufgeräumt.
  //
  // Task 19/B (Hebel 3): `cache` bündelt die Verzeichnis-Listings eines
  // Sweep-Durchlaufs. Nur diese ENTSCHEIDUNG wird daraus bedient; der
  // Arbeitspfad darunter (ensureDoc, loadAndMerge, mergePendingForeign) listet
  // unverändert frisch — er mutiert Zustand und darf das nie auf einer
  // gepufferten Sicht tun.
  async hasAdoptableGuid(notePath: string, cache?: DirListingCache): Promise<boolean> {
    const ownPath = this.stateFilePath(notePath);
    const foreign = (await this.vault.listYjsFiles(notePath, cache)).filter((p) => p !== ownPath);
    if (foreign.length === 0) return false;
    try {
      return (await this.decodeSiblings(notePath, foreign)).some((s) => s.guid !== null);
    } catch (err) {
      // Unlesbare Sidecar (transienter IO-Fehler): Stand unbekannt → im Zweifel
      // NICHT prägen, der nächste Sweep/Trigger entscheidet erneut.
      if (err instanceof SidecarReadError) return false;
      throw err;
    }
  }

  // Zieht ausstehende KOMPATIBLE Fremd-Sidecars (gleiche/legacy GUID) in den Doc
  // ein — reine mergeCompatible-Semantik, KEIN Tie-Break. Split-Brain (fremde
  // Gewinner-GUID, switchToGuid) bleibt ausschließlich Sache von loadAndMerge; hier
  // werden Verlierer-/Fremd-GUIDs bewusst ignoriert. Idempotent: bereits gemergte
  // Siblings (z.B. im Adopt-Zweig von ensureDoc) werden nach Item-ID dedupliziert.
  private async mergePendingForeign(notePath: string): Promise<void> {
    const yjsFiles = await this.vault.listYjsFiles(notePath);
    if (yjsFiles.length === 0) return;
    const siblings = await this.decodeSiblings(notePath, yjsFiles);
    this.mergeCompatible(notePath, siblings);
  }

  // Bringt eine lokale .md-Änderung in den CRDT.
  //
  // Task 12: Wirft dabei das LESEN einer Sidecar (transienter IO-Fehler), wird der
  // Lauf abgebrochen — ohne setContent, ohne saveState. Der Doc kennt den Fremd-
  // Stand dann nicht, und genau deshalb darf der .md-Diff nicht laufen: er würde
  // die unsichtbare Fremd-Op als eigene erfinden.
  //
  // Fix-Runde (Review F-2b): Der lokale Edit lebt danach NUR in der .md — es gibt
  // keinen Trigger, der ihn von selbst nachholt (loadAndMerge injiziert den
  // .md-Text im own-Branch bewusst nicht). Deshalb wird die Note als
  // `abortedReads` markiert; onRemoteYjsUpdate holt den Lauf vor einem Write-Back
  // nach und schreibt gar nicht, solange die Markierung steht. Das ist der
  // minimale Rückkanal, kein Re-Queue-Mechanismus.
  async applyLocalContent(notePath: string, content: string): Promise<string | undefined> {
    let finalText: string;
    try {
      finalText = await this.mergeForLocalDiff(notePath, content);
    } catch (err) {
      if (err instanceof SidecarReadError) {
        this.abortedReads.set(notePath, content);
        return undefined;
      }
      throw err;
    }
    this.crdtManager.setContent(notePath, finalText);

    await this.saveState(notePath);
    // R1: Eigener GUID-State ist jetzt geschrieben — Legacy-Datei aufräumen.
    await this.cleanupLegacyFile(notePath);
    // Lokaler Stand ist erfasst und persistiert — Markierung fällt weg.
    this.abortedReads.delete(notePath);
    // Task 16: `content` IST der .md-Inhalt (der Aufrufer hat ihn gerade gelesen)
    // und bleibt es — dieser Pfad schreibt die Datei nicht. Damit ist er die Basis
    // des nächsten lokalen Diffs, auch wenn `finalText` dem Doc einen Fremd-Stand
    // hinzugefügt hat. Im Abbruch-Zweig oben bewusst NICHT gesetzt: dort ist nichts
    // erfasst, und der gemerkte alte Stand ist für den Nachholversuch die richtige
    // Basis. Ruft ein Aufrufer mit einem Text, der NICHT in der Datei steht
    // (onRemoteYjsUpdate, pending-Zweig), korrigiert sein Write-Back die Basis
    // unmittelbar danach über `noteLocalDiffBase`.
    this.localDiffBase.set(notePath, content);

    // Solange etwas geparkt ist, traegt die `.md` Text, den der Doc nicht kennt.
    // Zwei Folgen, beide zwingend:
    //   1. Der Parkplatz zieht auf den NEUEN Dateistand nach — sonst faende der
    //      Fristablauf spaeter einen veralteten Text vor und der eben erfasste
    //      Tastendruck stuende zweimal darin.
    //   2. KEIN Write-Back: Der Aufrufer wuerde den Doc-Stand in die Datei
    //      schreiben und damit genau den geparkten Text loeschen, den das Parken
    //      schuetzt. `content` zurueckzugeben heisst fuer jeden Aufrufer „die
    //      Datei ist der Stand, schreib nichts" — der Riegel sitzt damit an einer
    //      Stelle statt in jedem Aufrufer einzeln.
    const geparkt = this.parked.get(notePath);
    if (geparkt !== undefined) {
      this.parked.set(notePath, {
        text: content,
        ticks: geparkt.ticks,
        gesamt: geparkt.gesamt,
      });
      return content;
    }
    // Task 16: Der gemergte Stand für den Aufrufer. Weicht er von `content` ab, ist
    // der Doc der Datei voraus — der Aufrufer schreibt ihn dann sofort zurück
    // (main.ts writeBackMerged), statt den Zustand bis zum 30-s-Poll stehen zu
    // lassen. `undefined` heißt „abgebrochen, nichts erfasst" (siehe abortedReads).
    return finalText;
  }

  // Doc-Aufbau + Fremd-Merge + 3-Wege-Merge des lokalen .md-Texts. Getrennt von
  // applyLocalContent, damit ein SidecarReadError vor setContent/saveState greift.
  private async mergeForLocalDiff(notePath: string, content: string): Promise<string> {
    const adopted = await this.ensureDoc(notePath);

    // Fremd-Sidecars, die ensureDoc nicht schon selbst eingezogen hat (Doc bereits
    // in-memory ODER Bootstrap aus eigenem State), VOR dem lokalen Diff einmergen.
    // Sonst difft ein per Datei-Sync (robocopy) überschriebenes .md gegen den Doc,
    // der die Fremd-Ops noch nicht hat, und ERFINDET die Fremd-Einfügung als neue
    // lokale Op unter eigener Client-ID → beim späteren Sidecar-Merge permanent
    // dupliziert (Yjs dedupliziert nach Item-ID, nicht Inhalt). Trifft Laufzeit-
    // (modify) UND Restart-/Sweep-Pfad (Sync bei geschlossener App, Eigen-State-
    // Bootstrap). Im Adopt-Zweig hat ensureDoc bereits gemergt+gediffed; der Merge
    // ist dann idempotent und der lokale Diff unten entfällt (siehe `adopted`).
    // Basis nur für den own-Branch: im Adopt-Zweig gibt es keinen lokalen Diff
    // (siehe unten), dort bliebe sie ungenutzt.
    //
    // Task 16: Basis ist der zuletzt GESEHENE .md-Text, nicht bedingungslos der
    // Doc-Text. Der Doc darf dem .md voraus sein — der Fremd-Merge direkt unter
    // dieser Zeile stellt genau diesen Zustand her, und der Aufrufer schreibt ihn
    // erst NACH diesem Aufruf zurück (und tut es nicht, wenn die Datei sich
    // inzwischen geändert hat). Als Basis genommen, wäre der Vorlauf von einer
    // lokalen Löschung nicht zu unterscheiden: das Delta „Doc → .md" IST die
    // Löschung des Fremd-Edits, und setContent macht daraus eine Delete-Op, die zum
    // Peer propagiert (Fund 1, stiller unheilbarer Verlust auf beiden Geräten).
    //
    // Task 16, Runde 2 (Review F-1): „nicht bedingungslos" gilt in BEIDE
    // Richtungen — die Bedingung steht in `chooseLocalDiffBase`. Der Doc-Stand von
    // VOR dem Fremd-Merge ist der Fallback und wird dort gebraucht, deshalb hier
    // festgehalten.
    const docBeforeMerge = this.crdtManager.getContent(notePath);
    await this.mergePendingForeign(notePath);
    const mergedText = this.crdtManager.getContent(notePath);
    if (content === mergedText) return mergedText;
    const base = adopted
      ? undefined
      : this.chooseLocalDiffBase(notePath, content, docBeforeMerge, mergedText);

    // Task 13/A: Im Adopt-Zweig hat ensureDoc den .md-Text bereits mit dem
    // adoptierten Fremd-Stand VEREINIGT. Ein zusätzlicher 3-Wege-Merge würde ihn
    // sofort wieder zerstören: die Basis enthielte den Fremd-Inhalt, `content`
    // (die .md) nicht — der Patch Basis→content wäre eine Löschung genau dieses
    // Inhalts. Hier bleibt nur, einen inzwischen abweichenden Aufrufer-Text
    // (Datei änderte sich zwischen ensureDoc-Read und diesem Aufruf) mit
    // einzubeziehen — ebenfalls ohne gemeinsamen Vorfahren, also vereinigend.
    // Task 19/C: Im Regelfall hat `ensureDoc` den `.md`-Text eine Zeile weiter
    // oben bereits vereinigt, `content` ist darin enthalten und `unite` schweigt.
    // Es feuert nur, wenn sich die Datei zwischen dem Read in `ensureDoc` und
    // diesem Aufruf geändert hat — dann ist es ein echter dritter Beitrag.
    if (base === undefined) return this.unite(notePath, mergedText, content);

    // 3-Wege-Merge (wie onRemoteYjsUpdate): die lokale Änderung (Delta base→content)
    // wird auf den fremd-gemergten Stand angewandt. So überlebt ein Fremd-Edit, den
    // die .md noch NICHT enthält (kein 2-Wege-setContent-Delete → kein Cross-Device-
    // Datenverlust) UND ein echter lokaler Edit. Enthält die .md den Fremd-Stand
    // bereits (content === mergedText, häufigster Restart-/Sync-Overwrite-Fall), KEIN
    // 3-Wege-Patch: threeWayMerge würde die schon vorhandene Fremd-Einfügung erneut
    // einfügen (patch_apply dedupliziert nicht) — dieser Fall ist oben schon
    // abgefangen (content === mergedText → direkt der gemergte Stand).
    return threeWayMerge(base, content, mergedText);
  }

  // Task 16, Runde 2 (Review F-1): Welcher Text ist der gemeinsame Vorfahr des
  // lokalen Diffs — der zuletzt gesehene .md-Stand oder der Doc-Stand?
  //
  // `localDiffBase` (zuletzt gesehene .md) ist richtig, solange `content` ein
  // Nutzer-Edit AUF diesem Stand ist. Dann ist der Vorlauf des Docs per
  // Konstruktion keine lokale Änderung — genau das behebt Fund 1.
  //
  // Sie ist FALSCH, sobald `content` den Vorlauf selbst schon trägt: der Datei-Sync
  // hat die GEMERGTE Fassung des Peers abgelegt (robocopy liefert .md und Sidecar
  // zusammen — der Task-11-Realfall). Dann enthält `patch_make(Basis, content)` die
  // Fremd-Einfügung, die `other` bereits hat, `patch_apply` dedupliziert nicht
  // (WARNUNG in text-merge.ts), und der Fremd-Edit steht danach zweimal in der Note.
  // Gemessen im Review: FREMD=2 gegen FREMD=1 vor Task 16 — der Fix hätte in dieser
  // Lage keinen Verlust verhindert, sondern nur eine Verdopplung addiert. Der
  // Kurzschluss `content === mergedText` fängt allein die exakte Gleichheit; sobald
  // der sync-gelieferten .md zusätzlich der lokale Edit fehlt, greift er nicht.
  //
  // Die Bedingung fragt deshalb genau das: trägt `content` Text, den der Doc uns
  // gegenüber VORAUS hat? Ja → die .md hat aufgeholt, der Doc-Stand ist die richtige
  // (und vor Task 16 einzige) Basis. Nein → der Vorlauf ist der .md unbekannt, die
  // zuletzt gesehene .md ist der Vorfahr.
  //
  // Verglichen wird gegen `mergedText`, NICHT gegen den erst hier durch
  // `mergePendingForeign` hinzugekommenen Text: im belegten Fall ist die
  // Fremd-Sidecar bereits beim vorigen Tastendruck eingemergt und
  // `mergePendingForeign` fügt nichts mehr hinzu. Der Vorlauf ist die Differenz zum
  // zuletzt gesehenen .md-Stand, nicht die zum Doc von vor diesem Aufruf.
  //
  // Ohne Eintrag (frischer Prozess, Note erstmals angefasst) bleibt es beim
  // Doc-Text — dort ist er der letzte von uns erfasste .md-Stand.
  private chooseLocalDiffBase(
    notePath: string,
    content: string,
    docBeforeMerge: string,
    mergedText: string
  ): string {
    const lastSeen = this.localDiffBase.get(notePath);
    if (lastSeen === undefined) return docBeforeMerge;
    // Was der Doc gegenüber unserem letzten .md-Stand voraus hat. Leer = kein
    // Vorlauf, dann sind beide Kandidaten gleichwertig und der billigere gewinnt.
    const lead = insertedTexts(lastSeen, mergedText);
    if (lead.length === 0) return lastSeen;
    return lead.some((l) => content.includes(l)) ? docBeforeMerge : lastSeen;
  }

  async loadAndMerge(notePath: string): Promise<string | null> {
    let vorDemMerge = '';
    const yjsFiles = await this.vault.listYjsFiles(notePath);
    // Leere Liste: unverändert „nichts zu mergen" (kein IO-Fehler-Fall).
    if (yjsFiles.length === 0) return null;

    // Task 12: Analog zu applyLocalContent — bei transientem IO-Fehler kein Merge
    // auf Halbwissen und kein halber Stand nach außen (null → kein Write-Back).
    try {
      // Task 13/C (Phantom-Guard): Eine fremde Sidecar, deren .md noch nicht
      // angekommen ist, darf hier keinen eigenen State erzeugen. ensureDoc würde
      // eine GUID prägen (die fremde — oder mangels lesbarer Fremd-GUID eine
      // frische) und saveState schriebe eine eigene Sidecar für eine Note, die es
      // auf diesem Gerät gar nicht gibt; diese Phantom-GUID vergiftet spätere
      // Tie-Breaks (Realtest S04). Der Guard sitzt bewusst hier und nicht nur im
      // Aufrufer (main.ts, Guard 1): so gilt er für JEDEN Pfad (Poll, file-open,
      // Initial-Scan). Die fremde Datei bleibt unangetastet liegen — sobald die
      // .md ankommt, adoptiert der reguläre Pfad sie.
      //
      // Existiert bereits eigener State, bleibt es beim bisherigen Verhalten:
      // kein Tie-Break ohne .md, eigene Historie bleibt stehen (siehe
      // switchToGuid). „Eigener State" umfasst neben der per-Client-Sidecar auch
      // die clientId-lose Legacy-Datei (Review M-4) — sonst würde eine Note, deren
      // einziger State v0.1-Legacy ist, bei fehlender .md still übersprungen und
      // die Legacy-Leiche nie aufgeräumt.
      if (
        !this.vault.getAbstractFileByPath(notePath) &&
        !this.crdtManager.hasDoc(notePath) &&
        !(await sidecarExists(this.vault.adapter, this.stateFilePath(notePath))) &&
        !(await sidecarExists(this.vault.adapter, this.legacyFilePath(notePath)))
      ) {
        return null;
      }

      // Stand vor dem Merge — Grundlage des Kanal-Tors unten.
      vorDemMerge = this.crdtManager.getContent(notePath);

      // Rückgabewert („hat adoptiert und den .md-Text vereinigt") hier bewusst
      // ignoriert: loadAndMerge spielt den .md-Text ohnehin nicht als lokalen Diff
      // ein — im Adopt-Zweig hat ensureDoc ihn bereits vereinigt, im own-Branch
      // bleibt er absichtlich draußen (er würde Remote-Edits zurückrollen).
      await this.ensureDoc(notePath);

      const siblings = await this.decodeSiblings(notePath, yjsFiles);
      const ownGuid = this.guids.get(notePath);
      const winner = this.pickWinnerGuid(siblings, ownGuid);

      if (winner !== undefined && winner !== ownGuid) {
        // Fremde Inkarnation gewinnt den Tie-Break → Historie wechseln.
        await this.switchToGuid(notePath, winner, siblings);
      } else {
        // Eigene Inkarnation gewinnt (oder alle kompatibel): kompatible mergen,
        // Verlierer-GUIDs ignorieren. Kein Einspielen des lokalen .md-Texts.
        this.mergeCompatible(notePath, siblings);
        // Task 20: Hier ist der Verwurf endgültig — der Tie-Break ist gefallen.
        this.reportDiscarded(notePath, siblings);
      }
    } catch (err) {
      // Der Abbruch wird hier NICHT als abortedReads markiert: die Markierung
      // bedeutet ausschließlich „ein lokaler .md-Edit ist nicht erfasst", und das
      // kann nur applyLocalContent auflösen. Der Aufrufer erkennt den Abbruch am
      // null-Rückgabewert (kein Write-Back, Trigger bleibt unverbraucht).
      if (err instanceof SidecarReadError) return null;
      throw err;
    }

    // Übernommene Historie persistieren, sonst geht sie beim Neustart verloren.
    await this.saveState(notePath);
    // R1: Eigener GUID-State ist jetzt geschrieben — Legacy-Datei aufräumen.
    await this.cleanupLegacyFile(notePath);

    // Der Auflöse-Punkt des Parkens, und zwar HIER: erst nach dem Merge stehen
    // die fremden Ops im Doc. Deckt er den geparkten Stand, ist die Historie da
    // und das Parken beendet. Deckt er ihn nicht, bleibt geparkt — und `null`
    // sagt dem Aufrufer „kein Write-Back, Trigger unverbraucht" (dieselbe
    // Semantik wie beim abgebrochenen Sidecar-Lesen). Ein Write-Back loeschte
    // sonst den geparkten Text aus der Datei.
    if (!this.resolveParked(notePath)) {
      // DAS KANAL-TOR. Hat dieser Merge den Doc verändert, hat der Datei-Sync
      // für diese Notiz gerade geliefert — die Historie ist unterwegs, nur noch
      // nicht vollständig. Dann beginnt die Frist neu.
      //
      // Ohne das Tor ist die Frist eine reine Zeitkonstante, und der Kanal hat
      // zwei Moden: beide Geräte online (Zustellung ~2 s, Maximum am gesunden
      // Kanal 37,6 s) und „der Peer war stundenlang weg" (unbeschränkt). Im
      // zweiten Modus verfällt jede feste Frist, bevor die Historie kommen
      // konnte — und genau dort liegt der Schaden, den eine Kalibrierung des
      // ersten Modus nicht sieht.
      //
      // Der Reset haengt bewusst an einer TATSAECHLICHEN Doc-Aenderung und nicht
      // am blossen Aufruf: `loadAndMerge` laeuft auch beim Oeffnen einer Notiz,
      // und daran duerfte sich die Frist nicht verlaengern lassen. Liefert der
      // Kanal fuer diese Notiz gar nichts — externer Editor, Peer ohne Qollab —,
      // greift der Reset nie und die Frist laeuft wie bisher ab.
      if (this.crdtManager.getContent(notePath) !== vorDemMerge) {
        const p = this.parked.get(notePath);
        // `gesamt` bleibt stehen — sonst kann ein Peer, dessen Updates den
        // geparkten Stand nie decken, den Nachtrag unbegrenzt verzoegern.
        if (p) p.ticks = 0;
      }
      return null;
    }

    return this.crdtManager.getContent(notePath);
  }
}
