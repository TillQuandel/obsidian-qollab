import { CrdtManager } from './crdt-manager';
import { encodeStateFile, decodeStateFile, generateGuid } from './state-file';
import type { SidecarAdapter } from './sidecar-io';
import {
  ensureSidecarFolder,
  dirname,
  readSidecar,
  sidecarExists,
  statSidecar,
} from './sidecar-io';
import { threeWayMerge, unionMerge } from './text-merge';

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
export interface TombstoneStore {
  has(guid: string, notePath: string): boolean;
  add(guid: string, notePath: string): Promise<void>;
}

const NO_TOMBSTONES: TombstoneStore = {
  has: () => false,
  add: async () => {},
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
  // adapter.list async ist).
  listYjsFiles(notePath: string): Promise<string[]>;
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
    private onUnreadableFile?: (path: string) => void
  ) {}

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

  // True, solange für diese Note ein abgebrochener Lauf nachzuholen ist.
  hasAbortedRead(notePath: string): boolean {
    return this.abortedReads.has(notePath);
  }

  // Der Text, dessen Erfassung abgebrochen ist — für den Nachhol-Versuch.
  pendingLocalContent(notePath: string): string | undefined {
    return this.abortedReads.get(notePath);
  }

  // Task 14: Signatur unserer eigenen Sidecars + Pfade, die wir gerade schreiben
  // (writingPaths-Analogon für Sidecars). Beides zusammen hält das False-Positive-
  // Fenster der Kollisionserkennung klein.
  private ownSignatures = new Map<string, OwnSidecarSignature>();
  private writingSidecars = new Set<string>();

  stateFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
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
    // Die Inkarnation ist tot; ihre Pfad-Historie hat keinen Adressaten mehr.
    // (Der delete-Handler hat sie vorher über incarnationPaths ausgelesen.)
    this.priorPaths.delete(notePath);
    // Task 14: Die Signatur beschreibt eine Datei, die es nicht mehr gibt.
    this.ownSignatures.delete(this.stateFilePath(notePath));
    this.crdtManager.disposeDoc(notePath);
  }

  // Rename: gleiche Inkarnation, GUID bleibt erhalten — Map-Eintrag umziehen.
  // Der Doc wird verworfen und beim nächsten Zugriff aus den (bereits
  // umbenannten) .yjs unter dem neuen Pfad neu aufgebaut.
  renameNote(oldPath: string, newPath: string): void {
    const guid = this.guids.get(oldPath);
    this.guids.delete(oldPath);
    if (guid) this.guids.set(newPath, guid);
    // Eine offene „lokaler Edit nicht erfasst"-Markierung zieht mit um.
    const uncaptured = this.abortedReads.get(oldPath);
    this.abortedReads.delete(oldPath);
    if (uncaptured !== undefined) this.abortedReads.set(newPath, uncaptured);
    // Review C-1: Pfad-Historie der Inkarnation mitziehen. Bewusst unabhängig
    // davon, ob oben eine GUID gefunden wurde — sie steht oft erst im Header der
    // Sidecar und wird erst vom delete-Handler (currentGuid) aufgelöst. Wer die
    // Historie an eine bekannte GUID knüpfte, verlöre genau die Renames, die vor
    // dem ersten Doc-Zugriff passieren.
    const prior = this.priorPaths.get(oldPath) ?? [];
    this.priorPaths.delete(oldPath);
    this.priorPaths.set(newPath, [...prior, oldPath]);
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
    this.crdtManager.disposeDoc(oldPath);
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
  //   R1:  Legacy-Dateien (guid null, kein QLB1-Header) dienen nur dem Erst-Import.
  //        Existiert unter den übergebenen Pfaden mindestens ein GUID-tragender
  //        Sidecar, werden Legacy-Dateien ignoriert und sofort gelöscht.
  //
  // Die frühere Begründung, die eigene Datei könne nie fälschlich gelöscht werden
  // („die eigene GUID landet nie im Tombstone-Set"), war nachweislich falsch: ein
  // sync-vermittelter Rename stellt eine Umbenennung als delete+create zu und
  // tombstont damit eine LEBENDE Inkarnation, und im Adopt-Zweig hängt dieselbe
  // GUID ohnehin an mehreren Pfaden. Stattdessen gilt jetzt hart: über den
  // Tombstone-Zweig wird die eigene Sidecar nie gelöscht, nur vom Ergebnis
  // ausgeschlossen (siehe unten). Der Legacy-Zweig (R1) bleibt unverändert — dort
  // ist das Löschen der eigenen Legacy-Datei gewollt, weil ihr Inhalt zu dem
  // Zeitpunkt bereits im GUID-tragenden State steht.
  private async decodeSiblings(notePath: string, paths: string[]): Promise<DecodedSibling[]> {
    // Alle Dateien lesen, dann in einem zweiten Durchlauf entscheiden.
    const decoded: Array<DecodedSibling | null> = [];
    for (const path of paths) {
      decoded.push(await this.readStateFile(path));
    }

    // R1: Prüfen ob mindestens ein GUID-tragender Sidecar existiert.
    const hasGuidState = decoded.some((d) => d !== null && d.guid !== null);

    const ownPath = this.stateFilePath(notePath);
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

      // R1: Legacy ignorieren und löschen, sobald GUID-State existiert.
      if (d.guid === null && hasGuidState) {
        await this.removeSidecar(paths[i]);
        continue;
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
    if (own) {
      // R2: korrupter eigener State → überspringen; Doc bleibt leer und wird beim
      // nächsten saveState (aus applyLocalContent) mit gültigem State überschrieben.
      try {
        this.crdtManager.applyUpdate(notePath, own.update);
      } catch {
        this.onCorruptFile?.(own.path);
      }
      this.guids.set(notePath, own.guid ?? generateGuid());
      return false;
    }

    const ownPath = this.stateFilePath(notePath);
    const foreign = await this.decodeSiblings(
      notePath,
      (await this.vault.listYjsFiles(notePath)).filter((p) => p !== ownPath)
    );
    const winner = this.pickWinnerGuid(foreign, undefined);
    this.guids.set(notePath, winner ?? generateGuid());
    this.mergeCompatible(notePath, foreign);

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
    const mdText = await this.vault.read(file);
    this.crdtManager.setContent(
      notePath,
      unionMerge(this.crdtManager.getContent(notePath), mdText)
    );
    return true;
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
    const mdText = await this.vault.read(file);
    // Task 13/A: Den lokalen Stand VOR dem Verwerfen sichern — Doc UND .md. Der
    // Doc kann der Datei voraus sein (bereits gemergter, noch nicht
    // zurückgeschriebener Stand) und die Datei dem Doc (externer Edit).
    const localText = unionMerge(this.crdtManager.getContent(notePath), mdText);
    this.crdtManager.disposeDoc(notePath);
    this.guids.set(notePath, winner);
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
    // Task 13/A: Früher `setContent(mdText)` — ein 2-Wege-Diff, der den frisch
    // aufgebauten Gewinner-Doc exakt auf die lokale Datei zwang. Inhalt, der nur
    // im Verlierer-Doc lebte, verschwand ersatzlos; Gewinner-Inhalt, den die
    // lokale .md noch nicht kannte, wurde als DELETE-Op geschrieben und über den
    // nächsten Merge zum Gewinner zurückpropagiert (Realtest S05: 10/10
    // divergent). Beide Inkarnationen haben keinen gemeinsamen Vorfahren →
    // unionMerge. Auf Op-Ebene bleibt der Wechsel prinzipbedingt verlustbehaftet:
    // der lokale Beitrag zählt danach als frische Einfügung dieses Geräts.
    this.crdtManager.setContent(
      notePath,
      unionMerge(this.crdtManager.getContent(notePath), localText)
    );
  }

  // Pfad der clientId-losen Legacy-Datei (v0.1-Ära).
  private legacyFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.yjs`;
  }

  // R1: Löscht die Legacy-Datei (kein QLB1-Header) einer Note, falls sie noch
  // existiert. Wird nach saveState aufgerufen: zu dem Zeitpunkt existiert
  // GUID-tragender State, sodass die Legacy-Datei nicht mehr gebraucht wird.
  private async cleanupLegacyFile(notePath: string): Promise<void> {
    await this.removeSidecar(this.legacyFilePath(notePath));
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
  async hasAdoptableGuid(notePath: string): Promise<boolean> {
    const ownPath = this.stateFilePath(notePath);
    const foreign = (await this.vault.listYjsFiles(notePath)).filter((p) => p !== ownPath);
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
  async applyLocalContent(notePath: string, content: string): Promise<void> {
    let finalText: string;
    try {
      finalText = await this.mergeForLocalDiff(notePath, content);
    } catch (err) {
      if (err instanceof SidecarReadError) {
        this.abortedReads.set(notePath, content);
        return;
      }
      throw err;
    }
    this.crdtManager.setContent(notePath, finalText);

    await this.saveState(notePath);
    // R1: Eigener GUID-State ist jetzt geschrieben — Legacy-Datei aufräumen.
    await this.cleanupLegacyFile(notePath);
    // Lokaler Stand ist erfasst und persistiert — Markierung fällt weg.
    this.abortedReads.delete(notePath);
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
    const base = adopted ? undefined : this.crdtManager.getContent(notePath);
    await this.mergePendingForeign(notePath);
    const mergedText = this.crdtManager.getContent(notePath);
    if (content === mergedText) return mergedText;

    // Task 13/A: Im Adopt-Zweig hat ensureDoc den .md-Text bereits mit dem
    // adoptierten Fremd-Stand VEREINIGT. Ein zusätzlicher 3-Wege-Merge würde ihn
    // sofort wieder zerstören: die Basis enthielte den Fremd-Inhalt, `content`
    // (die .md) nicht — der Patch Basis→content wäre eine Löschung genau dieses
    // Inhalts. Hier bleibt nur, einen inzwischen abweichenden Aufrufer-Text
    // (Datei änderte sich zwischen ensureDoc-Read und diesem Aufruf) mit
    // einzubeziehen — ebenfalls ohne gemeinsamen Vorfahren, also vereinigend.
    if (base === undefined) return unionMerge(mergedText, content);

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

  async loadAndMerge(notePath: string): Promise<string | null> {
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

    return this.crdtManager.getContent(notePath);
  }
}
