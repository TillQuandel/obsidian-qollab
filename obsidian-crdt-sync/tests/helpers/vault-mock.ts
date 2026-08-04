// Gemeinsamer Vault-Mock, der Obsidians ECHTES Verhalten abbildet (Task 10, C.1):
//
//   - Der Vault-Index ist BLIND für Dot-Ordner: getAbstractFileByPath('.qollab/…')
//     liefert null, getFiles()/getMarkdownFiles() enthalten keine .qollab-Dateien.
//   - Sidecars leben ausschließlich hinter dem Adapter (exists/readBinary/
//     writeBinary/remove/mkdir/stat/list/rename) über derselben In-Memory-Ablage.
//   - .md-Notes sind indiziert (Vault-API read/process) UND adapter-sichtbar.
//
// Damit reproduziert der Mock die Dot-Ordner-Blindheit, an der der frühere
// index-basierte IO-Pfad in echten Vaults still scheiterte. listYjsFiles nutzt den
// Produktions-Helper listYjsInDir über dem Adapter — der reale Listing-Pfad.

import { TFile } from 'obsidian';
import {
  listYjsInDir,
  dirname,
  type SidecarAdapter,
  type DirListingCache,
} from '../../src/sidecar-io';

export function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return (data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data) as ArrayBuffer;
}

// Für den Vault-Index unsichtbar, sobald ein Pfadsegment mit '.' beginnt.
const isDot = (p: string) => p.split('/').some((s) => s.startsWith('.'));

export interface VaultMock {
  getAbstractFileByPath(path: string): TFile | null;
  getFiles(): TFile[];
  getMarkdownFiles(): TFile[];
  read(file: { path: string }): Promise<string>;
  process(file: { path: string }, fn: (data: string) => string): Promise<string>;
  adapter: SidecarAdapter;
  listYjsFiles(notePath: string, cache?: DirListingCache): Promise<string[]>;
  _files: Map<string, ArrayBuffer>;
  _textFiles: Map<string, string>;
  _mtimes: Map<string, number>;
  _mdMtimes: Map<string, number>;
  _folders: Set<string>;
  _writeCount: Map<string, number>; // adapter.writeBinary-Aufrufe pro Pfad
}

// Task 14: Obsidians App.loadLocalStorage/saveLocalStorage. Der Speicher liegt im
// Electron-Profil des GERÄTS, nie im Vault — er wird also von OneDrive/Syncthing
// nicht mitkopiert. Genau das bildet der Mock ab: jede Instanz ist ein eigenes
// Gerät. Zwei Geräte am selben (geteilten) Vault-Mock bekommen deshalb je einen
// eigenen Store, während sie sich die Dateien teilen.
export interface LocalStorageMock {
  loadLocalStorage(key: string): any | null;
  saveLocalStorage(key: string, data: unknown | null): void;
  _store: Map<string, unknown>;
}

export function makeLocalStorage(): LocalStorageMock {
  const store = new Map<string, unknown>();
  return {
    loadLocalStorage: (key: string) => (store.has(key) ? store.get(key) : null),
    saveLocalStorage: (key: string, data: unknown | null) => {
      if (data === null) store.delete(key);
      else store.set(key, data);
    },
    _store: store,
  };
}

export function makeVaultMock(): VaultMock {
  const files = new Map<string, ArrayBuffer>(); // Sidecars (.qollab/…)
  const textFiles = new Map<string, string>(); // .md-Notes (indiziert)
  const mtimes = new Map<string, number>(); // Sidecar-mtimes
  const mdMtimes = new Map<string, number>(); // .md-mtimes
  const folders = new Set<string>(); // explizit angelegte (ggf. leere) Ordner
  const writeCount = new Map<string, number>(); // writeBinary-Aufrufe pro Pfad
  let clock = 0;

  const tfile = (p: string): TFile => {
    const f = new TFile();
    f.path = p;
    f.name = p.split('/').pop() ?? p;
    // Task 19/B: `size` folgt dem Inhalt, wie in Obsidian (`TFile.stat` wird aus
    // einem echten `lstat` gefüllt). Vorher stand hier fest 0 — damit war die
    // zweite Hälfte der (mtime, size)-Heuristik im Mock nicht prüfbar.
    f.stat = { mtime: mdMtimes.get(p) ?? 0, ctime: 0, size: (textFiles.get(p) ?? '').length };
    return f;
  };

  // Ein Ordner existiert, sobald irgendetwas darin liegt — Sidecar ODER .md. Die
  // `.md`-Hälfte fehlte: `adapter.exists('Ordner')` war `false`, obwohl
  // `Ordner/note.md` im Vault lag. Damit war „der Ordner der Note ist weg" im Mock
  // nicht von „der Ordner ist da" unterscheidbar (R3-F4).
  const folderExists = (dir: string): boolean =>
    folders.has(dir) ||
    [...files.keys()].some((k) => k.startsWith(dir + '/')) ||
    [...textFiles.keys()].some((k) => k.startsWith(dir + '/'));

  const listDir = (dir: string): { files: string[]; folders: string[] } => {
    const outFiles: string[] = [];
    const outFolders = new Set<string>();
    for (const key of files.keys()) {
      if (dirname(key) === dir) outFiles.push(key);
      else if (key.startsWith(dir + '/')) {
        const seg = key.slice(dir.length + 1).split('/')[0];
        outFolders.add(dir + '/' + seg);
      }
    }
    for (const f of folders) {
      if (dirname(f) === dir) outFolders.add(f);
    }
    return { files: outFiles, folders: [...outFolders] };
  };

  // Die drei als `@public` dokumentierten Textmethoden des DataAdapters. Sie
  // gehoeren zum Mock, seit Herkunft eine Rolle spielt: Obsidians Vault-API
  // schreibt `.md`-Dateien ueber genau sie, ein Datei-Sync schreibt am Prozess
  // vorbei. Ohne sie waere im Mock beides ununterscheidbar — und alles „fremd".
  //
  // Faustregel fuer Tests:
  //   `tippeMd(vault, pfad, text)`   = prozessintern (Nutzer tippt, Plugin schreibt)
  //   `vault._textFiles.set(...)`    = von aussen geliefert (Datei-Sync, Notepad)
  const adapter: SidecarAdapter & {
    write(p: string, data: string): Promise<void>;
    append(p: string, data: string): Promise<void>;
    process(p: string, fn: (data: string) => string): Promise<string>;
  } = {
    write: async (p: string, data: string) => {
      textFiles.set(p, data);
      mdMtimes.set(p, ++clock);
    },
    append: async (p: string, data: string) => {
      textFiles.set(p, (textFiles.get(p) ?? '') + data);
      mdMtimes.set(p, ++clock);
    },
    process: async (p: string, fn: (data: string) => string) => {
      const cur = textFiles.get(p) ?? '';
      const next = fn(cur);
      if (next !== cur) {
        textFiles.set(p, next);
        mdMtimes.set(p, ++clock);
      }
      return next;
    },
    exists: async (p: string) => files.has(p) || textFiles.has(p) || folderExists(p),
    readBinary: async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT: ' + p);
      return files.get(p)!;
    },
    writeBinary: async (p: string, data: ArrayBuffer | Uint8Array) => {
      files.set(p, toArrayBuffer(data));
      mtimes.set(p, ++clock);
      writeCount.set(p, (writeCount.get(p) ?? 0) + 1);
    },
    remove: async (p: string) => {
      files.delete(p);
      mtimes.delete(p);
    },
    mkdir: async (p: string) => {
      folders.add(p);
    },
    stat: async (p: string) => {
      if (files.has(p))
        return { type: 'file', mtime: mtimes.get(p) ?? 0, ctime: 0, size: files.get(p)!.byteLength };
      if (folderExists(p)) return { type: 'folder', mtime: 0, ctime: 0, size: 0 };
      return null;
    },
    list: async (dir: string) => listDir(dir),
    rename: async (from: string, to: string) => {
      if (!files.has(from)) return;
      files.set(to, files.get(from)!);
      files.delete(from);
      mtimes.set(to, mtimes.get(from) ?? ++clock);
      mtimes.delete(from);
    },
  };

  return {
    getAbstractFileByPath: (p: string) => {
      if (isDot(p)) return null; // BLIND für Dot-Ordner (Obsidian-Realität)
      return textFiles.has(p) ? tfile(p) : null;
    },
    getFiles: () => [...textFiles.keys()].map(tfile),
    getMarkdownFiles: () => [...textFiles.keys()].filter((p) => p.endsWith('.md')).map(tfile),
    read: async (file: { path: string }) => textFiles.get(file.path) ?? '',
    // Ueber den Adapter, nicht daran vorbei: Ein Write des Plugins muss im Mock
    // denselben Weg nehmen wie in Obsidian, sonst sieht die Schreibspur ihn nicht
    // und der eigene Write-Back gilt als fremd.
    process: (file: { path: string }, fn: (data: string) => string) =>
      adapter.process(file.path, fn),
    adapter,
    listYjsFiles: (notePath: string, cache?: DirListingCache) =>
      listYjsInDir(adapter, notePath, cache),
    _files: files,
    _textFiles: textFiles,
    _mtimes: mtimes,
    _mdMtimes: mdMtimes,
    _folders: folders,
    _writeCount: writeCount,
  };
}

// Ein Schreibvorgang DIESES Prozesses — was im echten Obsidian ein Tastendruck
// mit Editor-Autosave, eine Kernfunktion oder ein fremdes Plugin auslöst. Läuft
// über den Adapter und ist damit für die Schreibspur als eigen erkennbar.
//
// Das Gegenstück ist `vault._textFiles.set(...)`: die Datei erscheint, ohne dass
// dieser Prozess sie geschrieben hat — ein Datei-Sync oder ein externer Editor.
export async function tippeMd(vault: VaultMock, path: string, text: string): Promise<void> {
  await (vault.adapter as unknown as { write(p: string, d: string): Promise<void> }).write(
    path,
    text
  );
}
