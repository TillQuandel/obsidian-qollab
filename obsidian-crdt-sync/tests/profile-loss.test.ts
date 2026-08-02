// Szenariosuche Runde 2, Funde 38/39 — Profilverlust und Aus-Schalter
//
// Zwei gemeldete Funde, die dieselbe Wurzel haben: `enabled` und die
// Lösch-Markierungen liegen seit Task 17/F-3 AUSSCHLIESSLICH im Geräteprofil
// (`saveLocalStorage`), weil `data.json` im Sync-Scope liegt. Geht das Profil
// verloren, geht beides mit.
//
//   (a) Der Schalter kommt auf den Default `true` zurück — wer Qollab für einen
//       großen Vault bewusst ausgeschaltet hatte (das README empfiehlt genau
//       das), hat nach einer Neuinstallation ein laufendes Plugin.
//   (b) Der Zombie-Schutz aus Task 15 hängt an denselben Markierungen: bei
//       `enabled: false` entsteht keine, nach Profilverlust überlebt keine.
//
// Diese Datei tut zweierlei. Sie PINNT den Schaden (er ist real und in beiden
// Richtungen reproduziert), und sie führt den Beweis, dass er in dieser
// Architektur nicht behebbar ist:
//
//   - Zu (a): Profilverlust und Erststart eines Zweitgeräts sind am lokalen
//     Zustand nicht unterscheidbar (dritter Test). Jede Regel, die nach einem
//     Profilverlust „aus" wählt, wählt zwangsläufig auch auf jedem neu
//     hinzugefügten Gerät „aus" — ein still nicht syncendes Plugin ist der
//     teurere Irrtum. Die Gegenrichtung (`enabled` zurück in `data.json`) ist
//     der Bug, den Task 17/F-3 beseitigt hat und den
//     `device-settings-scope.test.ts` pinnt.
//   - Zu (b): Ein Tombstone bei ausgeschaltetem Plugin widerspricht Task 17/F-4
//     (`enabled-off-switch.test.ts:54`) — ein sync-vermittelter Rename kommt als
//     delete+create an und beerdigte damit eine lebende Inkarnation. Ein
//     Tombstone, der einen Profilverlust überlebt, müsste in `data.json` liegen,
//     also genau dort, wo er auf dem anderen Gerät eine lebende Inkarnation
//     traf (Task 17/F-3).
//
// Konsequenz: kein Code-Fix. Der Fix liegt im README — die Zusagen dort sagten
// etwas anderes (siehe `docs-consistency.test.ts`).
//
// Gemessen statt behauptet — was die beiden naheliegenden „Fixes" für (a) kosten
// (volle Suite, 56 Suiten / 356 Tests):
//   - `DEFAULT_SETTINGS.enabled = false`: 45 Tests in 18 Suiten fallen. Der
//     Default gilt für Erststart und Profilverlust gemeinsam; es gibt nur einen.
//   - Die Heuristik „data.json ist da, Geräteprofil leer → aus": 5 Tests in 3
//     Suiten fallen, darunter „enabled:false auf Gerät A schaltet Gerät B nicht
//     ab" (device-settings-scope) und „localStorage-Verlust bleibt gutartig"
//     (clientid-device-local). Sie schaltet also genau die Geräte ab, die ganz
//     regulär neu dazukommen.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { DEFAULT_SETTINGS } from '../src/settings';
import { makeVaultMock, makeLocalStorage, VaultMock, LocalStorageMock } from './helpers/vault-mock';

const NOTE = 'note.md';
const PEER_ID = 'deadbeef';
const PEER_PATH = `.qollab/${NOTE}.${PEER_ID}.yjs`;
const ALT = 'Alter Text der gelöschten Notiz\n';
const NEU = 'Frische, gleichnamige Notiz\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

function buildSidecar(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  const state = mgr.encodeState(NOTE);
  const buf = encodeStateFile(guid, state);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Ein Gerät = ein eigener localStorage-Speicher über einem GETEILTEN Vault
// (Dateien + data.json) — derselbe Aufbau wie in device-settings-scope.test.ts.
// Ein Profilverlust ist in diesem Modell exakt: derselbe Vault, derselbe
// `shared`-Speicher, ein FRISCHER LocalStorageMock.
async function bootDevice(
  vault: VaultMock,
  shared: { value: any },
  storage: LocalStorageMock = makeLocalStorage()
) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const app = {
    vault: Object.assign(vault, {
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    }),
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin: any = new (CrdtSyncPlugin as any)(app, {});
  plugin.loadData = async () => shared.value;
  plugin.saveData = async (d: any) => {
    shared.value = JSON.parse(JSON.stringify(d));
  };
  await plugin.onload();
  return { plugin, handlers, storage };
}

// Alles, was ein frisch startendes Plugin über den Zustand dieses Vaults
// erfahren kann: die geteilte `data.json`, die drei Schlüssel des Geräteprofils
// und die vorhandenen Dateien. Die zufällige Geräte-ID im Sidecar-Namen wird
// normalisiert — sie trägt keine Information über den Schalterstand.
function bootSurface(vault: VaultMock, shared: { value: any }, storage: LocalStorageMock) {
  return {
    dataJson: shared.value,
    device: storage.loadLocalStorage('qollab-device-settings'),
    clientId: storage.loadLocalStorage('qollab-client-id'),
    sweepCursor: storage.loadLocalStorage('qollab-sweep-cursor'),
    dateien: [...vault._files.keys(), ...vault._textFiles.keys()]
      .map((p) => p.replace(/\.[0-9a-f]{8}\.yjs$/, '.<id>.yjs'))
      .sort(),
  };
}

describe('(a) Fund 39: Der Aus-Schalter überlebt keinen Profilverlust', () => {
  it('nach Profilverlust steht der Schalter wieder auf „an"', async () => {
    const vault = makeVaultMock();
    const shared = { value: null as any };

    const A = await bootDevice(vault, shared);
    A.plugin.settings.enabled = false;
    await A.plugin.saveSettings();
    expect(A.storage.loadLocalStorage('qollab-device-settings')).toMatchObject({
      enabled: false,
    });

    // Profilverlust: der Geräte-Speicher ist weg, der Vault (inkl. data.json)
    // unverändert. Das ist der Schaden — hier gepinnt, nicht behoben.
    const B = await bootDevice(vault, shared, makeLocalStorage());
    expect(B.plugin.settings.enabled).toBe(true);
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
  });

  it('der Schalterstand steht nicht mehr in data.json (dort läge er im Sync-Scope)', async () => {
    const vault = makeVaultMock();
    const shared = { value: null as any };
    const A = await bootDevice(vault, shared);
    A.plugin.settings.enabled = false;
    await A.plugin.saveSettings();

    // Der einzige Ort, an dem der Schalter einen Profilverlust überleben könnte,
    // ist die mitgesyncte data.json — und genau dort schaltete `enabled: false`
    // das ANDERE Gerät still mit ab (Task 17/F-3).
    expect(shared.value).not.toHaveProperty('enabled');
    expect(shared.value).toEqual({ statusNotice: true });
  });

  it('Profilverlust ist am lokalen Zustand nicht von einem Erststart zu unterscheiden', async () => {
    // Vault 1: hier hat jemand Qollab bewusst AUSGESCHALTET.
    const v1 = makeVaultMock();
    const s1 = { value: null as any };
    const aus = await bootDevice(v1, s1);
    v1._textFiles.set(NOTE, ALT);
    await aus.plugin.syncHandler.applyLocalContent(NOTE, ALT);
    aus.plugin.settings.enabled = false;
    await aus.plugin.saveSettings();

    // Vault 2: hier hat NIEMAND je etwas ausgeschaltet. Das Gerät hat nur
    // gearbeitet und einmal eine Notiz gelöscht — auch das schreibt data.json
    // (der Tombstone-Write ruft `saveSettings`).
    const v2 = makeVaultMock();
    const s2 = { value: null as any };
    const an = await bootDevice(v2, s2);
    v2._textFiles.set(NOTE, ALT);
    await an.plugin.syncHandler.applyLocalContent(NOTE, ALT);
    v2._textFiles.set('weg.md', 'x\n');
    await an.plugin.syncHandler.applyLocalContent('weg.md', 'x\n');
    v2._textFiles.delete('weg.md');
    await an.handlers.get('delete')!(tfile('weg.md'));
    expect(Object.keys(an.plugin.settings.tombstones).length).toBeGreaterThan(0);
    expect(an.plugin.settings.enabled).toBe(true);

    // Was ein Plugin mit leerem Geräteprofil auf den beiden Vaults vorfindet, ist
    // Zeichen für Zeichen dasselbe: `data.json` trägt seit Task 17/F-3 nur noch
    // die Anzeigepräferenz, die Hilfsdateien sehen gleich aus, das Profil ist in
    // beiden Fällen leer. In Vault 1 wäre „aus" die richtige Antwort, in Vault 2
    // „an" — aus derselben Eingabe. Es gibt also keine Regel, die beides trifft.
    const frisch = makeLocalStorage();
    expect(bootSurface(v1, s1, frisch)).toEqual(bootSurface(v2, s2, frisch));

    // Und die Folge, wenn man es trotzdem versucht: eine Regel, die aus dieser
    // Eingabe „aus" macht, schaltet Vault 2 stumm ab. Das ist genau der Fall, den
    // `device-settings-scope.test.ts` („enabled:false auf Gerät A schaltet Gerät B
    // nicht ab") als Korrektheitsbedingung pinnt.
    const zweitgeraet = await bootDevice(v2, s2, makeLocalStorage());
    expect(zweitgeraet.plugin.settings.enabled).toBe(true);
  });
});

describe('(b) Fund 38: Zombie-Schutz greift bei enabled:false nicht', () => {
  it('ohne Tombstone kehrt der Text der gelöschten Notiz in die gleichnamige neue zurück', async () => {
    const vault = makeVaultMock();
    const shared = { value: null as any };
    const { plugin, handlers } = await bootDevice(vault, shared);

    vault._textFiles.set(NOTE, ALT);
    await plugin.syncHandler.applyLocalContent(NOTE, ALT);
    const guid: string = plugin.syncHandler.currentGuid(NOTE);
    expect(guid).toBeTruthy();
    // Der Partner trägt dieselbe Inkarnation.
    vault._files.set(PEER_PATH, buildSidecar(guid, ALT));

    // Aus-Schalter, dann löschen. Task 17/F-4: „aus" heißt keine neuen
    // Markierungen — bewusst so, siehe enabled-off-switch.test.ts.
    plugin.settings.enabled = false;
    vault._textFiles.delete(NOTE);
    await handlers.get('delete')!(tfile(NOTE));
    expect(Object.keys(plugin.settings.tombstones)).toEqual([]);

    // Die Hilfsdatei des ausgeschalteten Partners synct als Waise zurück.
    vault._files.set(PEER_PATH, buildSidecar(guid, ALT));

    // Wieder an, gleichnamige neue Notiz.
    plugin.settings.enabled = true;
    vault._textFiles.set(NOTE, NEU);
    await plugin.onRemoteYjsUpdate(NOTE);

    // Der Schaden: der alte Text steht wieder in der neuen Notiz. Mit Tombstone
    // wäre die Fremd-Hilfsdatei als Leiche erkannt und aussortiert worden.
    expect(vault._textFiles.get(NOTE)).toContain(ALT.trim());
    expect(vault._textFiles.get(NOTE)).not.toBe(NEU);
  });
});

describe('(b) Fund 38: Zombie-Schutz überlebt keinen Profilverlust', () => {
  it('der Tombstone der gelöschten Inkarnation ist nach dem Profilverlust weg — und der Text kehrt zurück', async () => {
    const vault = makeVaultMock();
    const shared = { value: null as any };
    const A = await bootDevice(vault, shared);

    vault._textFiles.set(NOTE, ALT);
    await A.plugin.syncHandler.applyLocalContent(NOTE, ALT);
    const guid: string = A.plugin.syncHandler.currentGuid(NOTE);
    vault._files.set(PEER_PATH, buildSidecar(guid, ALT));

    // Regulär gelöscht, Plugin an: der Tombstone entsteht wie vorgesehen.
    vault._textFiles.delete(NOTE);
    await A.handlers.get('delete')!(tfile(NOTE));
    expect(Object.keys(A.plugin.settings.tombstones).length).toBeGreaterThan(0);
    // Er liegt NUR im Geräteprofil — nicht in der mitgesyncten data.json.
    expect(shared.value ?? {}).not.toHaveProperty('tombstones');

    // Profilverlust.
    const B = await bootDevice(vault, shared, makeLocalStorage());
    expect(Object.keys(B.plugin.settings.tombstones)).toEqual([]);

    // Stale Fremd-Hilfsdatei trifft auf eine gleichnamige neue Notiz.
    vault._files.set(PEER_PATH, buildSidecar(guid, ALT));
    vault._textFiles.set(NOTE, NEU);
    await B.plugin.onRemoteYjsUpdate(NOTE);

    expect(vault._textFiles.get(NOTE)).toContain(ALT.trim());
    expect(vault._textFiles.get(NOTE)).not.toBe(NEU);
  });
});
