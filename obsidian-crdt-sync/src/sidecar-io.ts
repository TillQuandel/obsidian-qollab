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
  // Task 12: frischer Check. Eine stale „existiert"-Antwort würde das mkdir
  // überspringen und den folgenden writeBinary auf einen fehlenden Ordner werfen
  // lassen (Obsidians writeBinary legt Elternordner nicht an).
  if (await sidecarExists(adapter, folderPath)) return;
  const parent = dirname(folderPath);
  if (parent) await ensureSidecarFolder(adapter, parent);
  try {
    await adapter.mkdir(folderPath);
  } catch {
    // Ordner zwischen Check und mkdir von anderem Prozess angelegt — ok.
  }
}

// Task 12: die Adapter-Sicht auf .qollab/ ist nachweislich verzögert — im Realtest
// war eine seit t=0 auf der Platte liegende Fremd-Sidecar ~50 s lang unsichtbar.
// Ein Merge auf dieser Sicht hält eine vorhandene Fremd-Op für nicht existent und
// erfindet sie beim .md-Diff als eigene Op (permanentes Duplikat).
//
// Fix-Runde (Review F-1): Die Verzögerung ist NICHT als list-Eigenschaft belegt —
// H1 ist `[unverifiziert]`. Ein cache-freies Listing allein hätte den Bug nur unter
// dieser unbewiesenen Eingrenzung geschlossen: direkt hinter dem Listing liegt der
// exists/readBinary-Gate derselben Sicht. Deshalb laufen ALLE Sidecar-LESE-Zugriffe
// (list/stat/exists/read) auf Desktop direkt am Dateisystem, mit dem Adapter als
// Fallback. Sidecar-SCHREIBZUGRIFFE bleiben bewusst auf dem Adapter, damit
// Obsidians interner Zustand konsistent bleibt.
interface FsLike {
  promises: {
    readdir(
      path: string,
      opts: { withFileTypes: true }
    ): Promise<Array<{ name: string; isDirectory(): boolean }>>;
    readFile(path: string): Promise<Uint8Array>;
    stat(path: string): Promise<{ mtimeMs: number; size: number }>;
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

// Absoluter Pfad + fs-Handle für einen vault-relativen Pfad. null = kein
// Desktop-Direktzugriff (kein Basispfad → Mobile/Test-Adapter, oder kein fs).
// Einziger Ort, an dem über fs-vs-Adapter entschieden wird.
function fsTarget(adapter: SidecarAdapter, path: string): { fs: FsLike; abs: string } | null {
  const base = adapter.getBasePath?.();
  if (!base) return null;
  const fs = loadFs();
  if (!fs) return null;
  return { fs, abs: `${base}/${path}` };
}

// „Existiert nachweislich nicht" — im Unterschied zu „gerade nicht lesbar".
// ENOTDIR trifft Pfade unterhalb eines fehlenden Ordners.
function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

// Liest eine Sidecar cache-frei. null = existiert nachweislich nicht. Andere
// Fehler (EBUSY, EACCES, Handle) werden GEWORFEN — der Aufrufer darf sie nicht
// als „existiert nicht" werten, sonst merged er auf Halbwissen.
export async function readSidecar(
  adapter: SidecarAdapter,
  path: string
): Promise<ArrayBuffer | null> {
  const target = fsTarget(adapter, path);
  if (target) {
    try {
      const buf = await target.fs.promises.readFile(target.abs);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  // Adapter-Pfad: exists-Check trennt „nicht vorhanden" von „Lesefehler",
  // weil readBinary bei fehlender Datei ebenfalls wirft.
  if (!(await adapter.exists(path))) return null;
  return adapter.readBinary(path);
}

// Cache-freier stat. null = existiert nicht. Bei anderen fs-Fehlern fällt die
// Funktion auf die Adapter-Sicht zurück, statt „existiert nicht" zu behaupten.
export async function statSidecar(
  adapter: SidecarAdapter,
  path: string
): Promise<{ mtime: number; size: number } | null> {
  const target = fsTarget(adapter, path);
  if (target) {
    try {
      const s = await target.fs.promises.stat(target.abs);
      return { mtime: s.mtimeMs, size: s.size };
    } catch (err) {
      if (isNotFound(err)) return null;
      // sonst: Adapter-Sicht als Rückfall
    }
  }
  return adapter.stat(path);
}

// Cache-freier Existenz-Check (Dateien wie Ordner).
export async function sidecarExists(adapter: SidecarAdapter, path: string): Promise<boolean> {
  return (await statSidecar(adapter, path)) !== null;
}

// Cache-freies, nicht-rekursives Listing eines vault-relativen Verzeichnisses.
// null = kein Direktzugriff möglich (kein Basispfad, kein fs, Lesefehler) → der
// Aufrufer nimmt den Adapter-Pfad. Rückgabepfade sind vault-relativ mit '/'.
async function listDirFresh(
  adapter: SidecarAdapter,
  dir: string
): Promise<{ files: string[]; folders: string[] } | null> {
  const target = fsTarget(adapter, dir);
  if (!target) return null;
  try {
    const entries = await target.fs.promises.readdir(target.abs, { withFileTypes: true });
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

// Task 19/B (Hebel 3): Verzeichnis → Dateipfade darin, für die Dauer EINES
// Sweeps. Die Sidecars aller Notes eines Ordners liegen in demselben
// Verzeichnis; ohne diesen Cache liest der Sweep es einmal je Note neu, also
// quadratisch in der Notenzahl je Ordner und multiplikativ in der Gerätezahl.
//
// Bewusst ein Parameter statt eines Modul-Zustands: Der Cache lebt genau so
// lange, wie sein Erzeuger ihn hält (`snapshotStaleMarkdownFiles`). Alles
// andere — Poll, file-open, jeder Merge — listet unverändert frisch. Ein
// dauerhafter Cache wäre in dieser Codebasis der Rückschritt schlechthin: Task
// 12 hat belegt, dass eine veraltete Sicht auf `.qollab/` einen Merge auf
// Halbwissen und damit permanente Duplikate erzeugt.
export type DirListingCache = Map<string, string[]>;

export function createDirListingCache(): DirListingCache {
  return new Map();
}

// Listet die .yjs-Siblings EXAKT dieser Note. Die Sidecars einer Note liegen alle
// direkt im Verzeichnis dirname('.qollab/' + notePath) — daher genügt ein
// nicht-rekursives Listing dieses einen Ordners, gefiltert über filterYjsFiles.
// Existiert der Ordner nicht, ist die Liste leer.
//
// Mit `cache` wird das Verzeichnis höchstens einmal gelesen (siehe
// DirListingCache). Dass ein Aufrufer zwischendurch eine Sidecar LÖSCHT
// (decodeSiblings räumt getombstete und obsolete Legacy-Dateien ab), macht den
// Eintrag nicht gefährlich: gelöscht wird ausschließlich unter den Siblings der
// gerade bearbeiteten Note, und jede Note wird im Sweep genau einmal besucht.
// Ein danach noch gelisteter Pfad führt lediglich zu einem `readStateFile`, das
// „existiert nicht" liefert.
export async function listYjsInDir(
  adapter: SidecarAdapter,
  notePath: string,
  cache?: DirListingCache
): Promise<string[]> {
  const dir = dirname(`${QOLLAB_DIR}/${notePath}`) || QOLLAB_DIR;
  const cached = cache?.get(dir);
  if (cached !== undefined) return filterYjsFiles(cached, notePath);
  const files = await listDirFiles(adapter, dir);
  cache?.set(dir, files);
  return filterYjsFiles(files, notePath);
}

// Alle Dateipfade eines Verzeichnisses — fs-frisch, mit dem Adapter als Rückfall.
// Ein fehlendes Verzeichnis ist die leere Liste.
async function listDirFiles(adapter: SidecarAdapter, dir: string): Promise<string[]> {
  const fresh = await listDirFresh(adapter, dir);
  if (fresh) return fresh.files;
  if (!(await adapter.exists(dir))) return [];
  return (await adapter.list(dir)).files;
}

// Gibt es im .qollab-Baum überhaupt noch EINE Datei? Bricht beim ersten Fund ab
// — im Normalfall (gefüllter Ordner) kostet das ein einziges Verzeichnis-
// Listing, im Verlustfall den Baum, in dem dann ohnehin ein voller Sweep folgt.
// Bewusst nicht über listAllSidecars: das liest immer alles.
//
// Gezählt wird jede Datei, nicht nur gültige Sidecar-Namen: Die Frage lautet
// „ist der Ordner leer?", und eine unlesbare oder halb kopierte Datei ist ein
// Hinweis darauf, dass er es NICHT ist. Ein fehlender Ordner ist leer.
export async function hasAnySidecarFile(adapter: SidecarAdapter): Promise<boolean> {
  const walk = async (dir: string): Promise<boolean> => {
    const fresh = await listDirFresh(adapter, dir);
    let listing: { files: string[]; folders: string[] };
    if (fresh) {
      listing = fresh;
    } else {
      if (!(await adapter.exists(dir))) return false;
      listing = await adapter.list(dir);
    }
    if (listing.files.length > 0) return true;
    // Der Datei-Sync räumt beim Löschen eines Baums die Dateien ab und lässt die
    // Ordner oft stehen — leere Unterordner sind deshalb kein Inhalt.
    for (const sub of listing.folders) {
      if (await walk(sub)) return true;
    }
    return false;
  };
  return walk(QOLLAB_DIR);
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
