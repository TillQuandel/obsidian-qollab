# Qollab

You share an Obsidian vault with someone over OneDrive. You both edit the same note, and the next morning you find this:

```
Meeting notes (DESKTOP-A1B2C3's conflicted copy 2026-05-18).md
```

Now you diff two files by hand. **Qollab merges them automatically** using CRDTs, so both texts survive without manual work.

> [!WARNING]
> **Experimental. Do not trust it with data you cannot lose.**
> Keep your sync provider's conflict-copy protection **on**. The numbers below are measured, not estimated — read them before you install.

## What is clean and what is not

All figures come from a deterministic simulation of two or more devices exchanging files in every possible delivery order. „Runs" are complete scenarios, not test cases.

### Clean — measured

| | Result |
|---|---|
| Two devices, one contested note, text only added | **98.6 % of runs fully clean** |
| Duplicated text | 1.4 % |
| Lost text | **0 %** |
| Silently lost text | **0 %** |
| Devices ending up with different content | **0 %** |

*n = 720 runs per cell. Without the merge logic the same scenario yields 66.4 % duplication, 23.1 % loss and 61.9 % divergence — that is what the plugin removes.*

### Not clean — also measured

| Problem | Rate | Visible to you? |
|---|---|---|
| **A line you deleted comes back** | **47.4 %** of runs containing a deletion (4–26 % if the note has shared history, 53–83 % if not) | Yes, but possibly hours later |
| More devices or several contested notes at once | duplication rises to 9–16 % | Yes |
| A program **outside Obsidian** edits the file (script, other editor, `git checkout`) | text loss up to 19.4 % | Yes — the text stays in a conflict copy, never silently gone |
| A `.yjs` helper file arrives **corrupted** (zero-filled at unchanged size — happens with cloud sync and interrupted writes) | base text destroyed, **silently** | **No** |
| Obsidian is closed while a note is in an undecided state | the pending state is lost, duplication rises | No |
| Obsidian Mobile | the provenance detection largely does not work there | No |

**The honest summary:** Qollab reliably prevents *loss* in the two-device case, and it removes conflict copies. It does **not** yet reliably preserve *deletions*, and it has **no integrity check** on its own helper files. If your workflow involves deleting a lot — cleaning up notes, removing finished tasks — expect deleted lines to reappear.

## Install

1. [Download the latest release](https://github.com/TillQuandel/obsidian-qollab/releases/latest) — `main.js` + `manifest.json`
2. Create the folder `.obsidian/plugins/qollab/` in your vault
3. Copy both files into it
4. Obsidian: Settings → Community Plugins → enable **Qollab**

Works with OneDrive, Dropbox, Google Drive, iCloud, Syncthing — any service that syncs files.

**Requires Obsidian 1.8.7 or newer.** Qollab stores its device ID in the vault-specific profile store, which only exists from that version on.

**Device ID, sync toggle and deletion markers live outside the vault.** Each installation gets its own random device ID on first start (visible in the plugin settings). It lives in that device's Obsidian profile, not in the synced `data.json`. Up to v0.4.0 the ID lived in `data.json`: if that file got synced, both devices used the same ID, wrote the same helper file, and the automatic merge **never** happened.

The cost: a reset profile (reinstall, new machine, cleared `localStorage`) loses the toggle state and all deletion markers of that device, and Qollab starts with sync **enabled** again. **Check the toggle after every reinstall.**

**Sync only part of `.obsidian/`.** Exclude these — most providers can exclude subfolders selectively:

| File | Why |
|---|---|
| `workspace*.json` | window layout and open notes, rewritten constantly, device-specific |
| `vault-stats.json` | written continuously while typing |
| `graph.json`, `appearance.json`, `hotkeys.json` | personal view and input preferences |

## What happens under the hood

For every note, Qollab keeps a small helper file under `.qollab/<vault-path>/<note>.md.<deviceId>.yjs`. It holds the edit history as a Yjs CRDT. When a note changes, Qollab records the change there; when a foreign helper file arrives, it merges both histories and writes the result back into the note.

Files arrive in **any order** over a file sync — the note may show up long before its history, or the other way round. Qollab handles that by *parking* a foreign file it cannot yet attribute, and merging it once the matching history arrives.

## Limits in detail

**Deleted lines returning.** Merging two texts without a common ancestor is done by union: everything from both sides is kept. Union cannot remove anything, which is exactly why nothing is ever lost — and exactly why a deletion can be undone. Partly this is even correct CRDT behaviour (a concurrent add wins over a remove), but Qollab currently cannot tell a concurrent edit from one that already saw the deletion.

**First contact between two devices.** If the same note exists independently on both devices before they ever saw each other, there is no shared ancestor. Both versions are then merged line by line, which can duplicate paragraphs and reorder content. Qollab reports this explicitly rather than doing it silently:

> Qollab: "Shopping list" was edited separately on two devices. Both versions are now in the note — please review, paragraphs may appear twice.

The reverse case is reported too: on one of the two devices Qollab keeps its own version and does **not** adopt the other. Which device that is comes down to an internal identifier comparison — effectively chance. Look at the *other* device for the text that is missing here.

**No integrity check on helper files.** The Yjs update format carries neither checksum nor length field. A truncated file is caught reliably, but a file that was zero-filled at unchanged size passes every check and destroys the base text without any error. This is not yet fixed.

**Deletion markers are device-local.** A device that was offline during delete-and-recreate keeps its old history and no longer participates in the new incarnation's merge. Two guards prevent an empty returning state from wiping a note. Full deletion as a CRDT operation is planned for v0.5.

**Concurrent edits to the same line.** Both texts survive, but the resulting order can be surprising.

**Editing during an ongoing merge.** A three-way text merge protects local edits, but it is not conflict-proof: directly overlapping changes resolve in favour of the local version, and a very small window exists around the write-back in which an edit can be overwritten.

**Moving helper files by hand.** The filename is the only link between a helper file and its note. Move or rename one, and its text ends up in a different note. Don't reorganise `.qollab/` manually.

## Known architectural limit

Qollab writes one helper file per note **and per device**. The count is the product of both, and every edit rewrites the affected file completely. Measured for 10,000 notes and 5 devices: 50,000 helper files, 206 MB in the sync tree, growing without bound. For small vaults (<100 notes) this is negligible; for large vaults the honest advice is: don't enable it.

Work is ongoing on a different file format — append-only segments per device, stored flat ([Issue #12](https://github.com/TillQuandel/obsidian-qollab/issues/12)). Measured at 42 MB and ~8,400 files instead of 206 MB and 50,000 — **none of it is built**, and the same measurement lists five conditions without which the format does not hold. It is a scaling decision, not a correctness one: it does not solve the first-contact problem above.

A previous plan (Yjs subdocuments + a shared single store, Issue #9) is withdrawn and closed as *not planned*: subdocuments do not reduce the file count, and a shared store forks the entire vault on a single conflict.

## For developers

```powershell
npm install
node esbuild.config.mjs production   # → main.js
npx jest                             # tests
```

The measurement harness lives in `obsidian-crdt-sync/spike/` and runs against a deterministic multi-device simulator. Every figure in this README comes from it.

## License

MIT — see [LICENSE](LICENSE).
