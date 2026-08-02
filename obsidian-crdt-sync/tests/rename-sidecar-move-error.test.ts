// Szenariosuche 2026-07-31 (F3) — der Umzug der Hilfsdateien scheitert MITTEN im
// Rename.
//
// Der Hilfsdatei-Pfad ist konstruktiv 22 Zeichen länger als der Note-Pfad
// (Ausschlussliste #5). Ein Rename in einen tieferen Ordner reißt deshalb die
// Windows-Pfadgrenze für die Hilfsdatei, während die `.md` noch passt; zweiter
// Auslöser ist ein Sync-Dienst, der ein Handle auf die gerade geschriebene `.yjs`
// hält. Die Umzugsschleife hatte kein `try`/`catch`: der erste Wurf verließ den
// Handler, die übrigen Dateien blieben liegen und `renameNote` lief NIE.
//
// Der eigentliche Schaden ist nicht die liegengebliebene Datei, sondern der
// ausgefallene `renameNote`: `guids`, `localDiffBase`, `priorPaths`,
// `ownSignatures` und der Doc bleiben auf dem ALTEN Pfad, während die `.md` unter
// dem neuen liegt. Der nächste Edit findet dort weder Doc noch eigenen Stand,
// prägt eine FRISCHE Kennung über einer lebenden Historie — und sobald die
// zurückgebliebene Datei je wieder erreichbar wird, dedupliziert Yjs nach
// Item-ID, nicht nach Inhalt: der Notiztext steht doppelt.
//
// Die Tests bilden beide Auslöser als das ab, was sie im Code sind: ein
// werfendes `adapter.rename` für genau einen Zielpfad.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { decodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

const ALT = 'a.md';
const NEU = 'tief/b.md';
const TEXT = 'Zeile 1\nZeile 2\nZeile 3\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
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
    onLayoutReady: () => {}, // Sweep bewusst NICHT starten
  };
  const storage = makeLocalStorage();
  const app = {
    vault: vaultWithEvents,
    workspace,
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  return { app, handlers };
}

async function loadPlugin(vault: VaultMock) {
  const { app, handlers } = makeApp(vault);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers };
}

const eigenePfad = (plugin: any, notePath: string) => `.qollab/${notePath}.${plugin.clientId}.yjs`;

function kennung(vault: VaultMock, path: string): string | null {
  const buf = vault._files.get(path);
  if (!buf) return null;
  return decodeStateFile(new Uint8Array(buf)).guid;
}

const zaehle = (text: string, nadel: string) => text.split(nadel).length - 1;

// Gemeinsamer Aufbau: lebende Historie unter `a.md`, danach ein Rename nach
// `tief/b.md`, bei dem der Umzug GENAU EINER Hilfsdatei wirft. Der Wurf wird
// gefangen und zurückgegeben, damit jeder Test genau eine Aussage prüft (sonst
// stoppt die erste fehlschlagende Zusicherung alle folgenden).
async function umzugMitFehler(opts: { fremdeDatei?: boolean } = {}) {
  const vault = makeVaultMock();
  vault._textFiles.set(ALT, TEXT);

  const { plugin, handlers } = await loadPlugin(vault);
  const datei = tfile(ALT);

  // 1) Regulärer Edit → eigene Hilfsdatei mit lebender Kennung.
  await handlers.get('modify')!(datei);
  const echteKennung = kennung(vault, eigenePfad(plugin, ALT));

  // Optional eine zweite Hilfsdatei (anderes Gerät), damit sichtbar wird, ob die
  // Schleife nach dem ersten Wurf weiterläuft. Der Inhalt ist hier egal — geprüft
  // wird ausschließlich der Umzug der Datei.
  const fremdAlt = `.qollab/${ALT}.beef1234.yjs`;
  const fremdNeu = `.qollab/${NEU}.beef1234.yjs`;
  if (opts.fremdeDatei) vault._files.set(fremdAlt, new Uint8Array([7, 7, 7]).buffer);

  // 2) Der Umzug der EIGENEN Hilfsdatei scheitert (Pfadgrenze bzw. gehaltenes
  //    Handle). Sie steht in der Auflistung vorn, der Wurf trifft also die erste
  //    Iteration.
  const echtesRename = vault.adapter.rename;
  vault.adapter.rename = async (from: string, to: string) => {
    if (from === eigenePfad(plugin, ALT)) throw new Error('ENAMETOOLONG: ' + to);
    return echtesRename(from, to);
  };

  // 3) Obsidian benennt um: die `.md` wandert, `TFile.path` mutiert IN PLACE.
  vault._textFiles.delete(ALT);
  vault._textFiles.set(NEU, TEXT);
  datei.path = NEU;
  datei.name = 'b.md';

  let wurf: unknown = null;
  await handlers
    .get('rename')!(datei, ALT)
    .catch((e: unknown) => {
      wurf = e;
    });

  return { vault, plugin, handlers, datei, echteKennung, wurf, fremdAlt, fremdNeu };
}

describe('Rename: eine Hilfsdatei zieht nicht mit um', () => {
  it('der Handler wirft nicht', async () => {
    const { wurf } = await umzugMitFehler();
    // Ein Wurf verlässt den Handler als unbehandelte Promise — ohne Meldung, ohne
    // Zähler, ohne Wiederholung. Vor allem aber bricht er ab, BEVOR der Zustand
    // dem neuen Pfad folgt.
    expect(wurf).toBeNull();
  });

  it('die übrigen Hilfsdateien ziehen trotzdem um', async () => {
    const { vault, fremdAlt, fremdNeu } = await umzugMitFehler({ fremdeDatei: true });
    // „Halb umgezogen" ist der Ausgangsschaden — aber nicht dadurch heilbar, dass
    // man beim ersten Fehler aufhört: die `.md` liegt bereits am neuen Pfad, jede
    // dort FEHLENDE Hilfsdatei ist unerreichbar (der Poll steigt ohne `.md` sofort
    // aus). Also so viel umziehen wie möglich.
    expect(vault._files.has(fremdNeu)).toBe(true);
    expect(vault._files.has(fremdAlt)).toBe(false);
  });

  it('der eigene Stand liegt danach unter dem neuen Pfad — mit derselben Kennung', async () => {
    const { vault, plugin, echteKennung } = await umzugMitFehler();
    // Der Umzug der Datei ist gescheitert, der Zustand im Speicher aber nicht: er
    // zieht mit um und wird unter dem neuen Pfad neu geschrieben. Genau das
    // unterscheidet „durchziehen und nachholen" von „zurückrollen".
    expect(echteKennung).not.toBeNull();
    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);
  });

  it('der nächste Edit prägt keine zweite Inkarnation und verdoppelt den Text nicht', async () => {
    const { vault, plugin, handlers, datei, echteKennung } = await umzugMitFehler();

    const TEXT2 = TEXT + 'Zeile 4\n';
    vault._textFiles.set(NEU, TEXT2);
    await handlers.get('modify')!(datei);

    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);
    expect(plugin.crdtManager.getContent(NEU)).toBe(TEXT2);
    expect(zaehle(plugin.crdtManager.getContent(NEU), 'Zeile 1')).toBe(1);
  });

  it('die eigene Leiche bleibt nicht unter dem alten Pfad liegen', async () => {
    const { vault, plugin } = await umzugMitFehler();
    // Eine eigene Hilfsdatei mit LEBENDER Kennung unter einem Pfad, an dem keine
    // Note mehr liegt, ist der Wiederbelebungs-Vektor: wird dort je wieder eine
    // gleichnamige Note angelegt, adoptiert `ensureDoc` die alte Inkarnation samt
    // Text. Entfernt wird sie erst, NACHDEM der Stand nachweislich am neuen Pfad
    // liegt.
    expect(vault._files.has(eigenePfad(plugin, ALT))).toBe(false);
    expect(vault._files.has(eigenePfad(plugin, NEU))).toBe(true);
  });

  it('ohne Doc im Speicher wird der Stand aus der liegengebliebenen Datei nachgezogen', async () => {
    // Der HÄUFIGSTE Rename: eine Note, die in dieser Sitzung nie angefasst wurde.
    // Dann gibt es keinen Doc, aus dem sich der Stand schreiben ließe — die
    // liegengebliebene eigene Datei ist der einzige Träger und wird kopiert.
    // Ein `saveState` wäre hier falsch: ohne Doc schriebe er einen LEEREN Stand
    // unter die lebende Kennung.
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, TEXT);
    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);

    await handlers.get('modify')!(datei);
    const echteKennung = kennung(vault, eigenePfad(plugin, ALT));
    // Sitzungsende simulieren: der Stand liegt auf der Platte, im Speicher nicht.
    plugin.crdtManager.disposeDoc(ALT);

    const echtesRename = vault.adapter.rename;
    vault.adapter.rename = async (from: string, to: string) => {
      if (from === eigenePfad(plugin, ALT)) throw new Error('ENAMETOOLONG: ' + to);
      return echtesRename(from, to);
    };
    vault._textFiles.delete(ALT);
    vault._textFiles.set(NEU, TEXT);
    datei.path = NEU;
    datei.name = 'b.md';
    await handlers.get('rename')!(datei, ALT);

    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);
    expect(vault._files.has(eigenePfad(plugin, ALT))).toBe(false);

    // Und der nächste Edit arbeitet auf derselben Inkarnation weiter.
    const TEXT2 = TEXT + 'Zeile 4\n';
    vault._textFiles.set(NEU, TEXT2);
    await handlers.get('modify')!(datei);
    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);
    expect(zaehle(plugin.crdtManager.getContent(NEU), 'Zeile 1')).toBe(1);
  });

  it('ist die liegengebliebene Datei auch unlesbar, kommt der Stand aus dem Doc', async () => {
    // Der Auslöser „Sync-Dienst hält ein Handle" trifft Umbenennen UND Lesen. Dann
    // gibt es nur noch einen Träger des Standes: den Doc im Speicher. Genau
    // deshalb zieht er beim Rename MIT um, statt verworfen und unter dem neuen
    // Pfad aus der Platte neu aufgebaut zu werden — der Neuaufbau fände dort
    // nichts und prägte eine frische Inkarnation über einer lebenden Historie.
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, TEXT);
    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);

    await handlers.get('modify')!(datei);
    const echteKennung = kennung(vault, eigenePfad(plugin, ALT));

    const echtesRename = vault.adapter.rename;
    vault.adapter.rename = async (from: string, to: string) => {
      if (from === eigenePfad(plugin, ALT)) throw new Error('EBUSY: ' + from);
      return echtesRename(from, to);
    };
    const echtesLesen = vault.adapter.readBinary;
    vault.adapter.readBinary = async (p: string) => {
      if (p === eigenePfad(plugin, ALT)) throw new Error('EBUSY: ' + p);
      return echtesLesen(p);
    };

    vault._textFiles.delete(ALT);
    vault._textFiles.set(NEU, TEXT);
    datei.path = NEU;
    datei.name = 'b.md';
    await handlers.get('rename')!(datei, ALT);

    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);

    const TEXT2 = TEXT + 'Zeile 4\n';
    vault._textFiles.set(NEU, TEXT2);
    await handlers.get('modify')!(datei);
    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);
    expect(plugin.crdtManager.getContent(NEU)).toBe(TEXT2);
    expect(zaehle(plugin.crdtManager.getContent(NEU), 'Zeile 1')).toBe(1);
  });

  it('Kontrolle: ohne Fehler zieht alles um und die Note synct weiter', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, TEXT);
    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);

    await handlers.get('modify')!(datei);
    const echteKennung = kennung(vault, eigenePfad(plugin, ALT));

    vault._textFiles.delete(ALT);
    vault._textFiles.set(NEU, TEXT);
    datei.path = NEU;
    datei.name = 'b.md';
    await handlers.get('rename')!(datei, ALT);

    expect(vault._files.has(eigenePfad(plugin, ALT))).toBe(false);
    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);

    const TEXT2 = TEXT + 'Zeile 4\n';
    vault._textFiles.set(NEU, TEXT2);
    await handlers.get('modify')!(datei);
    expect(kennung(vault, eigenePfad(plugin, NEU))).toBe(echteKennung);
    expect(plugin.crdtManager.getContent(NEU)).toBe(TEXT2);
  });
});
