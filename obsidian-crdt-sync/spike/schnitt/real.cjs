var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// spike/obsidian-stub.js
var require_obsidian_stub = __commonJS({
  "spike/obsidian-stub.js"(exports2, module2) {
    var TFile2 = class {
      constructor() {
        this.path = "";
        this.name = "";
        this.stat = { mtime: 0, ctime: 0, size: 0 };
      }
    };
    var TFolder = class {
    };
    var Notice = class {
    };
    var Plugin = class {
    };
    var PluginSettingTab = class {
    };
    var Setting = class {
    };
    module2.exports = { TFile: TFile2, TFolder, Notice, Plugin, PluginSettingTab, Setting };
  }
});

// spike/entry.ts
var entry_exports = {};
__export(entry_exports, {
  CrdtManager: () => CrdtManager,
  SyncHandler: () => SyncHandler,
  decodeStateFile: () => decodeStateFile,
  encodeStateFile: () => encodeStateFile,
  generateGuid: () => generateGuid,
  insertedTexts: () => insertedTexts,
  makeVaultMock: () => makeVaultMock,
  threeWayMerge: () => threeWayMerge,
  toArrayBuffer: () => toArrayBuffer,
  unionMerge: () => unionMerge
});
module.exports = __toCommonJS(entry_exports);

// obsidian-crdt-sync/src/crdt-manager.ts
var Y = __toESM(require("yjs"));
var import_diff_match_patch = require("diff-match-patch");
var istHoch = (c) => c >= 55296 && c <= 56319;
var istNiedrig = (c) => c >= 56320 && c <= 57343;
function alignSurrogateBoundaries(roh) {
  const aus = [];
  let i = 0;
  while (i < roh.length) {
    if (roh[i][0] === import_diff_match_patch.DIFF_EQUAL) {
      aus.push([roh[i][0], roh[i][1]]);
      i++;
      continue;
    }
    let entfernt = "";
    let eingefuegt = "";
    while (i < roh.length && roh[i][0] !== import_diff_match_patch.DIFF_EQUAL) {
      if (roh[i][0] === import_diff_match_patch.DIFF_DELETE) entfernt += roh[i][1];
      else eingefuegt += roh[i][1];
      i++;
    }
    const davor = aus.length > 0 ? aus[aus.length - 1] : void 0;
    if (davor && davor[0] === import_diff_match_patch.DIFF_EQUAL && davor[1].length > 0) {
      const letzte = davor[1].charCodeAt(davor[1].length - 1);
      if (istHoch(letzte)) {
        const zeichen = davor[1][davor[1].length - 1];
        davor[1] = davor[1].slice(0, -1);
        entfernt = zeichen + entfernt;
        eingefuegt = zeichen + eingefuegt;
      }
    }
    const danach = i < roh.length ? roh[i] : void 0;
    if (danach && danach[0] === import_diff_match_patch.DIFF_EQUAL && danach[1].length > 0) {
      const erste = danach[1].charCodeAt(0);
      if (istNiedrig(erste)) {
        const zeichen = danach[1][0];
        danach[1] = danach[1].slice(1);
        entfernt = entfernt + zeichen;
        eingefuegt = eingefuegt + zeichen;
      }
    }
    if (entfernt.length > 0) aus.push([import_diff_match_patch.DIFF_DELETE, entfernt]);
    if (eingefuegt.length > 0) aus.push([import_diff_match_patch.DIFF_INSERT, eingefuegt]);
  }
  return aus.filter((d) => d[1].length > 0);
}
function carriesYjsOps(update) {
  if (update.length === 0) return false;
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return probe.store.clients.size > 0;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}
function textFromUpdate(update) {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return probe.getText("content").toString();
  } catch {
    return "";
  } finally {
    probe.destroy();
  }
}
function isEmptyYjsState(update) {
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}
var CrdtManager = class {
  constructor() {
    this.dmp = new import_diff_match_patch.diff_match_patch();
    this.docs = /* @__PURE__ */ new Map();
    this.disposed = false;
  }
  getOrCreate(filePath) {
    if (this.disposed) throw new Error("CrdtManager already disposed");
    if (!this.docs.has(filePath)) {
      this.docs.set(filePath, new Y.Doc());
    }
    return this.docs.get(filePath);
  }
  // Diff-basiertes Update: berechnet die minimalen Positions-Ops zwischen dem
  // aktuellen Doc-Text und content und wendet sie in EINER Transaktion an.
  // Unveränderte Zeichen behalten ihre Yjs-Item-IDs — dadurch dedupliziert der
  // Merge zweier Replikate statt zu konkatenieren. Rohe Diffs (kein
  // diff_cleanupSemantic): Positionsgenauigkeit vor Lesbarkeit.
  setContent(filePath, content) {
    const doc = this.getOrCreate(filePath);
    const text = doc.getText("content");
    const current = text.toString();
    if (current === content) return;
    const diffs = alignSurrogateBoundaries(this.dmp.diff_main(current, content));
    doc.transact(() => {
      let pos = 0;
      for (const [op, data] of diffs) {
        if (op === import_diff_match_patch.DIFF_EQUAL) {
          pos += data.length;
        } else if (op === import_diff_match_patch.DIFF_INSERT) {
          text.insert(pos, data);
          pos += data.length;
        } else if (op === import_diff_match_patch.DIFF_DELETE) {
          text.delete(pos, data.length);
        }
      }
    });
  }
  hasDoc(filePath) {
    return this.docs.has(filePath);
  }
  // Prüft ob der Doc tatsächlich Ops enthält (State-Vector nicht leer).
  // Ein frischer Y.Doc ohne jegliche Edits hat store.clients.size === 0.
  // Nach setContent (Insert-Ops) oder Delete-Ops ist clients.size > 0.
  // Wird von Guard 2 (onRemoteYjsUpdate) genutzt, um einen historienlosen
  // Frisch-Doc von einer echten Leerung (User hat allen Text gelöscht) zu
  // unterscheiden.
  hasOps(filePath) {
    if (!this.docs.has(filePath)) return false;
    return this.docs.get(filePath).store.clients.size > 0;
  }
  getContent(filePath) {
    if (!this.docs.has(filePath)) return "";
    return this.docs.get(filePath).getText("content").toString();
  }
  encodeState(filePath) {
    return Y.encodeStateAsUpdate(this.getOrCreate(filePath));
  }
  applyUpdate(filePath, update) {
    Y.applyUpdate(this.getOrCreate(filePath), update);
  }
  mergeAndGet(filePath, remoteState) {
    this.applyUpdate(filePath, remoteState);
    return this.getContent(filePath);
  }
  disposeDoc(filePath) {
    this.docs.get(filePath)?.destroy();
    this.docs.delete(filePath);
  }
  // Szenariosuche F3: Der Doc zieht beim Umbenennen MIT, statt verworfen und
  // unter dem neuen Pfad aus der Platte neu aufgebaut zu werden.
  //
  // Der Neuaufbau war korrekt, solange der Dateiumzug im rename-Handler
  // vollständig gelang — er ist aber genau die IO, die scheitern kann (Pfadgrenze
  // für die 22 Zeichen längere Hilfsdatei, gehaltenes Handle). Bleibt die eigene
  // Hilfsdatei am alten Pfad liegen, findet der Neuaufbau unter dem neuen Pfad
  // nichts und prägt eine FRISCHE Inkarnation über einer lebenden Historie. Der
  // Umzug im Speicher kann dagegen nicht scheitern und ist gegenüber der Platte
  // nie veraltet (die eigene Hilfsdatei wird aus genau diesem Doc geschrieben).
  //
  // Ein Doc unter dem Zielpfad beschreibt eine Datei, die dort nicht mehr liegt
  // — Obsidian benennt nicht auf eine existierende Note um. Er wird verworfen,
  // wie es `renameNote` mit `guids[newPath]` ohnehin tut.
  renameDoc(from, to) {
    if (from === to) return;
    const doc = this.docs.get(from);
    if (!doc) return;
    this.docs.get(to)?.destroy();
    this.docs.delete(from);
    this.docs.set(to, doc);
  }
  disposeAll() {
    this.disposed = true;
    for (const doc of this.docs.values()) doc.destroy();
    this.docs.clear();
  }
};

// obsidian-crdt-sync/src/state-file.ts
var MAGIC = new Uint8Array([81, 76, 66, 49]);
var GUID_BYTES = 16;
var HEADER_LEN = MAGIC.length + GUID_BYTES;
function bytesToHex(bytes) {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
function generateGuid() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(GUID_BYTES)));
}
function encodeStateFile(guid, update) {
  const out = new Uint8Array(HEADER_LEN + update.length);
  out.set(MAGIC, 0);
  out.set(hexToBytes(guid), MAGIC.length);
  out.set(update, HEADER_LEN);
  return out;
}
function hasMagic(bytes) {
  if (bytes.length < HEADER_LEN) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return false;
  }
  return true;
}
function decodeStateFile(bytes) {
  if (!hasMagic(bytes)) {
    return { guid: null, update: bytes };
  }
  return {
    guid: bytesToHex(bytes.subarray(MAGIC.length, HEADER_LEN)),
    update: bytes.subarray(HEADER_LEN)
  };
}

// obsidian-crdt-sync/src/sidecar-io.ts
function dirname(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
async function ensureSidecarFolder(adapter, folderPath) {
  if (!folderPath) return;
  if (await sidecarExists(adapter, folderPath)) return;
  const parent = dirname(folderPath);
  if (parent) await ensureSidecarFolder(adapter, parent);
  try {
    await adapter.mkdir(folderPath);
  } catch {
  }
}
var fsCache;
function loadFs() {
  if (fsCache !== void 0) return fsCache;
  try {
    fsCache = require("fs");
  } catch {
    fsCache = null;
  }
  return fsCache;
}
function fsTarget(adapter, path) {
  const base = adapter.getBasePath?.();
  if (!base) return null;
  const fs = loadFs();
  if (!fs) return null;
  return { fs, abs: `${base}/${path}` };
}
function isNotFound(err) {
  const code = err?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function readSidecar(adapter, path) {
  const target = fsTarget(adapter, path);
  if (target) {
    try {
      const buf = await target.fs.promises.readFile(target.abs);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  if (!await adapter.exists(path)) return null;
  return adapter.readBinary(path);
}
async function statSidecar(adapter, path) {
  const target = fsTarget(adapter, path);
  if (target) {
    try {
      const s = await target.fs.promises.stat(target.abs);
      return { mtime: s.mtimeMs, size: s.size };
    } catch (err) {
      if (isNotFound(err)) return null;
    }
  }
  return adapter.stat(path);
}
async function sidecarExists(adapter, path) {
  return await statSidecar(adapter, path) !== null;
}
async function listDirFresh(adapter, dir) {
  const target = fsTarget(adapter, dir);
  if (!target) return null;
  try {
    const entries = await target.fs.promises.readdir(target.abs, { withFileTypes: true });
    const files = [];
    const folders = [];
    for (const e of entries) {
      (e.isDirectory() ? folders : files).push(`${dir}/${e.name}`);
    }
    return { files, folders };
  } catch {
    return null;
  }
}
async function listYjsInDir(adapter, notePath, cache) {
  const dir = dirname(`${QOLLAB_DIR}/${notePath}`) || QOLLAB_DIR;
  const cached = cache?.get(dir);
  if (cached !== void 0) return filterYjsFiles(cached, notePath);
  const files = await listDirFiles(adapter, dir);
  cache?.set(dir, files);
  return filterYjsFiles(files, notePath);
}
async function listDirFiles(adapter, dir) {
  const fresh = await listDirFresh(adapter, dir);
  if (fresh) return fresh.files;
  if (!await adapter.exists(dir)) return [];
  return (await adapter.list(dir)).files;
}

// obsidian-crdt-sync/src/text-merge.ts
var import_diff_match_patch2 = require("diff-match-patch");
var BOM = "\uFEFF";
var ohneBom = (text) => text.startsWith(BOM) ? text.slice(1) : text;
var aufLf = (text) => text.replace(/\r+\n/g, "\n");
var dmp = new import_diff_match_patch2.diff_match_patch();
function threeWayMerge(base, local, other) {
  const localBom = local.startsWith(BOM);
  const localBody = ohneBom(local);
  const baseLf = aufLf(ohneBom(base));
  const localLf = aufLf(localBody);
  const otherLf = aufLf(ohneBom(other));
  const patches = dmp.patch_make(baseLf, localLf);
  const [merged] = dmp.patch_apply(patches, otherLf);
  const eol = localBody.includes("\r\n") ? "\r\n" : "\n";
  const out = eol === "\n" ? merged : merged.replace(/\n/g, eol);
  return localBom ? BOM + out : out;
}
function insertedTexts(from, to) {
  if (from === to) return [];
  const diffs = dmp.diff_main(from, to);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.filter(([op]) => op === import_diff_match_patch2.diff_match_patch.DIFF_INSERT).map(([, text]) => text).filter((text) => text.trim() !== "");
}
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}
function padLast(lines, eol) {
  if (lines.length > 0 && !lines[lines.length - 1].endsWith("\n")) {
    lines[lines.length - 1] += eol;
  }
  return lines;
}
function unionMerge(other, local) {
  const localBom = local.startsWith(BOM);
  const otherBody = other.startsWith(BOM) ? other.slice(1) : other;
  const localBody = localBom ? local.slice(1) : local;
  const otherLf = aufLf(otherBody);
  const localLf = aufLf(localBody);
  if (otherLf === localLf) return local;
  const eol = localBody.includes("\r\n") ? "\r\n" : "\n";
  const otherNl = otherLf.endsWith("\n");
  const localNl = localLf.endsWith("\n");
  const otherLines = padLast(splitLines(otherLf), "\n");
  const localLines = padLast(splitLines(localLf), "\n");
  const localOrig = padLast(splitLines(localBody), eol);
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(
    otherLines.join(""),
    localLines.join("")
  );
  const diffs = dmp.diff_main(chars1, chars2, false);
  let merged;
  if (chars1.length === otherLines.length && chars2.length === localLines.length) {
    const out = [];
    let i = 0;
    let j = 0;
    for (const [op, chars] of diffs) {
      const n = chars.length;
      if (op === import_diff_match_patch2.diff_match_patch.DIFF_DELETE) {
        for (let k = 0; k < n; k++) out.push(otherLines[i + k].slice(0, -1) + eol);
        i += n;
      } else {
        for (let k = 0; k < n; k++) out.push(localOrig[j + k]);
        j += n;
        if (op === import_diff_match_patch2.diff_match_patch.DIFF_EQUAL) i += n;
      }
    }
    merged = out.join("");
  } else {
    dmp.diff_charsToLines_(diffs, lineArray);
    merged = diffs.map(([, text]) => text).join("").replace(/\n/g, eol);
  }
  if (!otherNl && !localNl) {
    if (merged.endsWith("\r\n")) merged = merged.slice(0, -2);
    else if (merged.endsWith("\n")) merged = merged.slice(0, -1);
  }
  return localBom ? BOM + merged : merged;
}

// obsidian-crdt-sync/src/sync-handler.ts
var QOLLAB_DIR = ".qollab";
function filterYjsFiles(allPaths, notePath) {
  const legacy = `${QOLLAB_DIR}/${notePath}.yjs`;
  const prefix = `${QOLLAB_DIR}/${notePath}.`;
  return allPaths.filter((p) => {
    if (p === legacy) return true;
    if (!p.startsWith(prefix)) return false;
    return /^[0-9a-f]{8}\.yjs$/.test(p.slice(prefix.length));
  });
}
var NO_TOMBSTONES = {
  has: () => false,
  addAll: async () => {
  }
};
var SidecarReadError = class extends Error {
  constructor(path) {
    super(`Sidecar nicht lesbar: ${path}`);
    this.path = path;
    this.name = "SidecarReadError";
  }
};
function hashBytes(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var SyncHandler = class {
  constructor(vault, crdtManager, clientId, tombstones = NO_TOMBSTONES, onCorruptFile, onUnreadableFile, onUnwritableFile, onUnrelatedMerge, onDiscardedIncarnation) {
    this.vault = vault;
    this.crdtManager = crdtManager;
    this.clientId = clientId;
    this.tombstones = tombstones;
    this.onCorruptFile = onCorruptFile;
    this.onUnreadableFile = onUnreadableFile;
    this.onUnwritableFile = onUnwritableFile;
    this.onUnrelatedMerge = onUnrelatedMerge;
    this.onDiscardedIncarnation = onDiscardedIncarnation;
    // Note-Pfad → GUID der aktuell geladenen Inkarnation.
    this.guids = /* @__PURE__ */ new Map();
    // Task 15 / Review C-1: aktueller Note-Pfad → Pfade, unter denen DIESELBE
    // Inkarnation auf DIESEM Gerät vorher gelebt hat (Rename-Historie der Sitzung).
    //
    // Grund: Der Tombstone ist seit Fix A an das Paar (notePath, guid) gebunden,
    // der delete-Handler sieht aber nur den zuletzt bewohnten Pfad. Nach
    // `alt.md → neu.md → delete` stünde der Tombstone allein auf `neu.md`; eine
    // verspätet ankommende Fremd-Sidecar unter `alt.md` mit derselben GUID fände
    // dort keinen — und sobald unter `alt.md` wieder eine (neue, unbeteiligte)
    // Note liegt, adoptiert ensureDoc die tote Inkarnation und unionMerge schiebt
    // ihren Inhalt in die fremde Note. Deshalb tombstont der delete-Handler die
    // ganze Pfad-Historie dieser Inkarnation, nicht nur den aktuellen Pfad.
    //
    // Bewusst NICHT beim Rename selbst tombstont: das entwertete `alt.md` für eine
    // LEBENDE Inkarnation und risse genau die Lücke wieder auf, die Fix A
    // geschlossen hat, sobald der Datei-Sync die .md unter dem alten Pfad
    // zurückspielt.
    //
    // „DIESELBE Inkarnation" ist wörtlich gemeint: `switchToGuid` tauscht die
    // Inkarnation unter einem Pfad aus und verwirft deshalb den Eintrag (Review
    // F-2) — die Historie gehört zur aufgegebenen, nicht zur neuen GUID.
    //
    // Grenze: rein in-memory und damit sitzungslokal. Nach einem App-Neustart ist
    // die Historie weg, ein Rename VOR dem Neustart und ein Delete DANACH tombstont
    // wieder nur den neuen Pfad. Vertretbar, weil Tombstones ohnehin gerätelokal
    // sind und der häufige Fall (Rename und Delete in derselben Sitzung) gedeckt
    // ist; die persistente Lösung ist Löschen als CRDT-Operation (Issue #11).
    this.priorPaths = /* @__PURE__ */ new Map();
    // Task 17/F-6: Notes, deren Stand beim letzten `saveState` NICHT auf die Platte
    // kam. Der Doc trägt ihn weiter, es fehlt nur die Persistenz — deshalb genügt es,
    // die Note zu markieren und den nächsten Trigger den Write wiederholen zu lassen.
    // Der Aufrufer nutzt die Markierung, um den Trigger unverbraucht zu lassen
    // (`onRemoteYjsUpdate` gibt dann `false`), damit dieser nächste Trigger auch
    // kommt.
    this.unpersisted = /* @__PURE__ */ new Set();
    // Notes, deren letzter applyLocalContent wegen eines IO-Fehlers abgebrochen ist,
    // samt dem Text, der dabei NICHT in den CRDT kam. Solange ein Eintrag steht, darf
    // kein Write-Back die .md überschreiben (Review F-2b).
    //
    // Warum der Text mitgespeichert wird und der Nachhol-Versuch nicht einfach den
    // aktuellen .md-Inhalt nimmt: Bricht der Lauf im pending-Zweig von
    // onRemoteYjsUpdate ab (R2-1), hat das vorangegangene loadAndMerge den Doc bereits
    // auf den Remote-Stand gezogen, ohne dass er je in die .md geschrieben wurde. Ein
    // späterer Diff „.md gegen Doc" hielte den Remote-Edit dann für eine lokale
    // Löschung und würde ihn zurückrollen (cross-device Datenverlust — der Spiegelfall
    // von I-1 aus Task 11). Der gemerkte Text ist dagegen genau das, was schon einmal
    // als korrekt berechnet wurde; ihn erneut anzuwenden ist idempotent.
    this.abortedReads = /* @__PURE__ */ new Map();
    // Task 16: Note-Pfad → gemeinsamer Vorfahr des nächsten lokalen .md-Diffs. Im
    // Normalfall ist das der .md-Text, wie dieses Plugin ihn zuletzt gesehen hat
    // (Read im modify-Handler/Sweep, eigener Write-Back).
    //
    // Warum nicht weiter der Doc-Text: `applyLocalContent` zieht ausstehende
    // Fremd-Sidecars in den Doc, schreibt die .md aber nicht zurück (das tut allein
    // der Write-Back in onRemoteYjsUpdate, ausgelöst vom 30-s-Poll). Zwischen
    // Fremd-Merge und Poll ist der Doc der Datei also legitim VORAUS. Nimmt der
    // nächste Tastendruck den Doc als Basis, ist das Delta „Basis → .md" genau die
    // Löschung des Fremd-Edits — als Delete-Op persistiert und zum Peer propagiert
    // (fund-endzustaende.md Fund 1: stiller, unheilbarer Verlust auf beiden Geräten).
    // Gegen den zuletzt gesehenen .md-Text gediffed, ist der Vorlauf per Konstruktion
    // keine lokale Änderung.
    //
    // Fehlt ein Eintrag (frischer Prozess, Note erstmals angefasst), bleibt es beim
    // Doc-Text: dort ist er der letzte von uns erfasste .md-Stand und die Basis
    // korrekt. Grenze: rein in-memory. Ging die App zwischen Fremd-Merge und
    // Write-Back aus, ist der aus der eigenen Sidecar rekonstruierte Doc weiterhin
    // voraus und der Fallback wieder falsch — dieses Fenster schließt der Initial-Scan
    // des Watchers (Write-Back vor dem ersten modify), nicht diese Map.
    this.localDiffBase = /* @__PURE__ */ new Map();
    // Task 14: Signatur unserer eigenen Sidecars + Pfade, die wir gerade schreiben
    // (writingPaths-Analogon für Sidecars). Beides zusammen hält das False-Positive-
    // Fenster der Kollisionserkennung klein.
    this.ownSignatures = /* @__PURE__ */ new Map();
    this.writingSidecars = /* @__PURE__ */ new Set();
  }
  hasUnpersistedState(notePath) {
    return this.unpersisted.has(notePath);
  }
  // Setzt die Basis explizit. Zwei Anlässe in onRemoteYjsUpdate: nach dem
  // Write-Back (die Datei trägt jetzt den gemergten Stand) und vor dem
  // `applyLocalContent(threeWay)` des pending-Zweigs (dessen Text setzt auf dem
  // gemergten Doc auf, nicht auf dem alten .md-Stand).
  //
  // Ohne diesen Kanal bliebe die Basis nach einem Write-Back auf dem ALTEN .md-Text
  // stehen; das Delta enthielte dann die Fremd-Einfügung, die der Doc bereits hat,
  // und `threeWayMerge` fügte sie ein zweites Mal ein (patch_apply dedupliziert
  // nicht — siehe WARNUNG in text-merge.ts).
  noteLocalDiffBase(notePath, content) {
    this.localDiffBase.set(notePath, content);
  }
  // True, solange für diese Note ein abgebrochener Lauf nachzuholen ist.
  hasAbortedRead(notePath) {
    return this.abortedReads.has(notePath);
  }
  // Der Text, dessen Erfassung abgebrochen ist — für den Nachhol-Versuch.
  pendingLocalContent(notePath) {
    return this.abortedReads.get(notePath);
  }
  // Szenariosuche Welle 2, Fund 1: Derselbe Rückkanal von AUSSEN gemeldet.
  //
  // Der Pfad-Abbruch in main.ts (modify-Handler und Sweep, `file.path !==
  // notePath`) stellt exakt den Zustand her, für den `abortedReads` gebaut wurde:
  // Der `.md`-Text ist gelesen, aber weder im Doc noch in der eigenen Sidecar —
  // er lebt allein in der Datei. Der Unterschied zum IO-Abbruch oben ist nur, WER
  // abgebrochen hat; die Folge ist dieselbe, und ohne Markierung schreibt
  // `onRemoteYjsUpdate` beim nächsten Fremd-Trigger über `data === preMerge` den
  // Doc-Stand zurück, der den Edit nicht kennt (kein Delete-Op, keine Meldung,
  // kein Weg zurück).
  //
  // Gemeldet wird unter `notePath`, dem Schlüssel der Warteschlange — nicht unter
  // dem inzwischen gültigen `file.path`. Der Abbruch existiert gerade deshalb,
  // weil der neue Pfad hier nicht gedeckt ist; ihn als Schlüssel zu benutzen
  // wiederholte den Fehler, den er verhindert. Auf den neuen Pfad hebt der
  // rename-Handler die Markierung (siehe `renameNote`) zusammen mit GUID, Doc und
  // Sidecars — derselbe Weg, den der gesamte übrige Zustand nimmt.
  noteUncapturedLocalContent(notePath, content) {
    this.abortedReads.set(notePath, content);
  }
  stateFilePath(notePath) {
    return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
  }
  // Task 19/C — der EINE Ort, an dem zwei unverwandte Änderungsketten vereinigt
  // werden. Bis hierher taten das drei Aufrufer auf eigene Rechnung; jetzt geht
  // jeder durch diese Tür, und die Tür meldet, was sie sieht.
  //
  // Gemeldet wird nur, wenn BEIDE Seiten etwas beigetragen haben. Ist eine Seite
  // in der anderen enthalten — der häufigste Fall: leere `.md`, noch nicht
  // nachgezogene Datei, identischer Stand beim Erstkontakt —, gibt `unionMerge`
  // eine der Eingaben unverändert zurück, es entsteht keine Dopplung, und es gibt
  // nichts zu melden. Genau diese Kürzung hält die Meldung von einem Dauerton
  // fern.
  //
  // Warum hier nicht VERWEIGERT wird, obwohl der Task so heißt: Ein Abbruch
  // müsste einen der beiden Stände fallen lassen oder in eine Konfliktkopie
  // auslagern. Beides senkt die Menge dessen, was in der Note steht — gemessen
  // am deterministischen Fuzzer wäre das ein Anstieg der Verlust-Kategorie, und
  // „Verlust darf nicht steigen" ist die harte Auflage. Verweigert wird deshalb
  // die STILLE: die Vereinigung bleibt, sie wird nur nicht mehr verschwiegen.
  unite(notePath, other, local) {
    const merged = unionMerge(other, local);
    if (merged !== other && merged !== local) this.onUnrelatedMerge?.(notePath);
    return merged;
  }
  // Task 14: Neue Geräte-ID nach erkannter Kollision. Die bisherigen Signaturen
  // gehören zu Pfaden, die uns ab jetzt nicht mehr gehören (sie sind Fremd-Sidecars
  // des anderen Geräts) — deshalb verwerfen statt mitschleppen.
  setClientId(clientId) {
    this.clientId = clientId;
    this.ownSignatures.clear();
  }
  // Task 14: Hat ein FREMDER Schreiber unsere eigene Sidecar-Datei überschrieben?
  // Das ist das Symptom einer geklonten clientId (mitgesyncte data.json): beide
  // Geräte schreiben denselben Pfad, und der Self-Ignore des Watchers verschluckt
  // den Peer dauerhaft. Aufrufer ist der Poll, der die (mtime,size)-Änderung schon
  // festgestellt hat; `cur` ist genau dieser Stand.
  //
  // Ausschlüsse in dieser Reihenfolge (lieber ein verpasster als ein erfundener Fund
  // — Neu-Provisionierung ist zwar gutartig, aber nicht gratis):
  //   1. Wir schreiben diesen Pfad gerade selbst.
  //   2. Signatur passt exakt → unser letzter Write.
  //   3. Bytes identisch mit unserem letzten Stand → Sync-Tool hat unsere eigene
  //      Datei zurückkopiert (neue mtime, gleicher Inhalt).
  //   4. Keine Signatur (erste Sichtung nach dem Start) → Baseline setzen; über
  //      einen Schreiber lässt sich hier nichts aussagen.
  //   5. Unlesbar oder verschwunden → keine Aussage (transienter IO-Fehler).
  async isForeignSidecarWrite(path, cur) {
    if (this.writingSidecars.has(path)) return false;
    const known = this.ownSignatures.get(path);
    if (known && cur && known.mtime === cur.mtime && known.size === cur.size) return false;
    let buffer;
    try {
      buffer = await readSidecar(this.vault.adapter, path);
    } catch {
      return false;
    }
    if (buffer === null) return false;
    const bytes = new Uint8Array(buffer);
    const signature = {
      mtime: cur?.mtime ?? known?.mtime ?? 0,
      size: bytes.length,
      hash: hashBytes(bytes)
    };
    if (!known) {
      this.ownSignatures.set(path, signature);
      return false;
    }
    if (known.hash === signature.hash && known.size === signature.size) {
      this.ownSignatures.set(path, signature);
      return false;
    }
    return true;
  }
  // Aktuelle GUID der Note: aus der Map, sonst aus dem Header der eigenen .yjs.
  // Reiner Lese-Zugriff auf die EIGENE Sicht. Der delete-Handler nutzt seit
  // Review F-1 `guidsToTombstone` (siehe dort); hier bleibt bewusst alles wie
  // gehabt, damit der Merge-/Adopt-Pfad unberührt ist.
  async currentGuid(notePath) {
    const mapped = this.guids.get(notePath);
    if (mapped) return mapped;
    const own = await this.readStateFile(this.stateFilePath(notePath)).catch(() => null);
    return own?.guid ?? null;
  }
  // NUR für den Delete-Pfad (Review F-1): welche Inkarnationen sind unter diesem
  // Pfad zu beerdigen?
  //
  // `currentGuid` kennt ausschließlich die eigene Sicht (guids-Map + eigene
  // Sidecar). Eine Note, die per Datei-Sync mit einer FREMDEN Sidecar ankam und
  // hier nie geöffnet oder editiert wurde, hat beides nicht — sie lieferte `null`,
  // und der delete-Handler setzte gar keinen Tombstone, auch nicht für den
  // aktuellen Pfad. Trifft danach eine stale Fremd-Sidecar auf eine gleichnamige
  // Neuanlage, adoptiert ensureDoc die tote Inkarnation und unionMerge zieht ihren
  // Inhalt hinein. (Kein Task-15-Regress: master/v0.4.0 verhalten sich identisch.)
  //
  // Deshalb: findet sich keine eigene GUID, zählen die dekodierbaren GUIDs der
  // Fremd-Siblings. Bewusst ALLE, nicht nur die Tie-Break-Gewinnerin:
  //   - Der Schlüssel ist (notePath, guid). Ein Tombstone auf eine Verlierer-GUID
  //     an DIESEM Pfad kann dieselbe Inkarnation unter einem anderen Pfad nicht
  //     treffen — der Schaden, den Fix A beseitigt hat, entsteht hier nicht.
  //   - Nur die Gewinnerin zu tombstonen risse die Lücke direkt wieder auf: ist
  //     deren Sidecar weg, wählt pickWinnerGuid schlicht die nächstkleinere
  //     verbliebene GUID, und der Adopt-Zweig belebt die Note darüber wieder.
  //   - Was hier liegt, hat unter diesem Pfad gelebt; der Nutzer hat den Pfad
  //     gelöscht. Split-Brain-Reste sind mehrere Leichen, nicht weniger.
  //
  // Rückgabe `null` heißt „Stand unbekannt" (transienter IO-Fehler) — der Aufrufer
  // setzt dann GAR KEINEN Tombstone, statt auf Halbwissen eine womöglich lebende
  // Inkarnation zu beerdigen. Das leere Array heißt „nachweislich keine GUID".
  async guidsToTombstone(notePath) {
    const mapped = this.guids.get(notePath);
    if (mapped) return [mapped];
    const ownPath = this.stateFilePath(notePath);
    try {
      const own = await this.readStateFile(ownPath);
      if (own?.guid) return [own.guid];
      const foreign = (await this.vault.listYjsFiles(notePath)).filter((p) => p !== ownPath);
      const guids = /* @__PURE__ */ new Set();
      for (const path of foreign) {
        const d = await this.readStateFile(path);
        if (d?.guid) guids.add(d.guid);
      }
      return [...guids];
    } catch {
      return null;
    }
  }
  // Pfade, unter denen die aktuell unter `notePath` geladene Inkarnation auf
  // diesem Gerät gelebt hat — der aktuelle Pfad zuerst, dann die Rename-Historie.
  // Der delete-Handler tombstont sie alle (Review C-1, siehe `priorPaths`).
  // Dedupliziert: ein Hin-und-Zurück-Rename (a → b → a) führte sonst zu einem
  // doppelten Tombstone-Write inklusive doppeltem saveSettings.
  incarnationPaths(notePath) {
    return [.../* @__PURE__ */ new Set([notePath, ...this.priorPaths.get(notePath) ?? []])];
  }
  // Note vergessen (delete-Handler): Doc + GUID-Map-Eintrag entfernen.
  disposeNote(notePath) {
    this.guids.delete(notePath);
    this.abortedReads.delete(notePath);
    this.localDiffBase.delete(notePath);
    this.priorPaths.delete(notePath);
    this.ownSignatures.delete(this.stateFilePath(notePath));
    this.crdtManager.disposeDoc(notePath);
  }
  // Rename: gleiche Inkarnation, GUID bleibt erhalten — Map-Eintrag umziehen.
  //
  // Szenariosuche F3: Der Doc wird MITGENOMMEN statt verworfen. Früher wurde er
  // verworfen und beim nächsten Zugriff aus den (bereits umbenannten) .yjs unter
  // dem neuen Pfad neu aufgebaut — das setzte voraus, dass der Dateiumzug im
  // rename-Handler vollständig gelungen ist. Genau der kann scheitern (Details in
  // `CrdtManager.renameDoc` und im Handler). Nebenbei behoben: Ein Rename nach
  // einem gescheiterten `saveState` warf den nur im Doc lebenden Stand weg.
  renameNote(oldPath, newPath) {
    const guid = this.guids.get(oldPath);
    this.guids.delete(oldPath);
    if (guid) this.guids.set(newPath, guid);
    const uncaptured = this.abortedReads.get(oldPath);
    this.abortedReads.delete(oldPath);
    if (uncaptured !== void 0) this.abortedReads.set(newPath, uncaptured);
    const seen = this.localDiffBase.get(oldPath);
    this.localDiffBase.delete(oldPath);
    if (seen !== void 0) this.localDiffBase.set(newPath, seen);
    const prior = this.priorPaths.get(oldPath) ?? [];
    this.priorPaths.delete(oldPath);
    this.priorPaths.set(newPath, [.../* @__PURE__ */ new Set([...prior, oldPath])]);
    this.ownSignatures.delete(this.stateFilePath(oldPath));
    this.ownSignatures.delete(this.stateFilePath(newPath));
    this.crdtManager.renameDoc(oldPath, newPath);
  }
  // Löscht eine Sidecar, falls vorhanden (Ersatz für das frühere
  // getAbstractFileByPath-if(file)-delete-Muster über den Adapter).
  async removeSidecar(path) {
    if (await sidecarExists(this.vault.adapter, path)) await this.vault.adapter.remove(path);
  }
  async saveState(notePath) {
    let guid = this.guids.get(notePath);
    if (!guid) {
      guid = generateGuid();
      this.guids.set(notePath, guid);
    }
    const update = this.crdtManager.encodeState(notePath);
    const state = encodeStateFile(guid, update);
    const stateFile = this.stateFilePath(notePath);
    if (await this.sidecarBytesEqual(stateFile, state)) {
      await this.rememberOwnSidecar(stateFile, state);
      this.unpersisted.delete(notePath);
      return;
    }
    this.writingSidecars.add(stateFile);
    try {
      await ensureSidecarFolder(this.vault.adapter, dirname(stateFile));
      await this.vault.adapter.writeBinary(stateFile, state);
      await this.rememberOwnSidecar(stateFile, state);
      this.unpersisted.delete(notePath);
    } catch {
      this.unpersisted.add(notePath);
      this.onUnwritableFile?.(stateFile);
    } finally {
      this.writingSidecars.delete(stateFile);
    }
  }
  // Merkt sich, was wir zuletzt unter dem eigenen Pfad abgelegt haben (Task 14).
  async rememberOwnSidecar(path, bytes) {
    const stat = await statSidecar(this.vault.adapter, path).catch(() => null);
    this.ownSignatures.set(path, {
      mtime: stat?.mtime ?? 0,
      size: stat?.size ?? bytes.length,
      hash: hashBytes(bytes)
    });
  }
  // True, wenn die Sidecar existiert und byteweise identisch mit bytes ist.
  // Lese-/Decode-Fehler oder Nichtexistenz → false (dann normal schreiben).
  async sidecarBytesEqual(path, bytes) {
    try {
      const buffer = await readSidecar(this.vault.adapter, path);
      if (buffer === null) return false;
      const disk = new Uint8Array(buffer);
      if (disk.length !== bytes.length) return false;
      for (let i = 0; i < bytes.length; i++) {
        if (disk[i] !== bytes[i]) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  async readStateFile(path) {
    let buffer;
    try {
      buffer = await readSidecar(this.vault.adapter, path);
    } catch {
      this.onUnreadableFile?.(path);
      throw new SidecarReadError(path);
    }
    if (buffer === null) return null;
    try {
      const { guid, update } = decodeStateFile(new Uint8Array(buffer));
      return { path, guid, update };
    } catch {
      this.onCorruptFile?.(path);
      return null;
    }
  }
  // Dekodiert Sibling-Pfade und wendet die Tombstone- und Legacy-Regeln an:
  //   C.3: Eine für DIESEN Pfad getombstonte GUID → Datei als stale Leiche
  //        löschen und ausschließen. Der Tombstone gilt seit Task 15 pro Paar
  //        (notePath, guid), deshalb braucht die Prüfung den Pfad.
  //   R1:  Legacy-Dateien (v0.1) dienen nur dem Erst-Import. Existiert unter den
  //        übergebenen Pfaden mindestens ein GUID-tragender Sidecar, werden sie
  //        ignoriert und gelöscht.
  //
  // Task 17/F-1: „Legacy" verlangt einen POSITIVEN Nachweis, nicht mehr den
  // Negativbefund „trägt keine GUID". `hasMagic` (state-file.ts) liefert für jede
  // Datei unter 20 Byte `false` — auch für 0 Byte —, und `decodeStateFile` meldet
  // dann `guid: null`. Damit galt jede unvollständig materialisierte Fremd-Datei
  // als v0.1-Leiche und wurde von der Platte gelöscht; der bidirektionale Sync
  // trug die Löschung zurück und vernichtete dort den echten State. Auslöser sind
  // real (fehlgeschlagene OneDrive-Hydrierung, abgebrochener Transfer,
  // Sicherheitssoftware), und die Asymmetrie war das eigentliche Ärgernis: eine
  // Datei AB 20 Byte mit kaputtem Inhalt wurde schonend behandelt (übersprungen,
  // `onCorruptFile`), die harmlosere darunter gelöscht.
  //
  // Der Nachweis läuft über die PFADFORM, nicht über den Inhalt: v0.1 schrieb
  // `.qollab/<note>.yjs` ohne clientId-Segment (`legacyFilePath`). Das clientId-
  // Segment und der QLB1-Header kamen gemeinsam in v0.4.0 (Commit `9095f3c` ist in
  // keinem Tag außer `v0.4.0` enthalten, und der trägt auch `e2dd21c`) — eine
  // Datei mit gültigem `<8-hex>.yjs`-Namen ohne Header ist deshalb NIE eine
  // v0.1-Datei, sondern unfertig oder korrupt. Zusätzlich muss der Inhalt als
  // Yjs-Update lesbar sein, sonst ist auch eine Datei in Legacy-Pfadform nur
  // „Stand unbekannt". Alles ohne Nachweis: überspringen, melden, NIE löschen.
  //
  // Damit erübrigt sich der `ownPath`-Schutz, den der Tombstone-Zweig unten trägt:
  // `ownPath` hat per Konstruktion ein clientId-Segment und kann den Legacy-Zweig
  // nicht mehr erreichen. Kein toter Vergleich, sondern eine stärkere Zusage.
  //
  // Die frühere Begründung, die eigene Datei könne nie fälschlich gelöscht werden
  // („die eigene GUID landet nie im Tombstone-Set"), war nachweislich falsch: ein
  // sync-vermittelter Rename stellt eine Umbenennung als delete+create zu und
  // tombstont damit eine LEBENDE Inkarnation, und im Adopt-Zweig hängt dieselbe
  // GUID ohnehin an mehreren Pfaden. Stattdessen gilt hart: über den
  // Tombstone-Zweig wird die eigene Sidecar nie gelöscht, nur vom Ergebnis
  // ausgeschlossen (siehe unten).
  async decodeSiblings(notePath, paths) {
    const decoded = [];
    for (const path of paths) {
      decoded.push(await this.readStateFile(path));
    }
    const hasGuidState = decoded.some((d) => d !== null && d.guid !== null);
    const ownPath = this.stateFilePath(notePath);
    const legacyPath = this.legacyFilePath(notePath);
    const result = [];
    for (let i = 0; i < paths.length; i++) {
      const d = decoded[i];
      if (!d) continue;
      if (d.guid !== null && this.tombstones.has(d.guid, notePath)) {
        if (paths[i] !== ownPath) await this.removeSidecar(paths[i]);
        continue;
      }
      if (d.guid === null) {
        const legitimatelyEmpty = paths[i] === legacyPath && isEmptyYjsState(d.update);
        if (!carriesYjsOps(d.update) && !legitimatelyEmpty) {
          this.onCorruptFile?.(paths[i]);
          continue;
        }
        if (hasGuidState) {
          if (paths[i] === legacyPath) await this.removeSidecar(paths[i]);
          continue;
        }
      }
      result.push(d);
    }
    return result;
  }
  // Bytewise/lexikografisch kleinste GUID gewinnt (deterministisch auf allen
  // Geräten). Legacy-Siblings (guid null) tragen keine GUID bei — sie sind mit
  // allem kompatibel. ownGuid ist immer Kandidat, wenn gesetzt.
  pickWinnerGuid(siblings, ownGuid) {
    let winner = ownGuid;
    for (const s of siblings) {
      if (s.guid === null) continue;
      if (winner === void 0 || s.guid < winner) winner = s.guid;
    }
    return winner;
  }
  // Bootstrappt den Doc NIE aus dem .md-Text, immer aus persistiertem State und
  // etabliert dabei die GUID der Inkarnation.
  //   1. eigener State vorhanden → dessen Header-GUID übernehmen (Legacy → neue
  //      GUID), Update anwenden.
  //   2. sonst fremde Siblings adoptieren: getombstonte löschen, per Tie-Break
  //      die Gewinner-GUID bestimmen und alle kompatiblen (Gewinner-GUID +
  //      Legacy) mergen.
  //   3. gar nichts → neue GUID, leerer Doc (lazy).
  //
  // Rückgabe: true, wenn der Adopt-Zweig gelaufen ist UND dabei der lokale
  // .md-Text in den Doc vereinigt wurde. Der Aufrufer darf den .md-Text dann
  // nicht ein zweites Mal einspielen (siehe mergeForLocalDiff).
  async ensureDoc(notePath) {
    if (this.crdtManager.hasDoc(notePath)) {
      if (!this.guids.has(notePath)) {
        const own2 = await this.readStateFile(this.stateFilePath(notePath));
        this.guids.set(notePath, own2?.guid ?? generateGuid());
      }
      return false;
    }
    const own = await this.readStateFile(this.stateFilePath(notePath));
    if (own && (own.guid !== null || carriesYjsOps(own.update))) {
      try {
        this.crdtManager.applyUpdate(notePath, own.update);
      } catch {
        this.crdtManager.disposeDoc(notePath);
        this.onCorruptFile?.(own.path);
        throw new SidecarReadError(own.path);
      }
      this.guids.set(notePath, own.guid ?? generateGuid());
      return false;
    }
    if (own) {
      this.onCorruptFile?.(own.path);
    }
    const ownPath = this.stateFilePath(notePath);
    const foreign = await this.decodeSiblings(
      notePath,
      (await this.vault.listYjsFiles(notePath)).filter((p) => p !== ownPath)
    );
    const winner = this.pickWinnerGuid(foreign, void 0);
    this.guids.set(notePath, winner ?? generateGuid());
    this.mergeCompatible(notePath, foreign);
    this.reportDiscarded(notePath, foreign);
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return false;
    const mdText = await this.vault.read(file);
    this.crdtManager.setContent(
      notePath,
      this.unite(notePath, this.crdtManager.getContent(notePath), mdText)
    );
    return true;
  }
  // Task 20: Meldet EINMAL, wenn unter den Siblings eine Fassung liegt, die
  // gerade endgültig verworfen wurde — abweichende Kennung und tatsächlich
  // Operationen an Bord.
  //
  // Bewusst NICHT in `mergeCompatible` selbst: die Funktion läuft auch aus
  // `mergePendingForeign` (modify-Pfad), und dort ist das Übergehen einer
  // fremden Kennung ausdrücklich vorläufig — der Tie-Break entscheidet erst im
  // Poll. Eine Meldung dort wäre ein Fehlalarm für eine Lage, die sich Sekunden
  // später von selbst auflöst (und die dann `onUnrelatedMerge` korrekt meldet).
  //
  // `carriesYjsOps` ist die zweite Engführung: Eine leere oder halb
  // materialisierte Datei trägt nichts, was verloren gehen könnte. Ohne diese
  // Prüfung meldete jede 0-Byte-Sidecar aus dem OneDrive-Hauptauslöser einen
  // Verlust, den es nicht gibt.
  reportDiscarded(notePath, siblings) {
    if (!this.onDiscardedIncarnation) return;
    const guid = this.guids.get(notePath);
    const eigenerText = this.crdtManager.getContent(notePath);
    for (const s of siblings) {
      if (s.guid === null || s.guid === guid) continue;
      if (!carriesYjsOps(s.update)) continue;
      const fremderText = textFromUpdate(s.update);
      if (unionMerge(eigenerText, fremderText) === eigenerText) continue;
      this.onDiscardedIncarnation(notePath, s.guid);
      return;
    }
  }
  // Merged alle Siblings, deren GUID der aktuellen entspricht oder die Legacy
  // (null) sind. Fremde, nicht getombstonte Verlierer-GUIDs werden ignoriert.
  // R2: korrupte Updates (ungültige Yjs-Bytes) werden pro Sibling gefangen;
  // der Gesamtmerge läuft mit den verbleibenden validen Siblings weiter.
  mergeCompatible(notePath, siblings) {
    const guid = this.guids.get(notePath);
    for (const s of siblings) {
      if (s.guid === null || s.guid === guid) {
        try {
          this.crdtManager.applyUpdate(notePath, s.update);
        } catch {
          this.onCorruptFile?.(s.path);
        }
      }
    }
  }
  // C.4 Verlierer-Fall: eigene Historie verwerfen, auf die Gewinner-Inkarnation
  // wechseln. Aktuellen .md-Text merken, Doc verwerfen, aus den Gewinner-GUID-
  // Siblings neu aufbauen, GUID setzen, gemerkten .md-Text als Diff einspielen.
  async switchToGuid(notePath, winner, siblings) {
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return;
    const mdText = await this.vault.read(file);
    const localText = unionMerge(this.crdtManager.getContent(notePath), mdText);
    this.crdtManager.disposeDoc(notePath);
    this.guids.set(notePath, winner);
    this.priorPaths.delete(notePath);
    for (const s of siblings) {
      if (s.guid === winner) {
        try {
          this.crdtManager.applyUpdate(notePath, s.update);
        } catch {
          this.onCorruptFile?.(s.path);
        }
      }
    }
    const winnerText = this.crdtManager.getContent(notePath);
    if (winnerText === localText) return;
    this.crdtManager.setContent(notePath, this.unite(notePath, winnerText, localText));
  }
  // Pfad der clientId-losen Legacy-Datei (v0.1-Ära).
  legacyFilePath(notePath) {
    return `${QOLLAB_DIR}/${notePath}.yjs`;
  }
  // R1: Löscht die Legacy-Datei (v0.1-Form ohne clientId-Segment) einer Note, falls
  // sie noch existiert. Wird nach saveState aufgerufen: zu dem Zeitpunkt existiert
  // GUID-tragender State, sodass die Legacy-Datei nicht mehr gebraucht wird.
  //
  // Task 17/F-1: Gelöscht wird nur bei positivem Nachweis — die Datei muss
  // nachweisbare Yjs-Ops tragen (Task 17/R-1: „lesbar" genügte nicht, siehe
  // carriesYjsOps). Sonst räumte genau dieser Aufruf die 0-Byte- bzw.
  // nullgefüllte Fassung einer noch nicht hydrierten v0.1-Datei ab, hinter dem
  // Rücken des Guards in `decodeSiblings`. Kein zusätzlicher IO im Normalfall:
  // existiert keine Legacy-Datei (der Regelfall), bleibt es beim einen `stat`.
  async cleanupLegacyFile(notePath) {
    if (this.unpersisted.has(notePath)) return;
    const path = this.legacyFilePath(notePath);
    let buffer;
    try {
      buffer = await readSidecar(this.vault.adapter, path);
    } catch {
      return;
    }
    if (buffer === null) return;
    const { guid, update } = decodeStateFile(new Uint8Array(buffer));
    if (guid !== null || !(carriesYjsOps(update) || isEmptyYjsState(update))) return;
    await this.vault.adapter.remove(path);
  }
  // Review I-3: Entscheidungsgrundlage für den Startup-Sweep — könnte ensureDoc
  // für diese Note eine FREMDE Inkarnation adoptieren? Bewusst über dieselbe
  // decodeSiblings-Kette wie ensureDoc (Tombstone-, Legacy- und Korrupt-Regeln
  // inklusive), damit Sweep und Adoption nicht auseinanderdriften.
  //
  // Reine Datei-Existenz genügt nicht: eine korrupte oder halb kopierte Sidecar
  // (Sync-Dienst schreibt gerade — der von Task 12 belegte Realfall), eine
  // getombstete oder eine reine Legacy-Datei liefert KEINE GUID. pickWinnerGuid
  // gäbe dann `undefined` zurück und ensureDoc prägte genau die frische
  // Inkarnation, die Fix B verhindern soll (Split-Brain durch die Hintertür).
  // Deshalb: adoptierbar = mindestens ein Sibling mit dekodierbarer GUID.
  //
  // Legacy-Dateien fallen bewusst NICHT darunter: ihr Erst-Import bleibt Sache
  // des Watchers (er triggert auch auf die Legacy-Form), der ihn mit vorhandener
  // .md über loadAndMerge fährt — der Sweep muss dafür nicht blind prägen.
  // Nebeneffekt wie in ensureDoc: getombstete und obsolete Legacy-Dateien werden
  // dabei aufgeräumt.
  //
  // Task 19/B (Hebel 3): `cache` bündelt die Verzeichnis-Listings eines
  // Sweep-Durchlaufs. Nur diese ENTSCHEIDUNG wird daraus bedient; der
  // Arbeitspfad darunter (ensureDoc, loadAndMerge, mergePendingForeign) listet
  // unverändert frisch — er mutiert Zustand und darf das nie auf einer
  // gepufferten Sicht tun.
  async hasAdoptableGuid(notePath, cache) {
    const ownPath = this.stateFilePath(notePath);
    const foreign = (await this.vault.listYjsFiles(notePath, cache)).filter((p) => p !== ownPath);
    if (foreign.length === 0) return false;
    try {
      return (await this.decodeSiblings(notePath, foreign)).some((s) => s.guid !== null);
    } catch (err) {
      if (err instanceof SidecarReadError) return false;
      throw err;
    }
  }
  // Zieht ausstehende KOMPATIBLE Fremd-Sidecars (gleiche/legacy GUID) in den Doc
  // ein — reine mergeCompatible-Semantik, KEIN Tie-Break. Split-Brain (fremde
  // Gewinner-GUID, switchToGuid) bleibt ausschließlich Sache von loadAndMerge; hier
  // werden Verlierer-/Fremd-GUIDs bewusst ignoriert. Idempotent: bereits gemergte
  // Siblings (z.B. im Adopt-Zweig von ensureDoc) werden nach Item-ID dedupliziert.
  async mergePendingForeign(notePath) {
    const yjsFiles = await this.vault.listYjsFiles(notePath);
    if (yjsFiles.length === 0) return;
    const siblings = await this.decodeSiblings(notePath, yjsFiles);
    this.mergeCompatible(notePath, siblings);
  }
  // Bringt eine lokale .md-Änderung in den CRDT.
  //
  // Task 12: Wirft dabei das LESEN einer Sidecar (transienter IO-Fehler), wird der
  // Lauf abgebrochen — ohne setContent, ohne saveState. Der Doc kennt den Fremd-
  // Stand dann nicht, und genau deshalb darf der .md-Diff nicht laufen: er würde
  // die unsichtbare Fremd-Op als eigene erfinden.
  //
  // Fix-Runde (Review F-2b): Der lokale Edit lebt danach NUR in der .md — es gibt
  // keinen Trigger, der ihn von selbst nachholt (loadAndMerge injiziert den
  // .md-Text im own-Branch bewusst nicht). Deshalb wird die Note als
  // `abortedReads` markiert; onRemoteYjsUpdate holt den Lauf vor einem Write-Back
  // nach und schreibt gar nicht, solange die Markierung steht. Das ist der
  // minimale Rückkanal, kein Re-Queue-Mechanismus.
  async applyLocalContent(notePath, content) {
    let finalText;
    try {
      finalText = await this.mergeForLocalDiff(notePath, content);
    } catch (err) {
      if (err instanceof SidecarReadError) {
        this.abortedReads.set(notePath, content);
        return void 0;
      }
      throw err;
    }
    this.crdtManager.setContent(notePath, finalText);
    await this.saveState(notePath);
    await this.cleanupLegacyFile(notePath);
    this.abortedReads.delete(notePath);
    this.localDiffBase.set(notePath, content);
    return finalText;
  }
  // Doc-Aufbau + Fremd-Merge + 3-Wege-Merge des lokalen .md-Texts. Getrennt von
  // applyLocalContent, damit ein SidecarReadError vor setContent/saveState greift.
  async mergeForLocalDiff(notePath, content) {
    const adopted = await this.ensureDoc(notePath);
    const docBeforeMerge = this.crdtManager.getContent(notePath);
    await this.mergePendingForeign(notePath);
    const mergedText = this.crdtManager.getContent(notePath);
    if (content === mergedText) return mergedText;
    const base = adopted ? void 0 : this.chooseLocalDiffBase(notePath, content, docBeforeMerge, mergedText);
    if (base === void 0) return this.unite(notePath, mergedText, content);
    return threeWayMerge(base, content, mergedText);
  }
  // Task 16, Runde 2 (Review F-1): Welcher Text ist der gemeinsame Vorfahr des
  // lokalen Diffs — der zuletzt gesehene .md-Stand oder der Doc-Stand?
  //
  // `localDiffBase` (zuletzt gesehene .md) ist richtig, solange `content` ein
  // Nutzer-Edit AUF diesem Stand ist. Dann ist der Vorlauf des Docs per
  // Konstruktion keine lokale Änderung — genau das behebt Fund 1.
  //
  // Sie ist FALSCH, sobald `content` den Vorlauf selbst schon trägt: der Datei-Sync
  // hat die GEMERGTE Fassung des Peers abgelegt (robocopy liefert .md und Sidecar
  // zusammen — der Task-11-Realfall). Dann enthält `patch_make(Basis, content)` die
  // Fremd-Einfügung, die `other` bereits hat, `patch_apply` dedupliziert nicht
  // (WARNUNG in text-merge.ts), und der Fremd-Edit steht danach zweimal in der Note.
  // Gemessen im Review: FREMD=2 gegen FREMD=1 vor Task 16 — der Fix hätte in dieser
  // Lage keinen Verlust verhindert, sondern nur eine Verdopplung addiert. Der
  // Kurzschluss `content === mergedText` fängt allein die exakte Gleichheit; sobald
  // der sync-gelieferten .md zusätzlich der lokale Edit fehlt, greift er nicht.
  //
  // Die Bedingung fragt deshalb genau das: trägt `content` Text, den der Doc uns
  // gegenüber VORAUS hat? Ja → die .md hat aufgeholt, der Doc-Stand ist die richtige
  // (und vor Task 16 einzige) Basis. Nein → der Vorlauf ist der .md unbekannt, die
  // zuletzt gesehene .md ist der Vorfahr.
  //
  // Verglichen wird gegen `mergedText`, NICHT gegen den erst hier durch
  // `mergePendingForeign` hinzugekommenen Text: im belegten Fall ist die
  // Fremd-Sidecar bereits beim vorigen Tastendruck eingemergt und
  // `mergePendingForeign` fügt nichts mehr hinzu. Der Vorlauf ist die Differenz zum
  // zuletzt gesehenen .md-Stand, nicht die zum Doc von vor diesem Aufruf.
  //
  // Ohne Eintrag (frischer Prozess, Note erstmals angefasst) bleibt es beim
  // Doc-Text — dort ist er der letzte von uns erfasste .md-Stand.
  chooseLocalDiffBase(notePath, content, docBeforeMerge, mergedText) {
    const lastSeen = this.localDiffBase.get(notePath);
    if (lastSeen === void 0) return docBeforeMerge;
    const lead = insertedTexts(lastSeen, mergedText);
    if (lead.length === 0) return lastSeen;
    return lead.some((l) => content.includes(l)) ? docBeforeMerge : lastSeen;
  }
  async loadAndMerge(notePath) {
    const yjsFiles = await this.vault.listYjsFiles(notePath);
    if (yjsFiles.length === 0) return null;
    try {
      if (!this.vault.getAbstractFileByPath(notePath) && !this.crdtManager.hasDoc(notePath) && !await sidecarExists(this.vault.adapter, this.stateFilePath(notePath)) && !await sidecarExists(this.vault.adapter, this.legacyFilePath(notePath))) {
        return null;
      }
      await this.ensureDoc(notePath);
      const siblings = await this.decodeSiblings(notePath, yjsFiles);
      const ownGuid = this.guids.get(notePath);
      const winner = this.pickWinnerGuid(siblings, ownGuid);
      if (winner !== void 0 && winner !== ownGuid) {
        await this.switchToGuid(notePath, winner, siblings);
      } else {
        this.mergeCompatible(notePath, siblings);
        this.reportDiscarded(notePath, siblings);
      }
    } catch (err) {
      if (err instanceof SidecarReadError) return null;
      throw err;
    }
    await this.saveState(notePath);
    await this.cleanupLegacyFile(notePath);
    return this.crdtManager.getContent(notePath);
  }
};

// obsidian-crdt-sync/tests/helpers/vault-mock.ts
var import_obsidian = __toESM(require_obsidian_stub());
function toArrayBuffer(data) {
  return data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
}
var isDot = (p) => p.split("/").some((s) => s.startsWith("."));
function makeVaultMock() {
  const files = /* @__PURE__ */ new Map();
  const textFiles = /* @__PURE__ */ new Map();
  const mtimes = /* @__PURE__ */ new Map();
  const mdMtimes = /* @__PURE__ */ new Map();
  const folders = /* @__PURE__ */ new Set();
  const writeCount = /* @__PURE__ */ new Map();
  let clock = 0;
  const tfile = (p) => {
    const f = new import_obsidian.TFile();
    f.path = p;
    f.name = p.split("/").pop() ?? p;
    f.stat = { mtime: mdMtimes.get(p) ?? 0, ctime: 0, size: (textFiles.get(p) ?? "").length };
    return f;
  };
  const folderExists = (dir) => folders.has(dir) || [...files.keys()].some((k) => k.startsWith(dir + "/")) || [...textFiles.keys()].some((k) => k.startsWith(dir + "/"));
  const listDir = (dir) => {
    const outFiles = [];
    const outFolders = /* @__PURE__ */ new Set();
    for (const key of files.keys()) {
      if (dirname(key) === dir) outFiles.push(key);
      else if (key.startsWith(dir + "/")) {
        const seg = key.slice(dir.length + 1).split("/")[0];
        outFolders.add(dir + "/" + seg);
      }
    }
    for (const f of folders) {
      if (dirname(f) === dir) outFolders.add(f);
    }
    return { files: outFiles, folders: [...outFolders] };
  };
  const adapter = {
    exists: async (p) => files.has(p) || textFiles.has(p) || folderExists(p),
    readBinary: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    writeBinary: async (p, data) => {
      files.set(p, toArrayBuffer(data));
      mtimes.set(p, ++clock);
      writeCount.set(p, (writeCount.get(p) ?? 0) + 1);
    },
    remove: async (p) => {
      files.delete(p);
      mtimes.delete(p);
    },
    mkdir: async (p) => {
      folders.add(p);
    },
    stat: async (p) => {
      if (files.has(p))
        return { type: "file", mtime: mtimes.get(p) ?? 0, ctime: 0, size: files.get(p).byteLength };
      if (folderExists(p)) return { type: "folder", mtime: 0, ctime: 0, size: 0 };
      return null;
    },
    list: async (dir) => listDir(dir),
    rename: async (from, to) => {
      if (!files.has(from)) return;
      files.set(to, files.get(from));
      files.delete(from);
      mtimes.set(to, mtimes.get(from) ?? ++clock);
      mtimes.delete(from);
    }
  };
  return {
    getAbstractFileByPath: (p) => {
      if (isDot(p)) return null;
      return textFiles.has(p) ? tfile(p) : null;
    },
    getFiles: () => [...textFiles.keys()].map(tfile),
    getMarkdownFiles: () => [...textFiles.keys()].filter((p) => p.endsWith(".md")).map(tfile),
    read: async (file) => textFiles.get(file.path) ?? "",
    process: async (file, fn) => {
      const cur = textFiles.get(file.path) ?? "";
      const next = fn(cur);
      if (next !== cur) {
        textFiles.set(file.path, next);
        mdMtimes.set(file.path, ++clock);
      }
      return next;
    },
    adapter,
    listYjsFiles: (notePath, cache) => listYjsInDir(adapter, notePath, cache),
    _files: files,
    _textFiles: textFiles,
    _mtimes: mtimes,
    _mdMtimes: mdMtimes,
    _folders: folders,
    _writeCount: writeCount
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CrdtManager,
  SyncHandler,
  decodeStateFile,
  encodeStateFile,
  generateGuid,
  insertedTexts,
  makeVaultMock,
  threeWayMerge,
  toArrayBuffer,
  unionMerge
});
