import { CrdtManager } from './crdt-manager';
import { encodeStateFile, decodeStateFile, generateGuid } from './state-file';
import type { SidecarAdapter } from './sidecar-io';
import { ensureSidecarFolder, dirname } from './sidecar-io';
import { threeWayMerge } from './text-merge';

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

// Gerätelokaler Tombstone-Store, von main.ts injiziert. Merkt sich GUIDs
// gelöschter Note-Inkarnationen, damit stale fremde .yjs derselben GUID nicht
// wieder gemergt werden.
export interface TombstoneStore {
  has(guid: string): boolean;
  add(guid: string): Promise<void>;
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

export class SyncHandler {
  // Note-Pfad → GUID der aktuell geladenen Inkarnation.
  private guids = new Map<string, string>();

  constructor(
    private vault: VaultLike,
    private crdtManager: CrdtManager,
    private clientId: string,
    private tombstones: TombstoneStore = NO_TOMBSTONES,
    // R2: optionaler Callback für korrupte Dateien (einmalige Notice-Logik liegt beim Aufrufer).
    private onCorruptFile?: (path: string) => void
  ) {}

  stateFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
  }

  // Aktuelle GUID der Note: aus der Map, sonst aus dem Header der eigenen .yjs.
  // Vom delete-Handler benötigt (was tombstonen?).
  async currentGuid(notePath: string): Promise<string | null> {
    const mapped = this.guids.get(notePath);
    if (mapped) return mapped;
    const own = await this.readStateFile(this.stateFilePath(notePath));
    return own?.guid ?? null;
  }

  // Note vergessen (delete-Handler): Doc + GUID-Map-Eintrag entfernen.
  disposeNote(notePath: string): void {
    this.guids.delete(notePath);
    this.crdtManager.disposeDoc(notePath);
  }

  // Rename: gleiche Inkarnation, GUID bleibt erhalten — Map-Eintrag umziehen.
  // Der Doc wird verworfen und beim nächsten Zugriff aus den (bereits
  // umbenannten) .yjs unter dem neuen Pfad neu aufgebaut.
  renameNote(oldPath: string, newPath: string): void {
    const guid = this.guids.get(oldPath);
    this.guids.delete(oldPath);
    if (guid) this.guids.set(newPath, guid);
    this.crdtManager.disposeDoc(oldPath);
  }

  // Löscht eine Sidecar, falls vorhanden (Ersatz für das frühere
  // getAbstractFileByPath-if(file)-delete-Muster über den Adapter).
  private async removeSidecar(path: string): Promise<void> {
    if (await this.vault.adapter.exists(path)) await this.vault.adapter.remove(path);
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
    if (await this.sidecarBytesEqual(stateFile, state)) return;
    await ensureSidecarFolder(this.vault.adapter, dirname(stateFile));
    // adapter.writeBinary legt an ODER überschreibt in einem Aufruf — kein
    // create/modify-Split und kein Race-Fallback mehr nötig (der frühere,
    // index-basierte Split war in echten Vaults ein Silent-No-Op).
    await this.vault.adapter.writeBinary(stateFile, state);
  }

  // True, wenn die Sidecar existiert und byteweise identisch mit bytes ist.
  // Lese-/Decode-Fehler oder Nichtexistenz → false (dann normal schreiben).
  private async sidecarBytesEqual(path: string, bytes: Uint8Array): Promise<boolean> {
    if (!(await this.vault.adapter.exists(path))) return false;
    try {
      const disk = new Uint8Array(await this.vault.adapter.readBinary(path));
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
    // exists-Check trennt „nicht vorhanden" (null, keine Notice) von „vorhanden
    // aber korrupt" (Notice) — readBinary würde bei fehlender Datei werfen.
    if (!(await this.vault.adapter.exists(path))) return null;
    // R2: read-/decode-Fehler (z.B. leere oder trunkierte Datei) abfangen.
    try {
      const buffer = await this.vault.adapter.readBinary(path);
      const { guid, update } = decodeStateFile(new Uint8Array(buffer));
      return { path, guid, update };
    } catch {
      this.onCorruptFile?.(path);
      return null;
    }
  }

  // Dekodiert Sibling-Pfade und wendet die Tombstone- und Legacy-Regeln an:
  //   C.3: Eine getombstonte GUID → Datei als stale Leiche löschen und ausschließen.
  //   R1:  Legacy-Dateien (guid null, kein QLB1-Header) dienen nur dem Erst-Import.
  //        Existiert unter den übergebenen Pfaden mindestens ein GUID-tragender
  //        Sidecar, werden Legacy-Dateien ignoriert und sofort gelöscht.
  //        Die eigene Datei kann nie fälschlich gelöscht werden: die eigene GUID
  //        landet nie im gerätelokalen Tombstone-Set (der delete-Handler tombstont
  //        nur beim Löschen der Note und entfernt dabei die eigene Datei ohnehin mit).
  private async decodeSiblings(paths: string[]): Promise<DecodedSibling[]> {
    // Alle Dateien lesen, dann in einem zweiten Durchlauf entscheiden.
    const decoded: Array<DecodedSibling | null> = [];
    for (const path of paths) {
      decoded.push(await this.readStateFile(path));
    }

    // R1: Prüfen ob mindestens ein GUID-tragender Sidecar existiert.
    const hasGuidState = decoded.some((d) => d !== null && d.guid !== null);

    const result: DecodedSibling[] = [];
    for (let i = 0; i < paths.length; i++) {
      const d = decoded[i];
      if (!d) continue;

      // Tombstone-Prüfung (C.3)
      if (d.guid !== null && this.tombstones.has(d.guid)) {
        await this.removeSidecar(paths[i]);
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
  private async ensureDoc(notePath: string): Promise<void> {
    if (this.crdtManager.hasDoc(notePath)) {
      if (!this.guids.has(notePath)) {
        const own = await this.readStateFile(this.stateFilePath(notePath));
        this.guids.set(notePath, own?.guid ?? generateGuid());
      }
      return;
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
      return;
    }

    const ownPath = this.stateFilePath(notePath);
    const foreign = await this.decodeSiblings(
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
    // Transiente Staleness: Eine hier eingediffte veraltete .md rollt fremde Edits
    // vorübergehend zurück; das heilt sich selbst, sobald die neuere .md via
    // Datei-Sync nachkommt (nächstes create/modify → loadAndMerge mit dann bereits
    // erfasstem eigenem State läuft über den own-Branch ohne .md-Injektion).
    const file = this.vault.getAbstractFileByPath(notePath);
    if (file) {
      const mdText = await this.vault.read(file);
      this.crdtManager.setContent(notePath, mdText);
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
    const mdText = await this.vault.read(file);
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
    this.crdtManager.setContent(notePath, mdText);
  }

  // R1: Löscht die Legacy-Datei (kein QLB1-Header) einer Note, falls sie noch
  // existiert. Wird nach saveState aufgerufen: zu dem Zeitpunkt existiert
  // GUID-tragender State, sodass die Legacy-Datei nicht mehr gebraucht wird.
  private async cleanupLegacyFile(notePath: string): Promise<void> {
    const legacyPath = `${QOLLAB_DIR}/${notePath}.yjs`;
    await this.removeSidecar(legacyPath);
  }

  // Zieht ausstehende KOMPATIBLE Fremd-Sidecars (gleiche/legacy GUID) in den Doc
  // ein — reine mergeCompatible-Semantik, KEIN Tie-Break. Split-Brain (fremde
  // Gewinner-GUID, switchToGuid) bleibt ausschließlich Sache von loadAndMerge; hier
  // werden Verlierer-/Fremd-GUIDs bewusst ignoriert. Idempotent: bereits gemergte
  // Siblings (z.B. im Adopt-Zweig von ensureDoc) werden nach Item-ID dedupliziert.
  private async mergePendingForeign(notePath: string): Promise<void> {
    const yjsFiles = await this.vault.listYjsFiles(notePath);
    if (yjsFiles.length === 0) return;
    const siblings = await this.decodeSiblings(yjsFiles);
    this.mergeCompatible(notePath, siblings);
  }

  // Bringt eine lokale .md-Änderung in den CRDT.
  async applyLocalContent(notePath: string, content: string): Promise<void> {
    await this.ensureDoc(notePath);

    // Fremd-Sidecars, die ensureDoc nicht schon selbst eingezogen hat (Doc bereits
    // in-memory ODER Bootstrap aus eigenem State), VOR dem lokalen Diff einmergen.
    // Sonst difft ein per Datei-Sync (robocopy) überschriebenes .md gegen den Doc,
    // der die Fremd-Ops noch nicht hat, und ERFINDET die Fremd-Einfügung als neue
    // lokale Op unter eigener Client-ID → beim späteren Sidecar-Merge permanent
    // dupliziert (Yjs dedupliziert nach Item-ID, nicht Inhalt). Trifft Laufzeit-
    // (modify) UND Restart-/Sweep-Pfad (Sync bei geschlossener App, Eigen-State-
    // Bootstrap). Im Adopt-Zweig hat ensureDoc bereits gemergt+gediffed; der Merge
    // ist dann idempotent und der 3-Wege-Merge unten ein No-Op (content == mergedText).
    const base = this.crdtManager.getContent(notePath);
    await this.mergePendingForeign(notePath);
    const mergedText = this.crdtManager.getContent(notePath);

    // 3-Wege-Merge (wie onRemoteYjsUpdate): die lokale Änderung (Delta base→content)
    // wird auf den fremd-gemergten Stand angewandt. So überlebt ein Fremd-Edit, den
    // die .md noch NICHT enthält (kein 2-Wege-setContent-Delete → kein Cross-Device-
    // Datenverlust) UND ein echter lokaler Edit. Enthält die .md den Fremd-Stand
    // bereits (content === mergedText, häufigster Restart-/Sync-Overwrite-Fall), KEIN
    // 3-Wege-Patch: threeWayMerge würde die schon vorhandene Fremd-Einfügung erneut
    // einfügen (patch_apply dedupliziert nicht) — direkt der gemergte Stand.
    const finalText =
      content === mergedText ? mergedText : threeWayMerge(base, content, mergedText);
    this.crdtManager.setContent(notePath, finalText);

    await this.saveState(notePath);
    // R1: Eigener GUID-State ist jetzt geschrieben — Legacy-Datei aufräumen.
    await this.cleanupLegacyFile(notePath);
  }

  async loadAndMerge(notePath: string): Promise<string | null> {
    const yjsFiles = await this.vault.listYjsFiles(notePath);
    if (yjsFiles.length === 0) return null;

    await this.ensureDoc(notePath);

    const siblings = await this.decodeSiblings(yjsFiles);
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

    // Übernommene Historie persistieren, sonst geht sie beim Neustart verloren.
    await this.saveState(notePath);
    // R1: Eigener GUID-State ist jetzt geschrieben — Legacy-Datei aufräumen.
    await this.cleanupLegacyFile(notePath);

    return this.crdtManager.getContent(notePath);
  }
}
