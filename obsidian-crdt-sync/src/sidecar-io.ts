import { filterYjsFiles, QOLLAB_DIR } from './sync-handler';

// Sidecar-IO läuft ausschließlich über die vault.adapter-API, weil Obsidians
// Vault-Index Dot-Ordner (.qollab/) vollständig ignoriert: getAbstractFileByPath
// liefert dort null, getFiles() enthält die Dateien nie, vault.on feuert nicht.
// Der Adapter greift dagegen direkt auf das Dateisystem zu und sieht sie.
//
// Bewusst schmaler als Obsidians DataAdapter — nur die von Qollab genutzten
// Methoden. writeBinary akzeptiert Uint8Array ODER ArrayBuffer; die konkrete
// Obsidian-Bindung in main.ts konvertiert vor dem echten Aufruf nach ArrayBuffer.
export interface SidecarAdapter {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  rename(oldPath: string, newPath: string): Promise<void>;
  // Nur auf Desktop (FileSystemAdapter): absoluter Pfad der Vault-Wurzel. Fehlt er
  // (Mobile, Test-Mocks), läuft das Listing über adapter.list.
  getBasePath?(): string;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

// Legt folderPath samt fehlender Elternordner an. Rekursives mkdir über den
// Adapter; exists-Check pro Ebene, damit ein bereits vorhandener Ordner kein
// Fehler ist. Der try/catch fängt den Parallel-Create durch einen zweiten
// Prozess ab (Race zwischen Check und mkdir).
export async function ensureSidecarFolder(
  adapter: SidecarAdapter,
  folderPath: string
): Promise<void> {
  if (!folderPath) return;
  if (await adapter.exists(folderPath)) return;
  const parent = dirname(folderPath);
  if (parent) await ensureSidecarFolder(adapter, parent);
  try {
    await adapter.mkdir(folderPath);
  } catch {
    // Ordner zwischen Check und mkdir von anderem Prozess angelegt — ok.
  }
}

// Task 12: adapter.list liefert für .qollab/ nachweislich eine verzögerte Sicht —
// im Realtest war eine seit t=0 auf der Platte liegende Fremd-Sidecar ~50 s lang
// unsichtbar. Ein Merge auf dieser Sicht hält eine vorhandene Fremd-Op für nicht
// existent und erfindet sie beim .md-Diff als eigene Op (permanentes Duplikat).
// Deshalb auf Desktop direkt am Dateisystem lesen; adapter.list bleibt Fallback
// für Mobile/fehlendes fs.
interface FsLike {
  promises: {
    readdir(
      path: string,
      opts: { withFileTypes: true }
    ): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  };
}

// Laufzeit-Feature-Check statt Build-Flag: esbuild markiert Node-Builtins als
// external, im CJS-Bundle bleibt also ein echtes require('fs') stehen. Auf Mobile
// (kein Node) wirft es — dann null und der Adapter-Pfad greift.
let fsCache: FsLike | null | undefined;
function loadFs(): FsLike | null {
  if (fsCache !== undefined) return fsCache;
  try {
    fsCache = require('fs') as FsLike;
  } catch {
    fsCache = null;
  }
  return fsCache;
}

// Cache-freies, nicht-rekursives Listing eines vault-relativen Verzeichnisses.
// null = kein Direktzugriff möglich (kein Basispfad, kein fs, Lesefehler) → der
// Aufrufer nimmt den Adapter-Pfad. Rückgabepfade sind vault-relativ mit '/'.
async function listDirFresh(
  adapter: SidecarAdapter,
  dir: string
): Promise<{ files: string[]; folders: string[] } | null> {
  const base = adapter.getBasePath?.();
  if (!base) return null;
  const fs = loadFs();
  if (!fs) return null;
  try {
    const entries = await fs.promises.readdir(`${base}/${dir}`, { withFileTypes: true });
    const files: string[] = [];
    const folders: string[] = [];
    for (const e of entries) {
      // Nur echte Verzeichnisse werden weiterverfolgt; alles andere (inkl.
      // Symlinks) zählt als Datei — sonst liefe der Walk auf einen Nicht-Ordner.
      (e.isDirectory() ? folders : files).push(`${dir}/${e.name}`);
    }
    return { files, folders };
  } catch {
    // Ordner fehlt oder ist gerade nicht lesbar → Adapter-Pfad entscheidet
    // (dessen exists-Check liefert für einen fehlenden Ordner die leere Liste).
    return null;
  }
}

// Listet die .yjs-Siblings EXAKT dieser Note. Die Sidecars einer Note liegen alle
// direkt im Verzeichnis dirname('.qollab/' + notePath) — daher genügt ein
// nicht-rekursives Listing dieses einen Ordners, gefiltert über filterYjsFiles.
// Existiert der Ordner nicht, ist die Liste leer.
export async function listYjsInDir(
  adapter: SidecarAdapter,
  notePath: string
): Promise<string[]> {
  const dir = dirname(`${QOLLAB_DIR}/${notePath}`) || QOLLAB_DIR;
  const fresh = await listDirFresh(adapter, dir);
  if (fresh) return filterYjsFiles(fresh.files, notePath);
  if (!(await adapter.exists(dir))) return [];
  const { files } = await adapter.list(dir);
  return filterYjsFiles(files, notePath);
}

// Listet den gesamten .qollab-Baum rekursiv (alle Sidecar-Dateipfade). Für den
// Poll-Scan des SidecarWatcher, der nichts über einzelne Note-Pfade weiß. Nutzt
// dasselbe cache-freie Listing wie listYjsInDir (kein zweiter Listing-Pfad).
export async function listAllSidecars(adapter: SidecarAdapter): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const fresh = await listDirFresh(adapter, dir);
    let listing: { files: string[]; folders: string[] };
    if (fresh) {
      listing = fresh;
    } else {
      if (!(await adapter.exists(dir))) return;
      listing = await adapter.list(dir);
    }
    for (const f of listing.files) out.push(f);
    for (const sub of listing.folders) await walk(sub);
  };
  await walk(QOLLAB_DIR);
  return out;
}
