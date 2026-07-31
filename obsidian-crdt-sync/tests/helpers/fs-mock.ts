// fs-Mock für den DESKTOP-Lesepfad.
//
// Warum es das braucht (Szenariosuche 2026-07-31, Mutationsproben):
// `makeVaultMock` liefert kein `getBasePath`. `fsTarget()` steigt deshalb aus,
// und alle Tests laufen über den Adapter-Zweig von `sidecar-io.ts`. Auf dem
// Desktop bindet `main.ts` `getBasePath` aber IMMER — dort geht jeder
// Sidecar-Read/Stat/List über `fs.promises`. Gemessen: Verschmilzt man dort die
// beiden Fehlerklassen („Datei fehlt" vs. „gerade nicht lesbar"), bleiben
// 278/278 Tests grün; dieselbe Mutation im Adapter-Zweig macht 68 rot.
//
// Der real genutzte Pfad war damit ungetestet — und genau dort sitzt die
// Unterscheidung, die Task 12 als sicherheitskritisch bezeichnet.
//
// Statt echtem Datei-IO (langsam, flaky, Aufräumpflicht) leitet dieser Mock
// `fs.promises` auf dieselbe In-Memory-Ablage um, die der Vault-Mock benutzt.
// Der Produktivcode nimmt dadurch den fs-Zweig, ohne dass ein einziges Byte auf
// die Platte geht.
//
// Einbindung in einer Suite (die Fabrik wird gehoistet, deshalb `require`):
//
//   jest.mock('fs', () => require('./helpers/fs-mock').fsMockModule);
//
// und im Test `bindFsMock(vault)` aufrufen, damit `getBasePath` gesetzt ist und
// der Mock die Ablage dieses Vaults sieht.

const BASE = '/vault';

interface Ablage {
  files: Map<string, ArrayBuffer>;
  textFiles: Map<string, string>;
  mtimes?: Map<string, number>;
}

let aktiv: Ablage | null = null;

// Fehler, die der Mock beim nächsten Zugriff auf einen Pfad werfen soll —
// damit Suiten IO-Störungen im fs-Zweig injizieren können, so wie sie es heute
// über `adapter.readBinary` im Adapter-Zweig tun.
const fehler = new Map<string, { err: NodeJS.ErrnoException; einmal: boolean }>();

function relativ(abs: string): string {
  const p = abs.replace(/\\/g, '/');
  return p.startsWith(`${BASE}/`) ? p.slice(BASE.length + 1) : p;
}

function enoent(pfad: string): NodeJS.ErrnoException {
  const e = new Error(`ENOENT: no such file or directory, '${pfad}'`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

function pruefeFehler(rel: string): void {
  const eintrag = fehler.get(rel);
  if (!eintrag) return;
  if (eintrag.einmal) fehler.delete(rel);
  throw eintrag.err;
}

function inhalt(rel: string): ArrayBuffer | undefined {
  if (!aktiv) return undefined;
  const bin = aktiv.files.get(rel);
  if (bin) return bin;
  const text = aktiv.textFiles.get(rel);
  if (text === undefined) return undefined;
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export const fsMockModule = {
  promises: {
    async readFile(abs: string): Promise<Buffer> {
      const rel = relativ(abs);
      pruefeFehler(rel);
      const buf = inhalt(rel);
      if (buf === undefined) throw enoent(abs);
      return Buffer.from(new Uint8Array(buf));
    },
    async stat(abs: string): Promise<{ mtimeMs: number; size: number; isDirectory(): boolean }> {
      const rel = relativ(abs);
      pruefeFehler(rel);
      const buf = inhalt(rel);
      if (buf === undefined) {
        // Ordner: existiert, sobald irgendein Pfad darunter liegt.
        const istOrdner = aktiv
          ? [...aktiv.files.keys(), ...aktiv.textFiles.keys()].some((k) => k.startsWith(`${rel}/`))
          : false;
        if (!istOrdner) throw enoent(abs);
        return { mtimeMs: 0, size: 0, isDirectory: () => true };
      }
      return {
        mtimeMs: aktiv?.mtimes?.get(rel) ?? 1,
        size: buf.byteLength,
        isDirectory: () => false,
      };
    },
    async readdir(abs: string): Promise<string[]> {
      const rel = relativ(abs);
      pruefeFehler(rel);
      if (!aktiv) return [];
      const praefix = rel === '' ? '' : `${rel}/`;
      const namen = new Set<string>();
      for (const k of [...aktiv.files.keys(), ...aktiv.textFiles.keys()]) {
        if (!k.startsWith(praefix)) continue;
        const rest = k.slice(praefix.length);
        if (rest.length === 0) continue;
        namen.add(rest.split('/')[0]);
      }
      if (namen.size === 0) throw enoent(abs);
      return [...namen];
    },
  },
};

// Verbindet den Mock mit der Ablage eines Vault-Mocks und setzt `getBasePath`,
// damit der Produktivcode den fs-Zweig nimmt.
export function bindFsMock(vault: {
  _files: Map<string, ArrayBuffer>;
  _textFiles: Map<string, string>;
  _mdMtimes?: Map<string, number>;
  adapter: { getBasePath?: () => string };
}): void {
  aktiv = { files: vault._files, textFiles: vault._textFiles, mtimes: vault._mdMtimes };
  fehler.clear();
  vault.adapter.getBasePath = () => BASE;
}

// IO-Störung im fs-Zweig injizieren — das Gegenstück zu den bestehenden
// `adapter.readBinary`-Injektionen, die nur den Adapter-Zweig treffen.
export function fsFehler(relPfad: string, code: string, einmal = false): void {
  const e = new Error(`${code}: injiziert für ${relPfad}`) as NodeJS.ErrnoException;
  e.code = code;
  fehler.set(relPfad, { err: e, einmal });
}

export function fsFehlerLoeschen(relPfad?: string): void {
  if (relPfad === undefined) fehler.clear();
  else fehler.delete(relPfad);
}
