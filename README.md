# Qollab

You share an Obsidian vault with one or more other people. You edit the same note, and the next morning you find this:

```
Meeting notes (DESKTOP-A1B2C3's conflicted copy 2026-05-18).md
```

Now you diff two files by hand. **Qollab tries to merge them for you** using CRDTs: both texts *should* survive without that work. How far it actually gets is measured in the next section — it is not a guarantee.

**What it is aiming at** — stated separately from what it currently does, because the two are not the same:

- **Nobody has to do anything** for a shared note to end up correctly merged. No manual diffing, no rules to follow, no waiting for each other.
- **The conflict copy should never appear in the first place** — not "be resolved afterwards".
- **Nobody runs a server.** No backend, no account, no subscription. Qollab rides on infrastructure you already have.
- **Two or more people**, on any number of devices — not a two-device special case.
- **The transport is interchangeable**: a file sync (OneDrive, SharePoint, Dropbox, iCloud, Syncthing) or **Git/GitHub**. The per-device helper file names exist precisely so that Git never sees a conflict — each person only ever writes their own file.
- Yjs CRDTs are the *current* mechanism, not the goal. If they cannot carry it, the search continues.

Everything below describes what is **measured today**, which is a good deal less than that.

> [!WARNING]
> **Experimental. Do not trust it with data you cannot lose.**
> Keep your sync provider's conflict-copy protection **on**. The numbers below are measured, not estimated — read them before you install.

## What is clean and what is not

Most figures come from a deterministic simulation of two or more devices exchanging files in every possible delivery order. "Runs" are complete scenarios, not test cases. **One exception, marked where it occurs:** the three-and-four-device figures come from a driver that leaves the two random sources of the real code in place — the incarnation id and Yjs's per-document `clientID`. Repeating the same call gives a different number each time, so those figures are given as a mean over repeated runs with the range, never as a single value.

### Clean — measured

| | Result |
|---|---|
| Two devices, one contested note, text only added, **Obsidian open the whole time** | **98.6 % of runs fully clean** |
| Duplicated text | 1.4 % |
| Lost text | **0 %** |
| Silently lost text | **0 %** |
| Devices ending up with different content | **0 %** |

*n = 720 runs per cell. Without the merge logic the same scenario yields 66.4 % duplication, 23.1 % loss and 61.9 % divergence — that is what the plugin removes.*

*What these figures do **not** cover: **Obsidian stays open on both devices for the whole run.** Restarting was never part of this measurement, and it is not a detail — it is where the remaining loss lives. See the row about a closed Obsidian below, which is measured over the same 720 delivery orders.*

### Not clean — also measured

| Problem | Rate | Visible to you? |
|---|---|---|
| **A line you deleted comes back** | **47.4 %** of runs containing a deletion (4–26 % if the note has shared history, 53–83 % if not) | Yes, but possibly hours later |
| More devices or several contested notes at once | duplication rises to 9–16 % | Yes |
| ~~Three or more devices — loss of text nobody touched~~ **Fixed** | **0 in every measured cell** (2, 3 and 4 devices; 200 seeds × 3 random families × 16,000 baseline lines each). The cause was a character-level diff whose delete could swallow an untouched line and rewrite its middle as a *new* item — harmless once, but **not idempotent**: when several devices computed the same replacement, the inserts stacked and the line died (`base` → `basebase` → `basebasebase`), while all devices still agreed on the text. Fixed by aligning the operations to line boundaries. **Cost: duplication rises by 1.0–1.7 %.** Earlier figures for this row (6/22, 4.6/19.7, 2.0/8.0) were mostly artefacts of a harness that processed a synced-in `.md` as if you had typed it, which the plugin does not do. | — |
| A program **outside Obsidian** edits the file (script, other editor, `git checkout`) while Obsidian is open | text loss up to 19.4 % | Yes — the text stays in the note or in a copy Qollab writes before overwriting |
| **Obsidian was closed while your `.md` was overwritten** — your sync provider delivered the other device's version, a version was restored from history, or a read came back short | **8.3 %** of delivery orders (**24.4 %** of those in which the overwrite actually happened), down from 33.3 % — see below. Where it still happens, your unsynced edit is written into your own helper file **as a deletion** and travels to the other device. | **Only if your sync provider left a conflict copy.** Otherwise the text is gone without a word. |
| A `.yjs` helper file arrives **corrupted** (zero-filled at unchanged size — happens with cloud sync and interrupted writes) | caught by the checksum, file skipped and reported | Yes |
| Obsidian is closed while a note is in an undecided state | the pending state is lost, duplication rises from 5.3 % to 35.6 % | No |
| Obsidian Mobile | **not supported** — nothing here was measured there, and Obsidian will not load the plugin there either (see [Install](#install)) | Yes — the plugin does not appear on that device |

**Why closing Obsidian matters.** While Obsidian is running, Qollab can tell whether a `.md` was written by this process or dropped in by something else, and it sets a foreign one aside instead of booking it as your edit. That signal lives in memory and does not survive a restart.

The startup scan therefore asks a different question: **does one of the helper files on disk explain the text I am looking at?** Helper files outlive the process, so a `.md` that matches a foreign history did not come from you — and the scan takes that foreign text as the basis for its comparison instead of your own last state. What you actually changed offline is still recorded; what the file sync overwrote is not mistaken for your deletion.

That closes it wherever the evidence has arrived. **It does not close it everywhere:** the helper file travels separately from the note and in any order, so in roughly half of all delivery orders it is not there yet when the scan runs. In those cases the old behaviour remains — the scan reads the difference as a deletion *you* made, writes it into your own helper file, and your file sync carries that deletion to the other device. It is removed exactly where it last existed. **That is why the warning above still asks you to keep conflict-copy protection on.**

*Measured over 720 delivery orders, one device restarted: 240 runs lost text before, 60 after. The evidence is present in 360 of the 720 orders, which accounts for the remainder exactly. Skipping the startup scan removes the loss completely (0 of 720) but also discards every genuine offline edit, so that is not a fix. The devices still agree with each other in every run; "we both have the same text" is not the same as "nothing is missing".*

**The honest summary:** with Obsidian open on both devices, Qollab reliably prevents *loss* in the two-device case, and it removes conflict copies. Its helper files carry a checksum, so a corrupted one is caught and skipped instead of silently rewriting your text. An edit overwritten on disk while Obsidian was shut is now protected wherever the matching helper file has already arrived — in the other half of cases it is not. The one thing it still does **not** do: it does not reliably preserve *deletions*. If your workflow involves deleting a lot — cleaning up notes, removing finished tasks — expect deleted lines to reappear.

## Install

1. [Download the latest release](https://github.com/TillQuandel/obsidian-qollab/releases/latest) — `main.js` + `manifest.json`
2. Create the folder `.obsidian/plugins/qollab/` in your vault
3. Copy both files into it
4. Obsidian: Settings → Community Plugins → enable **Qollab**

Works with OneDrive, Dropbox, Google Drive, iCloud, Syncthing — any service that syncs files.

**Git and GitHub** are an intended transport too, and the helper file names were designed for it: each device writes only `<note>.md.<deviceId>.yjs`, so two people never touch the same file and Git never reports a conflict on them. Note the honest gap: the merge behaviour above was measured against file syncs, **not** against a commit-and-push workflow, and Qollab does not commit or push for you.

**Requires Obsidian 1.8.7 or newer.** Qollab stores its device ID in the vault-specific profile store, which only exists from that version on.

**Desktop only.** Qollab is marked desktop-only, so it does not load on Obsidian Mobile (iOS, Android). Mobile is still the goal, but it is not built, and the reason is not a missing checkbox. Obsidian's own view of the `.qollab/` folder lags behind the disk — in a desktop test a foreign helper file that had lain there from the start stayed invisible to that view for about 50 seconds — and a merge on a stale view treats an existing foreign edit as absent, re-invents it from the note text as *your* edit, and duplicates the text for good. Qollab avoids this by reading its helper files straight from the file system, and the call it needs for that (`getBasePath`) exists only on the desktop adapter. On mobile the code falls back to precisely the lagging view. The fallback is deliberate, so it would not crash — it would quietly stop protecting you, and none of the numbers above were measured there. Shipping that as "mobile support" would be a promise this plugin does not keep.

**If you have it on a phone today, this version stops running there.** Obsidian does not load plugins marked desktop-only, so after the update Qollab is simply inactive on that device; its files stay under `.obsidian/plugins/qollab/` until you remove them. Nothing else changes — your notes and the `.qollab/` helper files are untouched, and your desktop devices go on using them. Losing it on the phone is the correct outcome: it was not protecting anything there.

**Update all your devices together.** The helper file format changed in this version, and a device still on v0.4.0 cannot read the new one. It does not simply ignore those files: at first it treats them as damaged and starts a competing history of its own, and on a later run it **deletes them without a word** — after which your file sync carries that deletion to every other device. A half-updated vault therefore loses helper files, and with them the edit history behind the affected notes. The notes themselves stay; the merging does not. So update every device before you edit again, or stay on the old version everywhere until you can.

**Device ID, sync toggle and deletion markers live outside the vault.** Each installation gets its own random device ID on first start (visible in the plugin settings). It lives in that device's Obsidian profile, not in the synced `data.json`. Up to v0.4.0 the ID lived in `data.json`: if that file got synced, both devices used the same ID, wrote the same helper file, and the automatic merge **never** happened.

The cost: a reset profile (reinstall, new machine, cleared `localStorage`) loses the toggle state and all deletion markers of that device, and Qollab starts with sync **enabled** again. **Check the toggle after every reinstall.**

**Sync only part of `.obsidian/`.** Exclude these — most providers can exclude subfolders selectively:

| File | Why |
|---|---|
| `workspace*.json` | window layout and open notes, rewritten constantly, device-specific |
| `vault-stats.json` | written continuously while typing |
| `graph.json`, `appearance.json`, `hotkeys.json` | personal view and input preferences |

## What happens under the hood

Qollab keeps a small helper file under `.qollab/<vault-path>/<note>.md.<deviceId>.yjs`. It holds the edit history as a Yjs CRDT. When a note changes, Qollab records the change there; when a foreign helper file arrives, it merges both histories and writes the result back into the note.

**A note gets its helper file only once it is edited** — or once another device's helper file for it arrives. An untouched note deliberately gets none: creating one blindly on every device would give the same note a separate history per device, and one of them would have to be abandoned on first contact. What that means for you: **until a note has been edited in Obsidian once, Qollab does not protect it.** Edit it on two devices inside that window and you get your sync provider's conflict copy, exactly as before.

Files arrive in **any order** over a file sync — the note may show up long before its history, or the other way round. Qollab handles that by *parking* a foreign file it cannot yet attribute, and merging it once the matching history arrives.

**Qollab scans every 30 seconds, not the moment a file lands.** A foreign helper file is picked up on the next scan — up to half a minute later. Opening a note triggers a scan for that note right away; nothing else does. So don't sit in front of an open note waiting for something to happen, and above all don't retype the missing text yourself: an edit made inside that 30-second window falls under the merge limits below.

## Limits in detail

**Deleted lines returning.** Merging two texts without a common ancestor is done by union: everything from both sides is kept. Union cannot remove anything, which is exactly why nothing is ever lost — and exactly why a deletion can be undone. Partly this is even correct CRDT behaviour (a concurrent add wins over a remove), but Qollab currently cannot tell a concurrent edit from one that already saw the deletion.

**First contact between two devices.** If the same note exists independently on both devices before they ever saw each other, there is no shared ancestor. Both versions are then merged line by line, which can duplicate paragraphs and reorder content. Qollab reports this explicitly rather than doing it silently:

> Qollab: "Shopping list" was edited separately on two devices. Both versions are now in the note — please review, paragraphs may appear twice.

The reverse case is reported too: on one of the two devices Qollab keeps its own version and does **not** adopt the other. Which device that is comes down to an internal identifier comparison — effectively chance. Look at the *other* device for the text that is missing here.

**Helper files carry a checksum.** The Yjs update format itself has neither checksum nor length field, so Qollab writes its own: four bytes covering the rest of the file. A helper file that was zero-filled at unchanged size — the cloud-sync and interrupted-write case — used to pass every check and rewrite your text without a word. It no longer does: it is reported and skipped, and it is **never deleted**, because the same file may still be intact on the other device. If it is *this* device's own file, the run stops rather than write over it. Measured: 367 of 367 partially zero-filled files caught, 0 false alarms.

The price, and it is a real one: a **truncated** helper file from another device now yields nothing at all instead of a partial state — the checksum rejects it before its contents are looked at. That is unavoidable. At the level of contents a truncation and a zero-filling are the same thing, which is the entire reason the checksum sits in front of them. Nothing is lost either way: the file stays where it is, you are told about it, and the original is still on the other device. Helper files written by older versions carry no checksum and are read exactly as before.

**A deleted note coming back — fixed, with two exceptions.** Delete a note and create a new one under the same name, and a late-arriving old helper file no longer resurrects the old text: deleting marks that incarnation locally, and stale helper files carrying that marker are ignored and cleaned up. The first exception: if Qollab was **switched off** on this device at the moment of the deletion, no marker is set — off means *change nothing*, otherwise a disabled plugin would bury a note that your sync provider had merely renamed. The second: if the **device profile is lost** (reinstall, new machine), every existing marker goes with it, and putting them anywhere else would mean writing them into the synced `data.json` — the mistake described above. In both cases a helper file arriving later can bring the old text back into a same-named new note.

**Deletion markers are device-local.** A device that was offline during delete-and-recreate keeps its old history and no longer participates in the new incarnation's merge. Two guards prevent an empty returning state from wiping a note. Full deletion as a CRDT operation is still planned, but **not** in 0.5.0 — that version number went to the helper file format change instead.

**Concurrent edits to the same line.** Both texts survive, but the resulting order can be surprising.

**Editing during an ongoing merge.** A three-way text merge protects local edits, but it is not conflict-proof: directly overlapping changes resolve in favour of the local version, and a very small window exists around the write-back in which an edit can be overwritten.

**Moving helper files by hand.** The filename is the only link between a helper file and its note — `Shopping list.md` is tracked by `.qollab/Shopping list.md.5e307e01.yjs`, where `5e307e01` is the device ID; the note's name appears nowhere inside the file. Move or rename one, and its text ends up in a different note. Don't reorganise `.qollab/` manually.

**Someone else wrote this device's helper file.** If this device's own helper file is overwritten by anything other than Qollab, Qollab gives the device a new device ID and says so once. The old file stays where it is and is merged from then on like any other foreign file of the same note. There are two possible causes, and **the notice cannot say which one it is**: either two devices carry the same device ID (only possible if both inherited the same old `data.json` and migrated it at the same time), or a backup of the `.qollab` folder was restored while the app was running. Telling them apart would mean holding the file's contents against this device's working state, and for a note not touched in this session there is none. Stepping aside is right either way, and both cases cost the same: one extra helper file that is never cleaned up. Detection usually happens within one scan (30 s), but the foreign state has to *survive* that scan — if this device writes first, it overwrites the trace and the case only surfaces next time.

## Known architectural limit

Qollab writes one helper file per note **and per device**. The count is the product of both, and every edit rewrites the affected file completely. Measured for 10,000 notes and 5 devices: 50,000 helper files, 206 MB in the sync tree, growing without bound. For small vaults (<100 notes) this is negligible; for large vaults the honest advice is: don't enable it, and that advice has no expiry date.

Work is ongoing on a different file format — **no date and no promise**: append-only segments per device, stored flat ([Issue #12](https://github.com/TillQuandel/obsidian-qollab/issues/12)). Measured at 42 MB and ~8,400 files instead of 206 MB and 50,000 — **none of it is built**, and the same measurement lists five conditions without which the format does not hold. It is a scaling decision, not a correctness one: it does not solve the first-contact problem above. Expect this limit to stay.

A previous plan (Yjs subdocuments + a shared single store, Issue #9) is withdrawn and closed as *not planned*: subdocuments do not reduce the file count, and a shared store forks the entire vault on a single conflict.

## For developers

```powershell
npm install
node esbuild.config.mjs production   # → main.js
npx jest                             # tests
```

Every figure in this README comes from the measurement harness — a multi-device simulator plus the corruption spikes. Most of it is deterministic: `spike/guid-quelle.ts` and `spike/zufall-quelle.ts` pin the incarnation ids and Yjs's `clientID`, so a run repeats exactly. The three-and-four-device driver (`spike/schnitt/bilanz-n.mjs`) does **not** use them and therefore varies from run to run; its figures are means over repeated runs, with the range. The harness is **not part of this branch**: it lives under `obsidian-crdt-sync/spike/` on the `mess/*` branches, together with the runs the numbers were read off. Checking a figure means checking out one of those.

## License

MIT — see [LICENSE](LICENSE).
