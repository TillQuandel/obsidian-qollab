# GitHub Collaboration (Per-User State Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qollab works correctly when two users share a vault via GitHub — even if both push simultaneously, both sides' changes are preserved.

**Architecture:** Each client writes its own `note.md.<clientId>.yjs` file (8 hex chars, stable per install). Git never sees a conflict because each user only writes their own file. `loadAndMerge` reads ALL sibling `*.yjs` files and merges them into a single CRDT state. This mirrors the G-Counter pattern: no two replicas write the same slot.

**Tech Stack:** TypeScript, Yjs, Obsidian Plugin API, Jest (ts-jest)

---

## File Map

| File | Change |
|---|---|
| `src/settings.ts` | Add `clientId: string` field + UUID generator |
| `src/sync-handler.ts` | `clientId` in constructor, `stateFilePath` uses clientId, `loadAndMerge` reads all siblings, `VaultLike` gets `listYjsFiles` |
| `src/file-watcher.ts` | notePath extraction: strip `.<8hex>.yjs` instead of `.yjs` |
| `src/main.ts` | Pass clientId to SyncHandler, update rename/delete handlers for multi-file |
| `tests/sync-handler.test.ts` | Update mock + tests for new naming, add multi-file merge test |
| `.gitattributes` | New: `*.yjs binary` |
| `README.md` | Add GitHub workflow section |

---

### Task 1: ClientId in Settings

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings.test.ts`:

```typescript
import { generateClientId } from '../src/settings';

describe('generateClientId', () => {
  it('returns 8 lowercase hex chars', () => {
    const id = generateClientId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns unique values each call', () => {
    const ids = Array.from({ length: 100 }, generateClientId);
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/settings.test.ts
```

Expected: FAIL — `generateClientId` not exported

- [ ] **Step 3: Update settings.ts**

Replace `src/settings.ts` content:

```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import type CrdtSyncPlugin from './main';

export interface CrdtSyncSettings {
  enabled: boolean;
  statusNotice: boolean;
  clientId: string;
}

export function generateClientId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const DEFAULT_SETTINGS: CrdtSyncSettings = {
  enabled: true,
  statusNotice: true,
  clientId: '',
};

export class CrdtSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CrdtSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'CRDT Sync' });

    new Setting(containerEl)
      .setName('Sync aktiviert')
      .setDesc('Automatisches Mergen bei Datei-Sync (OneDrive, Dropbox, iCloud, GitHub, …) ein- oder ausschalten.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            this.plugin.settings.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Merge-Benachrichtigung')
      .setDesc('Kurze Meldung anzeigen wenn ein Merge durchgeführt wurde.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.statusNotice)
          .onChange(async (value) => {
            this.plugin.settings.statusNotice = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Client-ID')
      .setDesc(`Eindeutige ID dieses Geräts: ${this.plugin.settings.clientId}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/settings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/settings.ts tests/settings.test.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: clientId in settings for per-user yjs files"
```

---

### Task 2: VaultLike — listYjsFiles

**Files:**
- Modify: `src/sync-handler.ts` (interface only)
- Modify: `tests/sync-handler.test.ts` (mock)

- [ ] **Step 1: Write failing test for listYjsFiles mock**

Add to `tests/sync-handler.test.ts` (inside `makeVaultMock`, after `_textFiles`):

```typescript
// New method on mock — verify it lists correctly
it('makeVaultMock.listYjsFiles returns matching paths', () => {
  const vault = makeVaultMock() as any;
  vault._files.set('note.md.a1b2c3d4.yjs', new ArrayBuffer(0));
  vault._files.set('note.md.b5c6d7e8.yjs', new ArrayBuffer(0));
  vault._files.set('other.md.a1b2c3d4.yjs', new ArrayBuffer(0));
  expect(vault.listYjsFiles('note.md')).toEqual(
    expect.arrayContaining(['note.md.a1b2c3d4.yjs', 'note.md.b5c6d7e8.yjs'])
  );
  expect(vault.listYjsFiles('note.md')).not.toContain('other.md.a1b2c3d4.yjs');
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/sync-handler.test.ts
```

Expected: FAIL — `listYjsFiles` not a function

- [ ] **Step 3: Add listYjsFiles to VaultLike interface and mock**

In `src/sync-handler.ts`, add to `VaultLike`:

```typescript
interface VaultLike {
  getAbstractFileByPath(path: string): { path: string } | null;
  read(file: { path: string }): Promise<string>;
  readBinary(file: { path: string }): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  modifyBinary(file: { path: string }, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  listYjsFiles(notePath: string): string[];
}
```

In `tests/sync-handler.test.ts`, add `listYjsFiles` to `makeVaultMock`:

```typescript
function makeVaultMock() {
  const files = new Map<string, ArrayBuffer>();
  const textFiles = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) =>
      files.has(path) || textFiles.has(path) ? { path } : null,
    read: async (file: { path: string }) =>
      textFiles.get(file.path) ?? '',
    readBinary: async (file: { path: string }) =>
      files.get(file.path)!,
    createBinary: async (path: string, data: ArrayBuffer | Uint8Array) => {
      files.set(path, data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    },
    modifyBinary: async (file: { path: string }, data: ArrayBuffer | Uint8Array) => {
      files.set(file.path, data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    },
    listYjsFiles: (notePath: string) =>
      Array.from(files.keys()).filter(p => p.startsWith(notePath + '.') && p.endsWith('.yjs')),
    _files: files,
    _textFiles: textFiles,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/sync-handler.test.ts
```

Expected: PASS (including new mock test)

- [ ] **Step 5: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/sync-handler.ts tests/sync-handler.test.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: add listYjsFiles to VaultLike interface"
```

---

### Task 3: SyncHandler — per-user stateFilePath

**Files:**
- Modify: `src/sync-handler.ts`
- Modify: `tests/sync-handler.test.ts`

- [ ] **Step 1: Write failing test**

Replace the existing `stateFilePath gibt korrekten .yjs-Pfad zurück` test in `tests/sync-handler.test.ts`:

```typescript
it('stateFilePath gibt per-User .yjs-Pfad zurück', () => {
  const vault = makeVaultMock() as any;
  const handler = new SyncHandler(vault, new CrdtManager(), 'a1b2c3d4');
  expect(handler.stateFilePath('folder/note.md')).toBe('folder/note.md.a1b2c3d4.yjs');
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/sync-handler.test.ts --testNamePattern "stateFilePath"
```

Expected: FAIL — constructor expects 2 args, not 3

- [ ] **Step 3: Update SyncHandler constructor and stateFilePath**

In `src/sync-handler.ts`:

```typescript
export class SyncHandler {
  constructor(
    private vault: VaultLike,
    private crdtManager: CrdtManager,
    private clientId: string
  ) {}

  stateFilePath(notePath: string): string {
    return `${notePath}.${this.clientId}.yjs`;
  }
  // ... rest unchanged
```

- [ ] **Step 4: Update remaining tests that construct SyncHandler**

In `tests/sync-handler.test.ts`, update every `new SyncHandler(vault, ...)` to `new SyncHandler(vault, ..., 'a1b2c3d4')`.

- [ ] **Step 5: Run all tests to verify they pass**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest
```

Expected: all PASS

- [ ] **Step 6: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/sync-handler.ts tests/sync-handler.test.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: SyncHandler uses per-user clientId in state filename"
```

---

### Task 4: SyncHandler — multi-file loadAndMerge

**Files:**
- Modify: `src/sync-handler.ts`
- Modify: `tests/sync-handler.test.ts`

- [ ] **Step 1: Write failing test for multi-file merge**

Add to `tests/sync-handler.test.ts`:

```typescript
it('loadAndMerge merged Änderungen von zwei verschiedenen Clients', async () => {
  const vault = makeVaultMock() as any;

  // Alice schreibt ihre .yjs
  const alice = new CrdtManager();
  alice.setContent('note.md', 'Alices Text\n');
  vault._files.set('note.md.alice001.yjs', alice.encodeState('note.md').buffer);

  // Bob schreibt seine .yjs
  const bob = new CrdtManager();
  bob.setContent('note.md', 'Bobs Text\n');
  vault._files.set('note.md.bob00001.yjs', bob.encodeState('note.md').buffer);

  const manager = new CrdtManager();
  const handler = new SyncHandler(vault, manager, 'local000');

  const merged = await handler.loadAndMerge('note.md');
  expect(merged).toContain('Alices Text');
  expect(merged).toContain('Bobs Text');
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/sync-handler.test.ts --testNamePattern "zwei verschiedenen"
```

Expected: FAIL — only reads one file

- [ ] **Step 3: Rewrite loadAndMerge**

Replace `loadAndMerge` in `src/sync-handler.ts`:

```typescript
async loadAndMerge(notePath: string): Promise<string | null> {
  const yjsFiles = this.vault.listYjsFiles(notePath);
  if (yjsFiles.length === 0) return null;

  if (!this.crdtManager.hasDoc(notePath)) {
    const noteFile = this.vault.getAbstractFileByPath(notePath);
    if (noteFile) {
      const localContent = await this.vault.read(noteFile);
      this.crdtManager.setContent(notePath, localContent);
    }
  }

  for (const yjsPath of yjsFiles) {
    const file = this.vault.getAbstractFileByPath(yjsPath);
    if (!file) continue;
    const buffer = await this.vault.readBinary(file);
    this.crdtManager.applyUpdate(notePath, new Uint8Array(buffer));
  }

  return this.crdtManager.getContent(notePath);
}
```

- [ ] **Step 4: Run all tests**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest
```

Expected: all PASS

- [ ] **Step 5: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/sync-handler.ts tests/sync-handler.test.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: loadAndMerge reads all sibling .yjs files"
```

---

### Task 5: FileWatcher — notePath extraction

**Files:**
- Modify: `src/file-watcher.ts`

- [ ] **Step 1: Update the regex in FileWatcher.start()**

Replace `src/file-watcher.ts`:

```typescript
import { TFile, Vault } from 'obsidian';

export type OnYjsChanged = (notePath: string) => Promise<void>;

const YJS_SUFFIX_RE = /\.[0-9a-f]{8}\.yjs$/;

export class FileWatcher {
  private eventRef: ReturnType<Vault['on']> | null = null;

  constructor(private vault: Vault, private onChanged: OnYjsChanged) {}

  start(): ReturnType<Vault['on']> {
    this.eventRef = this.vault.on('modify', async (file) => {
      if (!(file instanceof TFile)) return;
      const match = YJS_SUFFIX_RE.exec(file.path);
      if (!match) return;
      const notePath = file.path.slice(0, file.path.length - match[0].length);
      await this.onChanged(notePath);
    });
    return this.eventRef;
  }

  stop(): void {
    if (this.eventRef) {
      this.vault.offref(this.eventRef);
      this.eventRef = null;
    }
  }
}
```

- [ ] **Step 2: Run all tests**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest
```

Expected: all PASS (FileWatcher hat keine Unit-Tests, aber andere Tests dürfen nicht brechen)

- [ ] **Step 3: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/file-watcher.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: FileWatcher erkennt note.md.<clientId>.yjs format"
```

---

### Task 6: main.ts — clientId init + rename/delete handlers

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: clientId initialisieren in onload**

In `src/main.ts`, nach `await this.loadSettings();` einfügen:

```typescript
// ClientId beim ersten Start generieren
if (!this.settings.clientId) {
  this.settings.clientId = generateClientId();
  await this.saveSettings();
}
```

Import ergänzen:

```typescript
import { CrdtSyncSettings, CrdtSyncSettingTab, DEFAULT_SETTINGS, generateClientId } from './settings';
```

- [ ] **Step 2: SyncHandler mit clientId konstruieren**

```typescript
this.syncHandler = new SyncHandler(this.app.vault, this.crdtManager, this.settings.clientId);
```

- [ ] **Step 3: rename-Handler für multi-file aktualisieren**

Ersetze den bestehenden rename-Handler:

```typescript
this.registerEvent(
  this.app.vault.on('rename', async (file, oldPath) => {
    if (!(file instanceof TFile)) return;
    if (!file.path.endsWith('.md')) return;
    const yjsFiles = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(oldPath + '.') && f.path.endsWith('.yjs'));
    for (const yjsFile of yjsFiles) {
      const suffix = yjsFile.path.slice(oldPath.length);
      await this.app.fileManager.renameFile(yjsFile, file.path + suffix);
    }
    this.crdtManager.disposeDoc(oldPath);
  })
);
```

- [ ] **Step 4: delete-Handler für multi-file aktualisieren**

Ersetze den bestehenden delete-Handler:

```typescript
this.registerEvent(
  this.app.vault.on('delete', async (file) => {
    if (!(file instanceof TFile)) return;
    if (!file.path.endsWith('.md')) return;
    const yjsFiles = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(file.path + '.') && f.path.endsWith('.yjs'));
    for (const yjsFile of yjsFiles) {
      await this.app.vault.delete(yjsFile);
    }
    this.crdtManager.disposeDoc(file.path);
  })
);
```

- [ ] **Step 5: Run all tests**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest
```

Expected: all PASS

- [ ] **Step 6: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/main.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: wire clientId in main, multi-file rename/delete handlers"
```

---

### Task 7: Migration — alte note.md.yjs Dateien

**Files:**
- Modify: `src/sync-handler.ts` (listYjsFiles erweitern)
- Modify: `tests/sync-handler.test.ts`

Alte Dateien im Format `note.md.yjs` (ohne clientId) werden beim nächsten Merge automatisch mitgelesen. Kein explizites Umbenennen nötig — sie werden beim nächsten `saveState` durch die neue Datei ersetzt und können danach manuell gelöscht werden.

- [ ] **Step 1: listYjsFiles gibt auch alte .yjs zurück**

In `src/sync-handler.ts`, neue `listYjsFiles`-Implementierung ist bereits in der Klasse über das `vault`-Interface. Sicherstellen dass das Interface auch alte Dateien liefert.

In der realen Vault-Implementierung (via `getFiles()`): Obsidian's `vault.getFiles()` liefert alle Dateien. Die `listYjsFiles`-Implementierung in main.ts muss dies korrekt implementieren. Füge eine Helper-Methode zu `VaultLike` hinzu, die main.ts via `getFiles()` implementiert.

Da `VaultLike` ein Test-Interface ist und `main.ts` `this.app.vault` direkt nutzt, ergänze den SyncHandler um eine übergebene `listYjsFiles`-Funktion ODER implementiere es direkt in main.ts beim Aufruf. Einfachster Weg: `VaultLike.listYjsFiles` in main.ts so implementieren dass es auch `note.md.yjs` zurückgibt:

Beim Erstellen von SyncHandler in `main.ts`, übergib ein angepasstes Vault-Objekt:

```typescript
const vaultWithList = Object.assign(Object.create(Object.getPrototypeOf(this.app.vault)), this.app.vault, {
  listYjsFiles: (notePath: string) =>
    this.app.vault.getFiles()
      .map(f => f.path)
      .filter(p =>
        // Neues Format: note.md.<8hex>.yjs
        (p.startsWith(notePath + '.') && /\.[0-9a-f]{8}\.yjs$/.test(p)) ||
        // Altes Format: note.md.yjs (Migration)
        p === notePath + '.yjs'
      )
});
this.syncHandler = new SyncHandler(vaultWithList, this.crdtManager, this.settings.clientId);
```

- [ ] **Step 2: Write failing migration test**

In `tests/sync-handler.test.ts`:

```typescript
it('loadAndMerge liest auch alte note.md.yjs (Migration)', async () => {
  const vault = makeVaultMock() as any;

  // Alte .yjs Datei ohne clientId
  const old = new CrdtManager();
  old.setContent('note.md', 'Alter Inhalt\n');
  vault._files.set('note.md.yjs', old.encodeState('note.md').buffer);

  // Neue .yjs Datei mit clientId
  const remote = new CrdtManager();
  remote.setContent('note.md', 'Neuer Inhalt\n');
  vault._files.set('note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

  // Mock: listYjsFiles gibt beide zurück
  const origList = vault.listYjsFiles.bind(vault);
  vault.listYjsFiles = (notePath: string) => {
    const newFormat = origList(notePath);
    const oldPath = notePath + '.yjs';
    return vault._files.has(oldPath) ? [...newFormat, oldPath] : newFormat;
  };

  const manager = new CrdtManager();
  const handler = new SyncHandler(vault, manager, 'local000');

  const merged = await handler.loadAndMerge('note.md');
  expect(merged).toContain('Alter Inhalt');
  expect(merged).toContain('Neuer Inhalt');
});
```

- [ ] **Step 3: Run test — sollte bereits passen da loadAndMerge alle listYjsFiles-Ergebnisse merged**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest tests/sync-handler.test.ts --testNamePattern "Migration"
```

Expected: PASS (kein Code-Change nötig wenn listYjsFiles korrekt implementiert)

- [ ] **Step 4: Run all tests**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest
```

Expected: all PASS

- [ ] **Step 5: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add src/main.ts tests/sync-handler.test.ts
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "feat: migration — alte note.md.yjs beim Merge mitladen"
```

---

### Task 8: .gitattributes

**Files:**
- Create: `.gitattributes`

- [ ] **Step 1: .gitattributes anlegen**

```
*.yjs binary
```

Verhindert dass git versucht `.yjs`-Dateien als Text zu diffsen. Mit per-user files entstehen zwar keine Konflikte mehr, aber git würde sonst versuchen Binary-Content als Text anzuzeigen.

- [ ] **Step 2: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add .gitattributes
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "chore: mark .yjs as binary in .gitattributes"
```

---

### Task 9: README — GitHub-Workflow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: GitHub-Abschnitt in README einfügen**

Nach dem bestehenden `## Installation`-Abschnitt einfügen:

```markdown
## Mit GitHub teilen

Wenn ihr euren Vault über ein privates GitHub-Repository teilt (z.B. mit dem [Obsidian-Git-Plugin](https://github.com/denolehov/obsidian-git)):

1. Fügt eure `.gitattributes`-Datei hinzu (im Vault-Root):
   ```
   *.yjs binary
   ```
2. Stellt sicher dass `*.yjs` **nicht** in `.gitignore` steht.
3. Fertig — Qollab erkennt automatisch welche Änderungen von wem kommen.

**Warum funktioniert das?** Jedes Gerät schreibt eine eigene `.yjs`-Datei (z.B. `note.md.a1b2c3d4.yjs`). Git merged diese Dateien nie — jeder schreibt nur seine eigene. Wenn ihr zieht (`git pull`), erkennt Qollab die neue Datei und führt die Änderungen automatisch zusammen.
```

- [ ] **Step 2: Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add README.md
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "docs: GitHub workflow in README"
```

---

### Task 10: Full Build + Test

- [ ] **Step 1: Alle Tests ausführen**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx jest
```

Expected: all PASS, 0 failures

- [ ] **Step 2: Build**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; node esbuild.config.mjs production
```

Expected: `main.js` erzeugt, keine Fehler

- [ ] **Step 3: TypeScript-Check**

```powershell
cd C:\Users\tillq\obsidian-crdt-sync; npx tsc --noEmit
```

Expected: keine Fehler

- [ ] **Step 4: main.js in Plugin-Verzeichnis kopieren**

```powershell
Copy-Item C:\Users\tillq\obsidian-crdt-sync\main.js C:\Users\tillq\Obsidian_Vault\.obsidian\plugins\qollab\main.js
```

- [ ] **Step 5: Finaler Commit**

```powershell
git -C C:\Users\tillq\obsidian-crdt-sync add main.js
git -C C:\Users\tillq\obsidian-crdt-sync commit -m "build: v0.2.0 — GitHub collaboration via per-user .yjs files"
```
