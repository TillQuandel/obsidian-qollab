// Task 12, Fix-Runde — Folgen des IO-Abbruchs (Review F-2).
//
// Der Abbruch aus Fix B hat entgegen der Brief-Annahme KEINEN wirksamen
// Folge-Trigger:
//   F-2a  SidecarWatcher.poll setzt lastSeen VOR onChanged → ein abgebrochener
//         loadAndMerge verbraucht den Trigger dauerhaft (heilt erst bei nächstem
//         mtime/size-Wechsel oder Neustart).
//   F-2b  applyLocalContent-Abbruch → der lokale Edit lebt nur in der .md.
//         loadAndMerge injiziert den .md-Text im own-Branch bewusst NICHT, also
//         liefert der nächste Remote-Merge einen Stand ohne ihn; im Write-Back
//         gilt data === preMerge → blind überschrieben → lokaler Edit WEG.
//         Verlust ist nach der Severity-Ordnung aus Task 11 schwerer als das
//         Duplikat, das dieser Task behebt.

import CrdtSyncPlugin from '../src/main';
import { SidecarWatcher } from '../src/sidecar-watcher';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer } from './helpers/vault-mock';

const SELF = '10ca1000';
const NOTE = 'note.md';
const OWN_YJS = `.qollab/note.md.${SELF}.yjs`;
const REMOTE_YJS = '.qollab/note.md.5e307e01.yjs';
const GUID = 'aabbccddeeff00112233445566778899';

const BASE = 'Zeile 1\nZeile 2\n';
const REMOTE = 'Zeile 1 REMOTE\nZeile 2\n'; // Remote ändert Zeile 1
const LOCAL = 'Zeile 1\nZeile 2 LOCAL\n'; // User ändert Zeile 2
const MERGED = 'Zeile 1 REMOTE\nZeile 2 LOCAL\n'; // beide Änderungen

describe('F-2a: abgebrochener Merge verbraucht den Poll-Trigger nicht', () => {
  it('scheitert onChanged, triggert derselbe unveränderte Sidecar-Stand erneut', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', new ArrayBuffer(1));

    const calls: string[] = [];
    let failNext = true;
    const onChanged = async (notePath: string) => {
      calls.push(notePath);
      if (failNext) {
        failNext = false;
        throw new Error('Merge abgebrochen (Sidecar nicht lesbar)');
      }
    };

    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);
    // Erster Poll: der Merge bricht ab. (Der Wurf darf den Poll nicht killen —
    // vor dem Fix propagiert er, deshalb hier abgefangen.)
    await w.poll().catch(() => {});
    // Zweiter Poll: die Datei ist unverändert (gleiche mtime/size).
    await w.poll();

    // RED (unfixed): ['note.md'] — der Trigger war nach dem ersten Poll verbraucht.
    expect(calls).toEqual([NOTE, NOTE]);
  });

  it('erfolgreicher Merge verbraucht den Trigger weiterhin (kein Dauerfeuer)', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', new ArrayBuffer(1));

    const onChanged = jest.fn(async () => {});
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);
    await w.poll();
    await w.poll();

    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('F-2b: lokaler Edit überlebt einen IO-Abbruch', () => {
  function makePlugin(vault: ReturnType<typeof makeVaultMock>) {
    const plugin = new (CrdtSyncPlugin as any)({ vault }, {});
    plugin.settings = { enabled: true, statusNotice: false, clientId: SELF, tombstones: {} };
    plugin.crdtManager = new CrdtManager();
    plugin.syncHandler = new SyncHandler(vault as any, plugin.crdtManager, SELF);
    return plugin as any;
  }

  function setup() {
    const vault = makeVaultMock() as any;

    const base = new CrdtManager();
    base.setContent(NOTE, BASE);
    const baseState = base.encodeState(NOTE);
    vault._files.set(OWN_YJS, toArrayBuffer(encodeStateFile(GUID, baseState)));

    // Remote leitet von derselben Basis ab → Zeile 1 dedupliziert korrekt.
    const remote = new CrdtManager();
    remote.applyUpdate(NOTE, baseState);
    remote.setContent(NOTE, REMOTE);
    vault._files.set(REMOTE_YJS, toArrayBuffer(encodeStateFile(GUID, remote.encodeState(NOTE))));

    vault._textFiles.set(NOTE, BASE);

    // Die Fremd-Sidecar ist gerade nicht lesbar (EBUSY/Handle) — transient.
    const rawRead = vault.adapter.readBinary.bind(vault.adapter);
    const io = { failing: true };
    vault.adapter.readBinary = async (p: string) => {
      if (io.failing && p === REMOTE_YJS) throw new Error('EBUSY: resource busy or locked');
      return rawRead(p);
    };

    return { vault, plugin: makePlugin(vault), io };
  }

  it('Abbruch + späterer Remote-Merge: lokaler Edit UND Remote-Edit überleben', async () => {
    const { vault, plugin, io } = setup();

    // User tippt Zeile 2 → modify-Event → applyLocalContent bricht ab (IO-Fehler),
    // der Edit lebt danach nur in der .md.
    vault._textFiles.set(NOTE, LOCAL);
    await plugin.syncHandler.applyLocalContent(NOTE, LOCAL);
    expect(plugin.crdtManager.getContent(NOTE)).toBe(BASE); // nicht erfasst

    // IO erholt sich, der Watcher meldet die Fremd-Sidecar.
    io.failing = false;
    await plugin.onRemoteYjsUpdate(NOTE);

    // RED (unfixed): 'Zeile 1 REMOTE\nZeile 2\n' — der lokale Edit ist weg.
    expect(vault._textFiles.get(NOTE)).toBe(MERGED);
    expect(plugin.crdtManager.getContent(NOTE)).toBe(MERGED);
  });

  it('bleibt der IO-Fehler bestehen, wird die .md NICHT überschrieben', async () => {
    const { vault, plugin } = setup();

    vault._textFiles.set(NOTE, LOCAL);
    await plugin.syncHandler.applyLocalContent(NOTE, LOCAL);

    // io.failing bleibt true → loadAndMerge bricht ab, kein Write-Back.
    await plugin.onRemoteYjsUpdate(NOTE);

    expect(vault._textFiles.get(NOTE)).toBe(LOCAL);
  });

  // Der Watcher braucht den Abbruch als Rückgabewert — ein abgebrochener Merge
  // wirft nicht, er kehrt still zurück (F-2a im Realbetrieb, nicht nur bei Wurf).
  it('meldet dem Watcher „Trigger nicht verbraucht", solange der IO-Fehler steht', async () => {
    const { vault, plugin, io } = setup();

    vault._textFiles.set(NOTE, LOCAL);
    await plugin.syncHandler.applyLocalContent(NOTE, LOCAL);

    expect(await plugin.onRemoteYjsUpdate(NOTE)).toBe(false); // RED (unfixed): undefined
    io.failing = false;
    expect(await plugin.onRemoteYjsUpdate(NOTE)).toBe(true);
  });
});

describe('Concern 2: dauerhaft unlesbare Sidecar meldet sich', () => {
  it('SidecarReadError meldet den Pfad; ein Parse-Fehler (korrupt) tut es nicht', async () => {
    const vault = makeVaultMock() as any;
    const base = new CrdtManager();
    base.setContent(NOTE, BASE);
    vault._files.set(OWN_YJS, toArrayBuffer(encodeStateFile(GUID, base.encodeState(NOTE))));
    vault._files.set(REMOTE_YJS, new ArrayBuffer(1));
    vault._textFiles.set(NOTE, BASE);

    const rawRead = vault.adapter.readBinary.bind(vault.adapter);
    vault.adapter.readBinary = async (p: string) => {
      if (p === REMOTE_YJS) throw new Error('EACCES: permission denied');
      return rawRead(p);
    };

    const unreadable: string[] = [];
    const corrupt: string[] = [];
    // `as any`: der 6. Parameter (onUnreadableFile) existiert vor dem Fix nicht —
    // ohne Cast scheitert schon die Kompilierung und der RED-Lauf wäre unlesbar.
    const handler = new (SyncHandler as any)(
      vault,
      new CrdtManager(),
      SELF,
      undefined,
      (p: string) => corrupt.push(p),
      (p: string) => unreadable.push(p)
    ) as SyncHandler;

    await handler.applyLocalContent(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);

    // Jeder Abbruch meldet den Pfad — main.ts zählt und meldet einmalig.
    expect(unreadable).toEqual([REMOTE_YJS, REMOTE_YJS]);
    // Unlesbar ist NICHT korrupt.
    expect(corrupt).toEqual([]);
  });
});
