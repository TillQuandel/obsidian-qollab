import { CrdtManager } from './crdt-manager';
import { encodeStateFile, decodeStateFile, generateGuid } from './state-file';

export const QOLLAB_DIR = '.qollab';

// Filtert alle Pfade auf die .yjs-Sibling-Dateien einer Note.
// Reines Refactoring des vormaligen Inline-Filters aus main.ts —
// verhaltensgleich (Prefix `.qollab/<notePath>.` + Suffix `.yjs`).
export function filterYjsFiles(allPaths: string[], notePath: string): string[] {
  return allPaths.filter(
    (p) => p.startsWith(`${QOLLAB_DIR}/${notePath}.`) && p.endsWith('.yjs')
  );
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

interface VaultLike {
  getAbstractFileByPath(path: string): { path: string } | null;
  read(file: { path: string }): Promise<string>;
  readBinary(file: { path: string }): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  modifyBinary(file: { path: string }, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  delete(file: { path: string }): Promise<unknown>;
  createFolder(path: string): Promise<unknown>;
  listYjsFiles(notePath: string): string[];
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
    private tombstones: TombstoneStore = NO_TOMBSTONES
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

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath || this.vault.getAbstractFileByPath(folderPath)) return;
    const parent = folderPath.split('/').slice(0, -1).join('/');
    if (parent) await this.ensureFolder(parent);
    try {
      await this.vault.createFolder(folderPath);
    } catch {
      // Ordner wurde zwischen Check und Create von anderem Prozess angelegt — ok
    }
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
    const folderPath = stateFile.split('/').slice(0, -1).join('/');
    await this.ensureFolder(folderPath);
    const existing = this.vault.getAbstractFileByPath(stateFile);
    if (existing) {
      await this.vault.modifyBinary(existing, state);
    } else {
      try {
        await this.vault.createBinary(stateFile, state);
      } catch {
        // Datei wurde zwischen Check und Create von anderem Prozess angelegt — modify als Fallback
        const created = this.vault.getAbstractFileByPath(stateFile);
        if (created) await this.vault.modifyBinary(created, state);
      }
    }
  }

  private async readStateFile(path: string): Promise<DecodedSibling | null> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) return null;
    const buffer = await this.vault.readBinary(file);
    const { guid, update } = decodeStateFile(new Uint8Array(buffer));
    return { path, guid, update };
  }

  // Dekodiert Sibling-Pfade und wendet die Tombstone-Regel (C.3) an: eine
  // getombstonte GUID → Datei als stale Leiche löschen und aus der Liste nehmen.
  // Die eigene Datei kann hier nie fälschlich gelöscht werden: die eigene GUID
  // landet nie im gerätelokalen Tombstone-Set (der delete-Handler tombstont nur
  // beim Löschen der Note und entfernt dabei die eigene Datei ohnehin mit).
  private async decodeSiblings(paths: string[]): Promise<DecodedSibling[]> {
    const result: DecodedSibling[] = [];
    for (const path of paths) {
      const decoded = await this.readStateFile(path);
      if (!decoded) continue;
      if (decoded.guid !== null && this.tombstones.has(decoded.guid)) {
        const file = this.vault.getAbstractFileByPath(path);
        if (file) await this.vault.delete(file);
        continue;
      }
      result.push(decoded);
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
      this.crdtManager.applyUpdate(notePath, own.update);
      this.guids.set(notePath, own.guid ?? generateGuid());
      return;
    }

    const ownPath = this.stateFilePath(notePath);
    const foreign = await this.decodeSiblings(
      this.vault.listYjsFiles(notePath).filter((p) => p !== ownPath)
    );
    const winner = this.pickWinnerGuid(foreign, undefined);
    this.guids.set(notePath, winner ?? generateGuid());
    this.mergeCompatible(notePath, foreign);
  }

  // Merged alle Siblings, deren GUID der aktuellen entspricht oder die Legacy
  // (null) sind. Fremde, nicht getombstonte Verlierer-GUIDs werden ignoriert.
  private mergeCompatible(notePath: string, siblings: DecodedSibling[]): void {
    const guid = this.guids.get(notePath);
    for (const s of siblings) {
      if (s.guid === null || s.guid === guid) {
        this.crdtManager.applyUpdate(notePath, s.update);
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
      if (s.guid === winner) this.crdtManager.applyUpdate(notePath, s.update);
    }
    this.crdtManager.setContent(notePath, mdText);
  }

  // Bringt eine lokale .md-Änderung in den CRDT. Diff-basiertes setContent
  // erzeugt keine Ops, wenn der Doc-Text bereits identisch ist.
  async applyLocalContent(notePath: string, content: string): Promise<void> {
    await this.ensureDoc(notePath);
    this.crdtManager.setContent(notePath, content);
    await this.saveState(notePath);
  }

  async loadAndMerge(notePath: string): Promise<string | null> {
    const yjsFiles = this.vault.listYjsFiles(notePath);
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

    return this.crdtManager.getContent(notePath);
  }
}
