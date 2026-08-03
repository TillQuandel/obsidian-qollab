// Szenariosuche R3-F8 — Umbenennung, die NUR die Groß-/Kleinschreibung ändert.
//
// Qollab verlässt sich stillschweigend auf eine Invariante: Der Note-Pfad, den
// der Wächter aus dem DATEINAMEN einer Hilfsdatei zurückrechnet (`QOLLAB_RE`),
// ist zeichengleich mit dem Pfad der Note im Obsidian-Index. Bricht sie, gibt
// `onRemoteYjsUpdate` `true` zurück („verwaiste Hilfsdatei ohne .md, gilt als
// erledigt") — der Trigger ist verbraucht, `lastSeen` rückt vor, und der Stand
// des anderen Geräts erreicht die Note nie. Still und dauerhaft:
// `getAbstractFileByPath` ist laut `obsidian.d.ts:6399` ausdrücklich
// **case sensitive**.
//
// GEMESSEN auf diesem Rechner (NTFS, Node `fs.promises`), nicht argumentiert:
//
//   1. `rename('Notiz.md.x.yjs', 'notiz.md.x.yjs')` — gelingt, der Name auf der
//      Platte trägt danach die neue Schreibweise. Der reine DATEI-Fall ist damit
//      NICHT beschädigt (Kontrolltest unten pinnt das).
//   2. `stat('ordner')` findet das vorhandene `Ordner` — jeder Existenz-Check ist
//      blind für die Schreibweise, `ensureSidecarFolder` legt also nichts an.
//   3. `rename('Ordner/x', 'ordner/x')` — gelingt, aber das Verzeichnis heißt
//      danach weiter `Ordner`. Ein Blattname zieht mit um, ein ORDNERname nicht.
//   4. `writeFile('NOTIZ.md.x.yjs', …)` auf eine vorhandene `notiz.md.x.yjs`
//      schreibt in die vorhandene Datei und lässt ihren Namen unverändert — der
//      Name konvergiert also auch durch spätere `saveState`-Aufrufe nie.
//   5. `rename('Ordner', 'ordner')` auf das VERZEICHNIS — gelingt, der Name
//      trägt danach die neue Schreibweise. (Das ist der Fix.)
//
// Aus Obsidian 1.12 (`resources/obsidian.asar`, `FileSystemAdapter`) gelesen,
// ebenfalls nicht geraten: `rename` wirft „Destination file already exists!" nur,
// wenn `!this.insensitive || from.toLowerCase() !== to.toLowerCase()` — eine
// reine Schreibweisen-Umbenennung ist ausdrücklich ausgenommen und läuft in
// `fs.rename`. `insensitive` wird beim Start gemessen (`.OBSIDIANTEST`). Und beim
// Umbenennen eines ORDNERS feuert der Adapter `renamed` zusätzlich für jeden
// Nachfahren, was die Vault zu einem `rename`-Event je `.md` macht — der Handler
// dieses Plugins bekommt den Fall also zugestellt.
//
// Schadensweg: Benennt die Nutzerin einen Ordner nur in der Schreibweise um
// (`Ordner` → `ordner`), kommt für jede `.md` darin ein `rename`-Event. Der
// Handler zieht die Hilfsdateien nach `.qollab/ordner/…` um — laut Messung 2+3
// ein Nichts-Tun ohne Wurf: das Verzeichnis heißt weiter `.qollab/Ordner`. Kein
// Wurf heißt `misslungen === false`, also läuft weder eine Warnung noch die
// Reparatur aus `e71a372`. Ab jetzt liest der Wächter `.qollab/Ordner/a.md.…`,
// rechnet daraus `Ordner/a.md` zurück, findet dort keine Note — und verbucht den
// Trigger als erledigt.
//
// Das Dateisystem ist hier als Mock modelliert, aber ausschließlich mit den fünf
// oben gemessenen Regeln.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import { dirname } from '../src/sidecar-io';
import { makeVaultMock, makeLocalStorage, toArrayBuffer, VaultMock } from './helpers/vault-mock';

const ORDNER_ALT = 'Ordner';
const ORDNER_NEU = 'ordner';
const ALT = `${ORDNER_ALT}/a.md`;
const NEU = `${ORDNER_NEU}/a.md`;
const TEXT = 'Zeile 1\nZeile 2\n';
const FREMD_ID = 'beef1234';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

const blatt = (p: string) => p.slice(p.lastIndexOf('/') + 1);

// Legt ein case-insensitives Dateisystem über den bestehenden Vault-Mock. Nur die
// fünf gemessenen Regeln, nichts darüber hinaus. Der Vault-INDEX bleibt bewusst
// case-sensitiv (`getAbstractFileByPath`, siehe obsidian.d.ts) — genau dieses
// Gefälle ist der Fehler.
function caseInsensitiv(vault: VaultMock): VaultMock {
  const roh = vault.adapter;

  const alleRealen = (): string[] => [
    ...vault._files.keys(),
    ...vault._textFiles.keys(),
    ...vault._folders,
  ];

  // Löst einen Pfad Segment für Segment gegen die tatsächlich vorhandenen Namen
  // auf. Was es nicht gibt, bleibt wie angefragt (so verhält sich ein `stat` auf
  // einen fehlenden Pfad auch).
  const real = (pfad: string): string => {
    let aus = '';
    for (const seg of pfad.split('/')) {
      const angefragt = aus ? `${aus}/${seg}` : seg;
      const tiefe = angefragt.split('/').length;
      const vorhanden = alleRealen()
        .map((k) => k.split('/').slice(0, tiefe).join('/'))
        .find((k) => k.split('/').length === tiefe && k.toLowerCase() === angefragt.toLowerCase());
      aus = vorhanden ?? angefragt;
    }
    return aus;
  };

  const istOrdner = (p: string) => alleRealen().some((k) => k.startsWith(`${p}/`));

  vault.adapter = {
    ...roh,
    exists: (p) => roh.exists(real(p)),
    stat: (p) => roh.stat(real(p)),
    readBinary: (p) => roh.readBinary(real(p)),
    // Messung 4: der Schreibzugriff trifft die vorhandene Datei und lässt ihren
    // Namen stehen.
    writeBinary: (p, d) => roh.writeBinary(real(p), d),
    remove: (p) => roh.remove(real(p)),
    mkdir: async (p) => {
      if (real(p) !== p) return; // Messung 2: EEXIST, der Ordner ist schon da
      await roh.mkdir(p);
    },
    // `readdir` liefert die ECHTEN Blattnamen; der Produktivcode setzt den Pfad
    // aus dem ANGEFRAGTEN Verzeichnis plus diesem Blatt zusammen (listDirFresh).
    list: async (dir) => {
      const r = await roh.list(real(dir));
      return {
        files: r.files.map((f) => `${dir}/${blatt(f)}`),
        folders: r.folders.map((f) => `${dir}/${blatt(f)}`),
      };
    },
    rename: async (from, to) => {
      const von = real(from);
      // Das Zielverzeichnis wird aufgelöst, der Blattname NICHT — Messung 1 und 3.
      const zielOrdner = dirname(to);
      const nach = zielOrdner ? `${real(zielOrdner)}/${blatt(to)}` : blatt(to);
      if (von === nach) return; // dieselbe Datei unter demselben Namen
      if (istOrdner(von)) {
        // Messung 5: ein Verzeichnis lässt sich umbenennen, der Inhalt zieht mit.
        for (const ablage of [vault._files, vault._textFiles, vault._mtimes] as Array<
          Map<string, any>
        >) {
          for (const k of [...ablage.keys()]) {
            if (k.startsWith(`${von}/`)) {
              ablage.set(`${nach}${k.slice(von.length)}`, ablage.get(k));
              ablage.delete(k);
            }
          }
        }
        for (const f of [...vault._folders]) {
          if (f === von || f.startsWith(`${von}/`)) {
            vault._folders.delete(f);
            vault._folders.add(`${nach}${f.slice(von.length)}`);
          }
        }
        return;
      }
      await roh.rename(von, nach);
    },
  };
  return vault;
}

function makeApp(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const workspace = {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set('ws:' + event, cb);
      return { __event: 'ws:' + event };
    },
    offref: () => {},
    onLayoutReady: () => {}, // Sweep bewusst nicht starten
  };
  const storage = makeLocalStorage();
  return {
    app: {
      vault: vaultWithEvents,
      workspace,
      loadLocalStorage: storage.loadLocalStorage,
      saveLocalStorage: storage.saveLocalStorage,
    },
    handlers,
  };
}

async function ladePlugin(vault: VaultMock) {
  const { app, handlers } = makeApp(vault);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers };
}

const eigenePfad = (plugin: any, notePath: string) => `.qollab/${notePath}.${plugin.clientId}.yjs`;

// Hilfsdatei des anderen Geräts auf DERSELBEN Inkarnation (gleiche Kennung), damit
// der Fall ein gewöhnlicher Merge bleibt und keine Inkarnations-Auflösung.
function fremdenStandLegen(vault: VaultMock, eigenerPfad: string, notePath: string, text: string) {
  const eigen = decodeStateFile(new Uint8Array(vault._files.get(eigenerPfad)!));
  const peer = new CrdtManager();
  peer.applyUpdate(notePath, eigen.update);
  peer.setContent(notePath, text);
  const bytes = encodeStateFile(eigen.guid!, peer.encodeState(notePath));
  vault._files.set(`${dirname(eigenerPfad)}/${blatt(notePath)}.${FREMD_ID}.yjs`, toArrayBuffer(bytes));
}

// Aufbau: lebende Historie unter `Ordner/a.md`, ein Stand des anderen Geräts
// daneben, dann die reine Schreibweisen-Umbenennung des ORDNERS. Obsidian stellt
// sie als `rename`-Event je `.md` zu (aus dem Adapter-Code gelesen).
async function ordnerSchreibweiseUmbenennen() {
  const vault = caseInsensitiv(makeVaultMock());
  vault._textFiles.set(ALT, TEXT);

  const { plugin, handlers } = await ladePlugin(vault);
  const datei = tfile(ALT);
  await handlers.get('modify')!(datei);

  fremdenStandLegen(vault, eigenePfad(plugin, ALT), ALT, `${TEXT}PEER\n`);

  // Obsidian hat den Ordner auf der Platte umbenannt (gemessen: das gelingt) und
  // den Index nachgezogen; `TFile.path` mutiert in place.
  await vault.adapter.rename(ORDNER_ALT, ORDNER_NEU);
  datei.path = NEU;
  await handlers.get('rename')!(datei, ALT);

  return { vault, plugin, handlers, datei };
}

describe('Umbenennung nur der Groß-/Kleinschreibung', () => {
  it('die Hilfsdateien tragen danach die neue Schreibweise des Ordners', async () => {
    const { vault } = await ordnerSchreibweiseUmbenennen();
    const liegen = [...vault._files.keys()].filter((k) => k.endsWith('.yjs'));
    expect(liegen.length).toBeGreaterThan(0);
    // Der Wächter rechnet den Note-Pfad aus genau diesen Namen zurück. Steht dort
    // die alte Schreibweise, zeigt er auf eine Note, die es nicht gibt.
    expect(liegen.filter((k) => k.startsWith(`.qollab/${ORDNER_ALT}/`))).toEqual([]);
  });

  it('der Stand des anderen Geräts erreicht die Note weiterhin', async () => {
    const { vault, plugin } = await ordnerSchreibweiseUmbenennen();
    // Der Poll ist der einzige Weg, auf dem ein Fremd-Stand ohne lokalen Edit
    // hereinkommt. Er darf den Trigger nicht als erledigt verbuchen.
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NEU)).toContain('PEER');
  });

  it('ein zweiter Poll bringt einen späteren Fremd-Stand ebenfalls an', async () => {
    const { vault, plugin } = await ordnerSchreibweiseUmbenennen();
    await plugin.sidecarWatcher.poll();
    // Das andere Gerät schreibt erneut — der Trigger muss weiter greifen.
    fremdenStandLegen(vault, eigenePfad(plugin, NEU), NEU, `${TEXT}PEER\nSPAETER\n`);
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NEU)).toContain('SPAETER');
  });

  it('Kontrolle: die reine DATEI-Umbenennung war nie beschädigt', async () => {
    // Messung 1: ein Blattname zieht mit um. Dieser Test hält fest, dass der Fix
    // an der richtigen Stelle sitzt — nicht am Dateinamen, sondern am Ordner.
    const vault = caseInsensitiv(makeVaultMock());
    vault._textFiles.set('Notiz.md', TEXT);
    const { plugin, handlers } = await ladePlugin(vault);
    const datei = tfile('Notiz.md');
    await handlers.get('modify')!(datei);
    fremdenStandLegen(vault, eigenePfad(plugin, 'Notiz.md'), 'Notiz.md', `${TEXT}PEER\n`);

    vault._textFiles.set('notiz.md', vault._textFiles.get('Notiz.md')!);
    vault._textFiles.delete('Notiz.md');
    datei.path = 'notiz.md';
    await handlers.get('rename')!(datei, 'Notiz.md');

    expect([...vault._files.keys()].filter((k) => k.startsWith('.qollab/Notiz.md'))).toEqual([]);
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get('notiz.md')).toContain('PEER');
  });

  it('Kontrolle: ein gewöhnlicher Ordner-Umzug bleibt unberührt', async () => {
    const vault = caseInsensitiv(makeVaultMock());
    vault._textFiles.set(ALT, TEXT);
    const { plugin, handlers } = await ladePlugin(vault);
    const datei = tfile(ALT);
    await handlers.get('modify')!(datei);
    fremdenStandLegen(vault, eigenePfad(plugin, ALT), ALT, `${TEXT}PEER\n`);

    const ziel = 'Anderer/a.md';
    vault._textFiles.set(ziel, vault._textFiles.get(ALT)!);
    vault._textFiles.delete(ALT);
    datei.path = ziel;
    await handlers.get('rename')!(datei, ALT);

    expect([...vault._files.keys()].filter((k) => k.startsWith(`.qollab/${ORDNER_ALT}/`))).toEqual(
      []
    );
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(ziel)).toContain('PEER');
  });
});
