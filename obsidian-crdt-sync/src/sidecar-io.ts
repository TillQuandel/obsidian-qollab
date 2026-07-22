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
  stat(path: string): Promise<{ mtime: number } | null>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  rename(oldPath: string, newPath: string): Promise<void>;
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

// Listet die .yjs-Siblings EXAKT dieser Note. Die Sidecars einer Note liegen alle
// direkt im Verzeichnis dirname('.qollab/' + notePath) — daher genügt ein
// nicht-rekursives adapter.list dieses einen Ordners, gefiltert über
// filterYjsFiles. Existiert der Ordner nicht, ist die Liste leer.
export async function listYjsInDir(
  adapter: SidecarAdapter,
  notePath: string
): Promise<string[]> {
  const dir = dirname(`${QOLLAB_DIR}/${notePath}`);
  if (dir && !(await adapter.exists(dir))) return [];
  const { files } = await adapter.list(dir || QOLLAB_DIR);
  return filterYjsFiles(files, notePath);
}

// Listet den gesamten .qollab-Baum rekursiv (alle Sidecar-Dateipfade). Für den
// Poll-Scan des SidecarWatcher, der nichts über einzelne Note-Pfade weiß.
export async function listAllSidecars(adapter: SidecarAdapter): Promise<string[]> {
  if (!(await adapter.exists(QOLLAB_DIR))) return [];
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const { files, folders } = await adapter.list(dir);
    for (const f of files) out.push(f);
    for (const sub of folders) await walk(sub);
  };
  await walk(QOLLAB_DIR);
  return out;
}
