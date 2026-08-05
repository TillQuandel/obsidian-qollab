// Szenariosuche Welle 2 — Linse „Zustandsübergänge zwischen Versionen"
//
// Gemischte Flotte: EIN Gerät bekommt den neuen Build (master), das zweite läuft
// noch auf dem einzigen Release, das es gibt (`v0.4.0`, 2026-07-28). Genau das
// ist der Normalfall beim Ausrollen — und der Datei-Sync verbindet beide sofort.
//
// Die v0.4.0-Quellen unter `tests/_v040/` sind VERBATIM-Auszüge aus dem Tag
// (`git show v0.4.0:obsidian-crdt-sync/src/<datei>.ts`), keine Nachbauten. Damit
// misst der Test echtes Alt-Verhalten statt vermutetes.

import * as Y from 'yjs';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { encodeStateFile as encodeStateFileV040 } from './_v040/state-file';
import { SyncHandler as SyncHandlerV040 } from './_v040/sync-handler';
import { CrdtManager as CrdtManagerV040 } from './_v040/crdt-manager';
import PluginV040 from './_v040/main';
import MasterPlugin from '../src/main';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB } from './helpers/vault-mock';
import { tombstoneKey } from '../src/tombstones';

const NOTE = 'note.md';
const A_ID = 'aaaaaaaa'; // Gerät A — neuer Build
const B_ID = 'bbbbbbbb'; // Gerät B — Release v0.4.0
const C_ID = 'cccccccc'; // dritte Hilfsdatei
const A_PATH = `.qollab/${NOTE}.${A_ID}.yjs`;
const C_PATH = `.qollab/${NOTE}.${C_ID}.yjs`;
const GUID = 'a'.repeat(32);

function update(text: string): Uint8Array {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return mgr.encodeState(NOTE);
}

// Eine Hilfsdatei, wie sie im BESTAND einer Flotte mit v0.4.0 liegt: QLB1.
// Bewusst über den eingefrorenen v0.4.0-Encoder gebaut, nicht über den aktuellen
// — sonst hinge die Aussage dieser Tests daran, dass beide Formate zufällig
// dasselbe sind. Genau das gilt seit dem QLB2-Wechsel nicht mehr, und die
// Verwechslung ließ R1/R2b hier still das Falsche messen.
function mitHeader(guid: string, text: string): ArrayBuffer {
  return toAB(encodeStateFileV040(guid, update(text)));
}

// Und eine, wie der aktuelle Build sie schreibt: QLB2.
function heutigeSidecar(guid: string, text: string): ArrayBuffer {
  return toAB(encodeStateFile(guid, update(text)));
}

// Der von Task 17/F-1 belegte Realauslöser: OneDrive legt einen größen-
// erhaltenden Platzhalter / eine abgebrochene Hydrierung ab. Unter 20 Byte →
// `hasMagic` false → `guid: null`.
const halbMaterialisiert = (): ArrayBuffer => new Uint8Array(8).buffer;

describe('R1: der v0.4.0-Peer räumt weg, was der F-1-Fix bewusst stehen lässt', () => {
  it('master behält die halb materialisierte Fremd-Sidecar', async () => {
    const vault = makeVaultMock();
    vault._files.set(A_PATH, mitHeader(GUID, 'Text\n'));
    vault._files.set(C_PATH, halbMaterialisiert());
    vault._textFiles.set(NOTE, 'Text\n');

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), A_ID, undefined, (p) =>
      corrupt.push(p)
    );
    await handler.loadAndMerge(NOTE);

    expect(corrupt).toContain(C_PATH); // gemeldet …
    expect(vault._files.has(C_PATH)).toBe(true); // … aber NICHT gelöscht
  });

  it('v0.4.0 löscht dieselbe Datei — und der Sync trägt die Löschung zurück', async () => {
    const vault = makeVaultMock();
    vault._files.set(A_PATH, mitHeader(GUID, 'Text\n'));
    vault._files.set(C_PATH, halbMaterialisiert());
    vault._textFiles.set(NOTE, 'Text\n');

    // Derselbe geteilte Dateibestand, gesehen vom Gerät auf dem Release-Build.
    const handlerB = new SyncHandlerV040(vault as any, new CrdtManagerV040(), B_ID);
    await handlerB.loadAndMerge(NOTE);

    expect(vault._files.has(C_PATH)).toBe(false);
  });

  it('ENTLASTUNG: die EIGENE halb materialisierte Sidecar überlebt auch unter v0.4.0', async () => {
    const vault = makeVaultMock();
    const bPath = `.qollab/${NOTE}.${B_ID}.yjs`;
    vault._files.set(bPath, halbMaterialisiert());
    vault._files.set(A_PATH, mitHeader(GUID, 'Text\n'));
    vault._textFiles.set(NOTE, 'Text\n');

    const handlerB = new SyncHandlerV040(vault as any, new CrdtManagerV040(), B_ID);
    await handlerB.loadAndMerge(NOTE);

    // Gemessen: v0.4.0 kennt den ownPath-Schutz zwar nicht, erreicht die eigene
    // Datei über `decodeSiblings` aber gar nicht — der Schaden trifft
    // ausschliesslich FREMDE Hilfsdateien, also die des gerade migrierten Geräts.
    expect(vault._files.has(bPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

function makeShared(initial: any = null) {
  return { value: initial ? JSON.parse(JSON.stringify(initial)) : null };
}

function makeApp(vault: any, storage: any) {
  return {
    vault: Object.assign(vault, { on: () => ({}), offref: () => {} }),
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
}

// Nur der Persistenz-Pfad, ohne onload — genau die Methoden, die die Migration
// ausmachen. Beide Klassen sind die echten (master bzw. Tag v0.4.0).
function makePlugin(Klasse: any, vault: any, storage: any, shared: { value: any }) {
  const p: any = new Klasse(makeApp(vault, storage), {});
  p.loadData = async () => shared.value;
  p.saveData = async (d: any) => {
    shared.value = JSON.parse(JSON.stringify(d));
  };
  return p;
}

describe('R2: master entkernt die geteilte data.json, auf die der v0.4.0-Peer angewiesen ist', () => {
  it('nach EINEM master-Start hat der v0.4.0-Peer keine Tombstones und keinen Aus-Schalter mehr', async () => {
    const vault = makeVaultMock();
    const storageA = makeLocalStorage();
    const storageB = makeLocalStorage();
    const shared = makeShared(null);

    // Gerät B (v0.4.0) arbeitet ganz normal: Sync ausgeschaltet, eine Notiz
    // gelöscht → Tombstone. Beides landet in der geteilten data.json.
    const b1 = makePlugin(PluginV040, vault, storageB, shared);
    await b1.loadSettings();
    b1.settings.enabled = false;
    b1.settings.tombstones[GUID] = Date.now();
    await b1.saveSettings();

    expect(shared.value.enabled).toBe(false);
    expect(Object.keys(shared.value.tombstones)).toEqual([GUID]);

    // Gerät A bekommt den neuen Build. Es hat bereits einmal migriert, also
    // liegen `enabled`/`tombstones` in seinem Geräteprofil.
    storageA.saveLocalStorage('qollab-device-settings', { enabled: true, tombstones: {} });
    storageA.saveLocalStorage('qollab-client-id', A_ID);
    const a = makePlugin(MasterPlugin, vault, storageA, shared);
    await a.loadSettings();

    // A hat data.json neu geschrieben — ohne die beiden Felder.
    expect(shared.value).not.toHaveProperty('enabled');
    expect(shared.value).not.toHaveProperty('tombstones');

    // Nächster Start von B (immer noch v0.4.0):
    const b2 = makePlugin(PluginV040, vault, storageB, shared);
    await b2.loadSettings();

    expect(b2.settings.tombstones).toEqual({}); // Zombie-Schutz weg
    expect(b2.settings.enabled).toBe(true); // Aus-Schalter von selbst umgelegt
  });

  it('und es wiederholt sich: jeder master-Start entwertet B erneut', async () => {
    const vault = makeVaultMock();
    const storageA = makeLocalStorage();
    const storageB = makeLocalStorage();
    const shared = makeShared(null);
    storageA.saveLocalStorage('qollab-device-settings', { enabled: true, tombstones: {} });
    storageA.saveLocalStorage('qollab-client-id', A_ID);

    const verluste: number[] = [];
    for (let runde = 0; runde < 3; runde++) {
      const b = makePlugin(PluginV040, vault, storageB, shared);
      await b.loadSettings();
      b.settings.tombstones[`${GUID}${runde}`] = Date.now();
      await b.saveSettings();
      const vorher = Object.keys(shared.value.tombstones).length;

      const a = makePlugin(MasterPlugin, vault, storageA, shared);
      await a.loadSettings();

      const nachher = Object.keys(shared.value.tombstones ?? {}).length;
      verluste.push(vorher - nachher);
    }
    expect(verluste).toEqual([1, 1, 1]); // kein Aufschaukeln, aber auch kein Ende
  });
});

describe('R2c: die Migrationsquelle ist in der Mischflotte der LIVE-Wert des anderen Geräts', () => {
  it('ein frisch installiertes master-Gerät kommt AUS hoch, weil der v0.4.0-Peer aus hat', async () => {
    const vault = makeVaultMock();
    const storageB = makeLocalStorage();
    const shared = makeShared(null);

    // Gerät B (v0.4.0): Nutzer schaltet Qollab dort ab. Wert geht in data.json.
    const b = makePlugin(PluginV040, vault, storageB, shared);
    await b.loadSettings();
    b.settings.enabled = false;
    await b.saveSettings();

    // Gerät A: brandneue Installation des neuen Builds, leeres Geräteprofil.
    const a = makePlugin(MasterPlugin, vault, makeLocalStorage(), shared);
    await a.loadSettings();

    // README §Installation: „nach jeder Neuinstallation steht er dort wieder auf
    // an". Gemessen ist das Gegenteil — `raw.enabled` ist hier keine eigene
    // Alt-Einstellung, sondern der aktuelle Schalterstand des ANDEREN Geräts.
    expect(a.settings.enabled).toBe(false);
  });
});

describe('R2b: was der Verlust der Markierungen auf dem Alt-Gerät kostet', () => {
  // Der dokumentierte Zweck der Tombstones: eine gelöschte und GLEICHNAMIG neu
  // angelegte Notiz darf nicht durch eine verspätet ankommende alte Hilfsdatei
  // wiederbelebt werden. Beide Läufe sind identisch bis auf die Markierung.
  async function laufMitTombstones(tombstones: Record<string, number>) {
    const vault = makeVaultMock();
    // Reste der GELÖSCHTEN Inkarnation, vom Sync verspätet nachgeliefert.
    vault._files.set(C_PATH, mitHeader(GUID, 'Text der geloeschten Notiz\n'));
    // Gleichnamige NEUE Notiz, frisch angelegt.
    vault._textFiles.set(NOTE, 'Voellig neuer Inhalt\n');

    const store = {
      has: (guid: string) => guid in tombstones,
      add: async (guid: string) => {
        tombstones[guid] = Date.now();
      },
    };
    const handler = new SyncHandlerV040(vault as any, new CrdtManagerV040(), B_ID, store);
    return {
      text: (await handler.loadAndMerge(NOTE)) ?? '',
      resteDa: vault._files.has(C_PATH),
    };
  }

  it('mit Markierung: die alte Hilfsdatei wird abgeräumt, kein Zombie', async () => {
    const r = await laufMitTombstones({ [GUID]: Date.now() });
    expect(r.text).not.toContain('Text der geloeschten Notiz');
    expect(r.resteDa).toBe(false);
  });

  it('ohne Markierung (= nach einem master-Start): der Text kommt zurück', async () => {
    const r = await laufMitTombstones({});
    expect(r.text).toContain('Text der geloeschten Notiz');
  });
});

describe('R3: Downgrade auf demselben Gerät', () => {
  it('v0.4.0 über master installiert: Aus-Schalter an, Tombstones weg', async () => {
    const vault = makeVaultMock();
    const storage = makeLocalStorage();
    const shared = makeShared(null);

    // master-Zustand nach Migration: alles im Geräteprofil, data.json entkernt.
    storage.saveLocalStorage('qollab-client-id', A_ID);
    const a = makePlugin(MasterPlugin, vault, storage, shared);
    await a.loadSettings();
    a.settings.enabled = false;
    a.settings.tombstones[tombstoneKey(NOTE, GUID)] = Date.now();
    await a.saveSettings();

    // Nutzer spielt das Release zurück (gleiches Gerät → gleiches Profil).
    const b = makePlugin(PluginV040, vault, storage, shared);
    await b.loadSettings();

    expect(b.settings.enabled).toBe(true);
    expect(b.settings.tombstones).toEqual({});
    // Die Geräte-ID überlebt (gleicher localStorage-Schlüssel).
    expect(storage.loadLocalStorage('qollab-client-id')).toBe(A_ID);
  });

  it('Rück-Upgrade: master holt seine eigenen Werte zurück, die v0.4.0-Ära ist verloren', async () => {
    const vault = makeVaultMock();
    const storage = makeLocalStorage();
    const shared = makeShared(null);
    storage.saveLocalStorage('qollab-client-id', A_ID);

    const a1 = makePlugin(MasterPlugin, vault, storage, shared);
    await a1.loadSettings();
    a1.settings.enabled = false;
    a1.settings.tombstones[tombstoneKey(NOTE, GUID)] = Date.now();
    await a1.saveSettings();

    const b = makePlugin(PluginV040, vault, storage, shared);
    await b.loadSettings();
    b.settings.tombstones['ff'.repeat(16)] = Date.now(); // in der Alt-Ära gelöscht
    await b.saveSettings();

    const a2 = makePlugin(MasterPlugin, vault, storage, shared);
    await a2.loadSettings();

    expect(a2.settings.enabled).toBe(false); // Geräteprofil schlägt data.json
    expect(Object.keys(a2.settings.tombstones)).toEqual([tombstoneKey(NOTE, GUID)]);
    // Der in der Alt-Ära gesetzte Tombstone ist im Alt-Format → verworfen.
    expect(a2.settings.tombstones['ff'.repeat(16)]).toBeUndefined();
  });
});

describe('R4: halb gelaufene Migration', () => {
  it('wirft `saveLocalStorage`, wird data.json TROTZDEM entkernt → beides dauerhaft weg', async () => {
    const vault = makeVaultMock();
    const shared = makeShared({
      enabled: false,
      statusNotice: true,
      tombstones: { [tombstoneKey(NOTE, GUID)]: Date.now() },
      clientId: A_ID,
    });
    // Geräteprofil voll (Quota) — die Web-Storage-API wirft.
    const kaputt = {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {
        throw new DOMException('QuotaExceededError');
      },
    };

    const fehler = jest.spyOn(console, 'error').mockImplementation(() => {});
    const p = makePlugin(MasterPlugin, vault, kaputt, shared);
    await p.loadSettings();
    fehler.mockRestore();

    // Die Migrationsquelle ist entfernt …
    expect(shared.value).not.toHaveProperty('enabled');
    expect(shared.value).not.toHaveProperty('tombstones');
    // … und im Ziel steht nichts. Beide Kopien weg, in einem Zug.
    const neu = makePlugin(MasterPlugin, vault, makeLocalStorage(), shared);
    await neu.loadSettings();
    expect(neu.settings.enabled).toBe(true);
    expect(neu.settings.tombstones).toEqual({});
  });

  it('`loadSettings` entfernt die clientId aus data.json BEVOR sie im Profil steht', async () => {
    const vault = makeVaultMock();
    const shared = makeShared({
      enabled: true,
      statusNotice: true,
      tombstones: {},
      clientId: A_ID,
    });
    const storage = makeLocalStorage();
    const p = makePlugin(MasterPlugin, vault, storage, shared);

    await p.loadSettings(); // Schritt 1 von 2 in onload

    // data.json trägt die ID nicht mehr …
    expect(shared.value).not.toHaveProperty('clientId');
    // … und das Profil noch nicht. Ein Absturz/Wurf hier verliert sie endgültig.
    expect(storage.loadLocalStorage('qollab-client-id')).toBeNull();
  });
});

describe('R5: Formatgrenze — was der Alt-Build mit den neuen Bytes macht', () => {
  it('ein Build ohne Header-Kenntnis kann eine heutige Sidecar nicht anwenden', () => {
    const bytes = new Uint8Array(heutigeSidecar(GUID, 'Text\n'));
    // So sah `loadAndMerge` vor `e2dd21c` aus: ganzer Dateiinhalt = Yjs-Update.
    expect(() => Y.applyUpdate(new Y.Doc(), bytes)).toThrow();
  });
});

// Der Preis des QLB2-Wechsels, gemessen statt behauptet. Der Besitzer hat ihn in
// Kauf genommen; dieser Test hält fest, WAS genau in Kauf genommen wurde, damit
// es nicht später als Überraschung wiederkommt.
//
// Die Richtung ist nicht reparabel: sie liegt im ausgelieferten v0.4.0-Code
// (`_v040/sync-handler.ts`, R1-Regel), nicht im aktuellen Build. v0.4.0 kennt nur
// `QLB1`; alles andere liest es als headerlose v0.1-Leiche und löscht es ohne
// Meldung, sobald irgendein Sibling eine GUID trägt — auch die eigene Datei zählt
// dabei mit. Die Gegenrichtung ist dagegen abgesichert: der aktuelle Build liest
// QLB1 weiter (siehe R1/R2b oben, die genau darauf laufen).
describe('R6: der bewusste Formatbruch — v0.4.0 räumt die QLB2-Datei ab', () => {
  const B_PATH = `.qollab/${NOTE}.${B_ID}.yjs`;

  it('erster Lauf: v0.4.0 meldet die Datei als korrupt und prägt eine eigene Inkarnation', async () => {
    const vault = makeVaultMock();
    vault._files.set(A_PATH, heutigeSidecar(GUID, 'Nur auf A getippt\n'));
    vault._textFiles.set(NOTE, 'Nur auf A getippt\n');

    const gemeldet: string[] = [];
    const b = new SyncHandlerV040(vault as any, new CrdtManagerV040(), B_ID, undefined, (p) =>
      gemeldet.push(p)
    );
    await b.loadAndMerge(NOTE);

    // Noch da: ohne GUID-tragenden Sibling greift die R1-Regel nicht.
    expect(vault._files.has(A_PATH)).toBe(true);
    // Und v0.4.0 meldet sie immerhin — es liest sie als headerlose v0.1-Datei,
    // reicht den GANZEN Dateiinhalt an `Y.applyUpdate`, und das wirft.
    expect(gemeldet).toContain(A_PATH);
    // Der Stand von A ist für v0.4.0 trotzdem unsichtbar: es hat eine EIGENE
    // Inkarnation geprägt, statt die von A zu adoptieren. Split-Brain ab hier.
    expect(vault._files.has(B_PATH)).toBe(true);
  });

  it('zweiter Lauf: die eigene GUID reicht, und die QLB2-Datei wird still gelöscht', async () => {
    const vault = makeVaultMock();
    vault._files.set(A_PATH, heutigeSidecar(GUID, 'Nur auf A getippt\n'));
    vault._textFiles.set(NOTE, 'Nur auf A getippt\n');

    await new SyncHandlerV040(vault as any, new CrdtManagerV040(), B_ID).loadAndMerge(NOTE);

    const gemeldet: string[] = [];
    const b2 = new SyncHandlerV040(vault as any, new CrdtManagerV040(), B_ID, undefined, (p) =>
      gemeldet.push(p)
    );
    await b2.loadAndMerge(NOTE);

    // Weg — und zwar ohne ein Wort. Der Datei-Sync trägt die Löschung zu A zurück.
    expect(vault._files.has(A_PATH)).toBe(false);
    expect(gemeldet).toEqual([]);
  });
});
