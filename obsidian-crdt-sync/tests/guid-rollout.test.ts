import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  tippeMd,
  VaultMock,
  toArrayBuffer as toAB,
} from './helpers/vault-mock';

// Task 13/B + /C auf Plugin-Ebene: der Startup-Sweep darf für eine unveränderte
// Note ohne eigene Sidecar KEINE frische GUID prägen (sonst prägen beim
// Zwei-Geräte-Rollout beide Seiten eigene Inkarnationen → Split-Brain, und der
// Tie-Break-Verlierer verwirft anschließend seine Historie), und eine
// Fremd-Sidecar ohne zugehörige .md darf auf keinem Pfad eigenen State anlegen.
//
// Getestet über den echten onload-Pfad (Mock-App registriert die Handler) mit
// den realen Pfaden: snapshotStaleMarkdownFiles, SidecarWatcher.poll/scanNote,
// modify-Handler.

const NOTE = 'note.md';
const BASE = 'Termin: Montag\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

async function bootPlugin(vault: VaultMock, clientId: string) {
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
    onLayoutReady: () => {}, // Sweep hier bewusst nicht automatisch starten
  };
  // Task 14: eigener (gerätelokaler) Speicher pro Boot. Die clientId kommt hier
  // weiterhin aus der data.json — onload migriert sie einmalig in diesen Speicher,
  // die Sidecar-Pfade der Tests bleiben damit unverändert.
  const storage = makeLocalStorage();
  const plugin = new (CrdtSyncPlugin as any)(
    {
      vault: vaultWithEvents,
      workspace,
      loadLocalStorage: storage.loadLocalStorage,
      saveLocalStorage: storage.saveLocalStorage,
    },
    {}
  );
  plugin._data = { enabled: true, statusNotice: false, clientId, tombstones: {} };
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

const ownPath = (clientId: string) => `.qollab/${NOTE}.${clientId}.yjs`;

function guidOf(vault: VaultMock, path: string): string | null {
  const buf = vault._files.get(path);
  if (!buf) return null;
  return decodeStateFile(new Uint8Array(buf)).guid;
}

// Fremd-Sidecar (anderes Gerät) direkt in den Vault legen.
function putForeign(vault: VaultMock, clientId: string, guid: string, text: string): void {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  vault._files.set(`.qollab/${NOTE}.${clientId}.yjs`, toAB(encodeStateFile(guid, m.encodeState(NOTE))));
}

describe('Task 13/B: Sweep prägt keine GUID ohne echten Edit', () => {
  // Test 4 (Brief), erster Teil.
  it('unveränderte Note ohne Sidecar: nach dem Sweep existiert KEINE eigene Sidecar', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);

    const { plugin } = await bootPlugin(vault, 'aaaa1111');
    await plugin.snapshotStaleMarkdownFiles();

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(false);
    expect([...vault._files.keys()]).toEqual([]);
  });

  // Test 4 (Brief), zweiter Teil.
  it('echter lokaler Edit prägt weiterhin', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);

    const { plugin, handlers } = await bootPlugin(vault, 'aaaa1111');
    await plugin.snapshotStaleMarkdownFiles();

    await tippeMd(vault, NOTE, BASE + 'Lokaler Edit\n');
    await handlers.get('modify')!(tfile(NOTE));

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(true);
    expect(guidOf(vault, ownPath('aaaa1111'))).not.toBeNull();
  });

  it('Offline-Edit bei vorhandener eigener Sidecar wird vom Sweep weiterhin erfasst', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);

    const { plugin, handlers } = await bootPlugin(vault, 'aaaa1111');
    // Eigene Sidecar entsteht durch einen echten Edit.
    await tippeMd(vault, NOTE, BASE + 'Erster Edit\n');
    await handlers.get('modify')!(tfile(NOTE));
    const guidBefore = guidOf(vault, ownPath('aaaa1111'));

    // Offline-Edit: .md ist neuer als die Sidecar (App war zu).
    vault._textFiles.set(NOTE, BASE + 'Erster Edit\nOffline Edit\n');
    vault._mdMtimes.set(NOTE, 9_999);
    await plugin.snapshotStaleMarkdownFiles();

    const saved = decodeStateFile(new Uint8Array(vault._files.get(ownPath('aaaa1111'))!));
    const check = new CrdtManager();
    check.applyUpdate(NOTE, saved.update);
    expect(check.getContent(NOTE)).toContain('Offline Edit');
    expect(saved.guid).toBe(guidBefore); // gleiche Inkarnation
  });

  // Review I-3: Der Sweep muss auf DERSELBEN Basis entscheiden wie ensureDoc —
  // eine dekodierbare GUID, nicht die bloße Anwesenheit einer Datei. Eine halb
  // kopierte/korrupte Fremd-Sidecar (Sync-Dienst schreibt gerade) trägt keine
  // GUID; ensureDoc prägte dann doch eine frische Inkarnation → Split-Brain
  // durch die Hintertür.
  it('korrupte Fremd-Sidecar zählt nicht als adoptierbar: keine Prägung', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    // 12 Bytes: zu kurz für den QLB1-Header → keine GUID lesbar.
    vault._files.set(
      `.qollab/${NOTE}.bbbb2222.yjs`,
      new Uint8Array([0x51, 0x4c, 0x42, 0x31, 1, 2, 3, 4, 5, 6, 7, 8]).buffer as ArrayBuffer
    );

    const { plugin } = await bootPlugin(vault, 'aaaa1111');
    await plugin.snapshotStaleMarkdownFiles();

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(false);
  });

  it('ohne eigene Sidecar, aber mit adoptierbarer Fremd-Sidecar: Sweep adoptiert deren GUID', async () => {
    const vault = makeVaultMock();
    const FOREIGN_GUID = '00000000000000000000000000000000';
    vault._textFiles.set(NOTE, BASE);
    putForeign(vault, 'bbbb2222', FOREIGN_GUID, BASE);

    const { plugin } = await bootPlugin(vault, 'aaaa1111');
    await plugin.snapshotStaleMarkdownFiles();

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(true);
    expect(guidOf(vault, ownPath('aaaa1111'))).toBe(FOREIGN_GUID); // keine frische GUID
  });
});

describe('Task 13/C: Phantom-Guard auf Poll- und file-open-Pfad', () => {
  // Test 5 (Brief) auf Plugin-Ebene.
  it('Poll: Fremd-Sidecar ohne .md legt keinen eigenen State an', async () => {
    const vault = makeVaultMock();
    putForeign(vault, 'bbbb2222', '00000000000000000000000000000000', BASE);
    // KEINE .md.

    const { plugin } = await bootPlugin(vault, 'aaaa1111');
    await plugin.sidecarWatcher.poll();

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(false);
    expect(plugin.crdtManager.hasDoc(NOTE)).toBe(false);
  });

  it('file-open-Scan: Fremd-Sidecar ohne .md legt keinen eigenen State an', async () => {
    const vault = makeVaultMock();
    putForeign(vault, 'bbbb2222', '00000000000000000000000000000000', BASE);

    const { plugin } = await bootPlugin(vault, 'aaaa1111');
    await plugin.sidecarWatcher.scanNote(NOTE);

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(false);
    expect(plugin.crdtManager.hasDoc(NOTE)).toBe(false);
  });

  it('Sweep: Fremd-Sidecar ohne .md bleibt unangetastet liegen', async () => {
    const vault = makeVaultMock();
    putForeign(vault, 'bbbb2222', '00000000000000000000000000000000', BASE);

    const { plugin } = await bootPlugin(vault, 'aaaa1111');
    await plugin.snapshotStaleMarkdownFiles();

    expect(vault._files.has(ownPath('aaaa1111'))).toBe(false);
    expect(vault._files.has(`.qollab/${NOTE}.bbbb2222.yjs`)).toBe(true);
  });
});

describe('Task 13: Zwei-Geräte-Rollout (Szenario-2-Semantik)', () => {
  // Test 6 (Brief). Nur .yjs-Dateien werden zwischen den Vaults propagiert —
  // die .md-Konvergenz muss über den CRDT-Merge entstehen.
  it('nur die Editor-Seite prägt, die Gegenseite adoptiert, beidseitige Edits konvergieren', async () => {
    const vA = makeVaultMock();
    const vB = makeVaultMock();
    vA._textFiles.set(NOTE, BASE);
    vB._textFiles.set(NOTE, BASE);

    const A = await bootPlugin(vA, 'aaaa1111');
    const B = await bootPlugin(vB, 'bbbb2222');

    // Beide Geräte starten (Sweep) — niemand hat editiert.
    await A.plugin.snapshotStaleMarkdownFiles();
    await B.plugin.snapshotStaleMarkdownFiles();
    expect([...vA._files.keys()]).toEqual([]);
    expect([...vB._files.keys()]).toEqual([]);

    // A editiert → nur A prägt eine GUID.
    await tippeMd(vA, NOTE, BASE + 'A-Edit\n');
    await A.handlers.get('modify')!(tfile(NOTE));
    const guidA = guidOf(vA, ownPath('aaaa1111'));
    expect(guidA).not.toBeNull();
    expect([...vB._files.keys()]).toEqual([]);

    // Datei-Sync: nur As Sidecar wandert zu B.
    vB._files.set(ownPath('aaaa1111'), vA._files.get(ownPath('aaaa1111'))!);
    await B.plugin.sidecarWatcher.poll();

    // B adoptiert As Inkarnation (kein Tie-Break) und übernimmt den Text.
    expect(guidOf(vB, ownPath('bbbb2222'))).toBe(guidA);
    expect(vB._textFiles.get(NOTE)).toContain('A-Edit');

    // B editiert auf dem gemergten Stand.
    await tippeMd(vB, NOTE, vB._textFiles.get(NOTE)! + 'B-Edit\n');
    await B.handlers.get('modify')!(tfile(NOTE));

    // Rück-Sync (nur Sidecars) und beidseitiger Merge.
    vA._files.set(ownPath('bbbb2222'), vB._files.get(ownPath('bbbb2222'))!);
    await A.plugin.sidecarWatcher.poll();
    vB._files.set(ownPath('aaaa1111'), vA._files.get(ownPath('aaaa1111'))!);
    await B.plugin.sidecarWatcher.poll();

    expect(vA._textFiles.get(NOTE)).toContain('A-Edit');
    expect(vA._textFiles.get(NOTE)).toContain('B-Edit');
    expect(vA._textFiles.get(NOTE)).toBe(vB._textFiles.get(NOTE));
    // Beide Geräte auf derselben Inkarnation.
    expect(guidOf(vA, ownPath('aaaa1111'))).toBe(guidA);
    expect(guidOf(vB, ownPath('bbbb2222'))).toBe(guidA);
  });

  // Review C-1/I-1: derselbe Rollout mit einer Note OHNE abschließendes
  // Zeilenende — im Realtest der tatsächliche Dateizustand.
  it('Rollout ohne abschließendes Zeilenende: keine verklebten Zeilen auf beiden Geräten', async () => {
    const NO_NL = 'Termin: Montag';
    const vA = makeVaultMock();
    const vB = makeVaultMock();
    vA._textFiles.set(NOTE, NO_NL);
    vB._textFiles.set(NOTE, NO_NL);

    const A = await bootPlugin(vA, 'aaaa1111');
    const B = await bootPlugin(vB, 'bbbb2222');
    await A.plugin.snapshotStaleMarkdownFiles();
    await B.plugin.snapshotStaleMarkdownFiles();

    await tippeMd(vA, NOTE, NO_NL + '\nA-Edit');
    await A.handlers.get('modify')!(tfile(NOTE));

    vB._files.set(ownPath('aaaa1111'), vA._files.get(ownPath('aaaa1111'))!);
    await B.plugin.sidecarWatcher.poll();

    // RED: "Termin: Montag\nA-EditTermin: Montag" (auf beiden Geräten).
    expect(vB._textFiles.get(NOTE)!.split('\n')).toEqual(['Termin: Montag', 'A-Edit']);

    // Rück-Sync: der Müll würde sonst als Insert-Op auch beim Gewinner landen.
    vA._files.set(ownPath('bbbb2222'), vB._files.get(ownPath('bbbb2222'))!);
    await A.plugin.sidecarWatcher.poll();
    expect(vA._textFiles.get(NOTE)!.split('\n')).toEqual(['Termin: Montag', 'A-Edit']);
  });
});
