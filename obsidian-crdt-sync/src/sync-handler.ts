import { CrdtManager } from './crdt-manager';

export const QOLLAB_DIR = '.qollab';

// Filtert alle Pfade auf die .yjs-Sibling-Dateien einer Note.
// Reines Refactoring des vormaligen Inline-Filters aus main.ts —
// verhaltensgleich (Prefix `.qollab/<notePath>.` + Suffix `.yjs`).
export function filterYjsFiles(allPaths: string[], notePath: string): string[] {
  return allPaths.filter(
    (p) => p.startsWith(`${QOLLAB_DIR}/${notePath}.`) && p.endsWith('.yjs')
  );
}

interface VaultLike {
  getAbstractFileByPath(path: string): { path: string } | null;
  read(file: { path: string }): Promise<string>;
  readBinary(file: { path: string }): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  modifyBinary(file: { path: string }, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  createFolder(path: string): Promise<unknown>;
  listYjsFiles(notePath: string): string[];
}

export class SyncHandler {
  constructor(private vault: VaultLike, private crdtManager: CrdtManager, private clientId: string) {}

  stateFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
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
    const state = this.crdtManager.encodeState(notePath);
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

  private async applyYjsFile(notePath: string, yjsPath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(yjsPath);
    if (!file) return;
    const buffer = await this.vault.readBinary(file);
    this.crdtManager.applyUpdate(notePath, new Uint8Array(buffer));
  }

  // Bootstrappt den Doc NIE aus dem .md-Text, immer aus persistiertem State.
  // Reihenfolge: eigener State (enthält alle früher gemergten Historien) →
  // fremde Sibling-.yjs adoptieren (neuer Client übernimmt vorhandene Historie
  // als Basis statt eine eigene zu erzeugen; löst den Zwei-Geräte-Erstmerge) →
  // sonst leerer Doc.
  private async ensureDoc(notePath: string): Promise<void> {
    if (this.crdtManager.hasDoc(notePath)) return;

    const ownPath = this.stateFilePath(notePath);
    if (this.vault.getAbstractFileByPath(ownPath)) {
      await this.applyYjsFile(notePath, ownPath);
      return;
    }

    const foreign = this.vault.listYjsFiles(notePath).filter((p) => p !== ownPath);
    for (const yjsPath of foreign) {
      await this.applyYjsFile(notePath, yjsPath);
    }
    // Kein State vorhanden: leerer Doc — wird lazy von setContent/applyUpdate erzeugt.
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

    // Alle Sibling-.yjs mergen (inkl. Legacy-Dateien ohne clientId und der
    // eigenen — idempotent). KEIN Einspielen des lokalen .md-Texts: das würde
    // ankommende Remote-Edits rückgängig machen, sobald die lokale .md älter ist
    // als die Fremd-Historie. Lokale Edits kommen ausschließlich über
    // applyLocalContent (modify-Handler/Sweep) herein.
    for (const yjsPath of yjsFiles) {
      await this.applyYjsFile(notePath, yjsPath);
    }

    // Übernommene Fremd-Historie persistieren, sonst geht sie beim Neustart verloren.
    await this.saveState(notePath);

    return this.crdtManager.getContent(notePath);
  }
}
