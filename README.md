# Qollab

Du kennst das: Du und eine Kollegin arbeitet im selben Obsidian-Vault über OneDrive.
Ihr bearbeitet gleichzeitig dieselbe Note — und am nächsten Morgen findet ihr das:

```
Meetingprotokoll (Marias conflicted copy 2026-05-18).md
```

Jetzt müsst ihr manuell schauen was die andere geschrieben hat und die Änderungen zusammenführen.

**Qollab versucht das automatisch zusammenzuführen.** Beide Texte sollen erhalten bleiben — ohne dass ihr Konflikt-Kopien von Hand mergen müsst.

> [!WARNING]
> **Experimentell — noch nicht für wichtige Daten.** Der frühere Verdopplungs-Fehler beim ersten Merge ist behoben (positionsgenaue Diff-Updates + Basis-Adoption). Bis zum finalen Review vor dem ersten Release bleibt Qollab dennoch experimentell: Lasst die Konflikt-Kopie-Sicherung eures Sync-Dienstes vorerst **aktiv** und verlasst euch nicht allein auf Qollab. Details unter [Grenzen](#grenzen).

## Installation

1. [Letzten Release herunterladen](https://github.com/TillQuandel/obsidian-qollab/releases/latest) — `main.js` + `manifest.json`
2. Ordner `.obsidian/plugins/qollab/` in deinem Vault anlegen
3. Beide Dateien hineinkopieren
4. Obsidian: Einstellungen → Community Plugins → **Qollab** aktivieren

Funktioniert mit OneDrive, Dropbox, Google Drive, iCloud, Syncthing — und jedem anderen Dienst der Dateien synchronisiert.

**Voraussetzung: Obsidian 1.8.7 oder neuer.** Qollab legt seine Geräte-ID im vault-spezifischen Profilspeicher ab, den Obsidian erst ab dieser Version bereitstellt.

**Die Geräte-ID liegt nicht im Vault.** Jede Installation bekommt beim ersten Start eine eigene, zufällige Geräte-ID (sichtbar in den Plugin-Einstellungen). Sie steht im Obsidian-Profil des jeweiligen Geräts, nicht in der mitsynchronisierten `data.json` — ihr könnt den Vault-Ordner also komplett synchronisieren, `.obsidian/` eingeschlossen. Bis v0.4.0 stand sie in `.obsidian/plugins/qollab/data.json`: wurde die mitsynchronisiert, trugen beide Geräte dieselbe ID, schrieben dieselbe Hilfsdatei und der automatische Merge fand **nie** statt. Beim ersten Start nach dem Update wandert eine vorhandene ID automatisch ins Geräteprofil und wird aus `data.json` entfernt.

## Mit GitHub teilen

Wenn ihr euren Vault über ein privates GitHub-Repository teilt (z.B. mit dem [Obsidian-Git-Plugin](https://github.com/denolehov/obsidian-git)):

1. Fügt eine `.gitattributes`-Datei im Vault-Root hinzu:
   ```
   *.yjs binary
   ```
2. Stellt sicher dass `*.yjs` **nicht** in `.gitignore` steht.
3. Fertig — Qollab erkennt automatisch welche Änderungen von wem kommen.

**Warum funktioniert das?** Jedes Gerät schreibt eine eigene `.yjs`-Datei (z.B. `note.md.a1b2c3d4.yjs`). Git merged diese Dateien nie — jeder schreibt nur seine eigene. Wenn ihr zieht (`git pull`), erkennt Qollab die neue Datei und führt die Änderungen automatisch zusammen.

## Was passiert im Hintergrund?

Qollab legt zu einer Note eine kleine Hilfsdatei an (`note.md.yjs`), **sobald die Note zum ersten Mal bearbeitet wird** — oder sobald die Hilfsdatei eines anderen Geräts für sie ankommt (die wird dann übernommen).
Diese Datei enthält die Änderungshistorie der Note auf eine Art, die automatisch zusammengeführt werden kann — egal in welcher Reihenfolge die Änderungen ankommen.

**Unveränderte Notes bekommen bewusst keine Hilfsdatei.** Grund: Wer sie blind für jede Note anlegt, gibt derselben Note auf jedem Gerät eine eigene Historie — beim Rollout auf zwei Geräten entstehen dann zwei konkurrierende Historien für dieselbe Datei, von denen eine beim ersten Kontakt aufgegeben werden muss. So entsteht die Historie genau einmal: auf dem Gerät, das zuerst editiert; alle anderen Geräte übernehmen sie. Praktische Folge: Bis zum ersten Edit in Obsidian schützt Qollab eine Note nicht — bearbeiten in dieser Zeit zwei Geräte dieselbe Note, greift wie gehabt die Konfliktkopie-Sicherung eures Sync-Dienstes.

Wenn deine Sync-Lösung die `.yjs`-Datei deiner Kollegin synchronisiert, erkennt Qollab das sofort und aktualisiert die Note. Du siehst eine kurze Meldung oben rechts.

Die `.yjs`-Dateien siehst du im Vault-Explorer nicht — Obsidian blendet sie aus.

## Für IT-Abteilungen

- Keine externen Server, keine Cloud-Dienste
- Alle Daten bleiben auf eurer Sync-Infrastruktur (SharePoint, OneDrive, ...)
- Kein Netzwerk-Traffic außer dem normalen Dateisync
- Open Source, vollständig auditierbar

## Grenzen

**Inhalts-Verdopplung beim ersten Merge — behoben.** Qollab setzt Änderungen jetzt über positionsgenaue Diffs (unveränderte Zeichen behalten ihre Identität) und baut den Merge-Zustand aus dem persistierten State auf statt aus dem Volltext. Zwei Geräte, die unabhängig vom selben Ausgangsstand starten, verdoppeln den Inhalt dadurch nicht mehr.

**Simultan-Erstkontakt — gelöst.** Wenn zwei Geräte dieselbe Note unabhängig anlegen, *bevor* sie die Hilfsdatei des anderen sehen, bekam früher jede Seite eine eigene Historie und der Sync spaltete sich dauerhaft. Jede Note-Inkarnation trägt jetzt eine Doc-GUID; beim Erstkontakt gewinnt deterministisch die (bytewise) kleinere GUID, das unterlegene Gerät wechselt auf dieselbe Basis. Beide Seiten konvergieren ohne Konflikt-Kopie. Wichtig: Bei *identischem* Text konvergieren beide Seiten verlustfrei; bei *divergentem* Text werden beim Wechsel **beide Stände vereinigt** (zeilenweise, Gewinner-Beitrag zuerst) — vorher setzte sich der Volltext einer Seite durch und die Abweichungen der anderen gingen verloren. Drei Konsequenzen der fehlenden gemeinsamen Wurzel: Die Reihenfolge kann überraschen (kein echter 3-Wege-Merge möglich); eine Zeile, die nur eine Seite gelöscht hat, kommt beim Wechsel zurück; und hat eine Seite Zeilen **umsortiert**, steht die verschobene Zeile danach zweimal da (ein Verschieben ist ohne Vergleichsbasis nicht von „gelöscht und woanders eingefügt" zu unterscheiden). Bewusst so gewählt: sichtbares Zuviel statt stillem Verlust. Die Änderungshistorie *einzelner Zeichen* der aufgegebenen Inkarnation geht dabei verloren; ihr Text zählt danach als frische Eingabe dieses Geräts.

**Zombie-Resurrection — behoben.** Eine gelöschte und gleichnamig neu angelegte Note wird nicht mehr durch eine verspätet ankommende alte Hilfsdatei „wiederbelebt": Beim Löschen wird die GUID der alten Inkarnation lokal getombstoned; stale Hilfsdateien dieser GUID werden erkannt, ignoriert und aufgeräumt. v0.1-Legacy-Dateien (kein QLB1-Header, keine GUID) werden ausschließlich für den einmaligen Erst-Import akzeptiert; sobald GUID-tragender State existiert, werden sie ignoriert und gelöscht.

Wenn zwei Personen **gleichzeitig dieselbe Zeile** ändern, entscheidet Qollab automatisch welche Version vorne steht — beide Texte bleiben erhalten, aber die Reihenfolge kann überraschend sein.

**Erstkontakt bei ungeordnetem Datei-Sync.** Trackt ein Gerät eine Note zum ersten Mal und kommt die fremde Hilfsdatei *vor* der neueren `.md` an, wird der lokale Dateistand mit dem übernommenen Fremd-Stand vereinigt statt darüber gelegt. Das frühere kurzzeitige Zurückspringen einer frischen Remote-Änderung entfällt damit; im Gegenzug kann eine remote gelöschte Zeile, die der lokale Dateistand noch führt, wieder auftauchen (siehe oben). Kommt die Hilfsdatei ganz **ohne** zugehörige `.md` an (Note gibt es hier noch nicht), rührt Qollab sie nicht an: keine eigene Historie, keine eigene Hilfsdatei — sie wird erst verwendet, wenn die `.md` nachsynct.

**Gerätelokale Tombstones (bewusste Grenze).** Die Lösch-Markierungen liegen nur auf dem Gerät, das die Löschung durchführt. Ein anderes Gerät, das während Löschung + Neuanlage geschlossen/offline war, kann mit seiner alten Historie weiterlaufen und nimmt am CRDT-Merge der neuen Inkarnation nicht mehr teil (sein Tie-Break bevorzugt womöglich die alte GUID). Durch zwei Schutz-Guards kann ein zurückkehrender leerer State die Note nicht mehr leeren: Qollab startet keinen Merge ohne existierende `.md` (Guard 1), und ein historienloser Frisch-Doc ohne Ops überschreibt keine vorhandene `.md` (Guard 2). Bei Delete-vs-Offline-Edit überlebt der Inhalt über den normalen Datei-Sync; die CRDT-Historie der Offline-Edits geht dabei verloren (die Note startet mit frischer Historie). Die vollständige Lösung — Löschen als CRDT-Operation mit Add-wins-Semantik — ist für v0.5 geplant.

**Tombstone-Reichweite: pro Pfad und Inkarnation.** Eine Lösch-Markierung gilt für genau ein Paar aus Note-Pfad und Inkarnation, nicht mehr für die Inkarnation unter allen Pfaden. Das ist wichtig, weil Datei-Sync-Dienste eine Umbenennung häufig als Löschen-plus-Neuanlegen zustellen: Früher entwertete so ein sync-vermittelter Rename die Historie der Note, obwohl niemand sie gelöscht hatte — die Hilfsdateien unter dem neuen Namen galten als Leichen und wurden weggeräumt. Jetzt bleibt dieselbe Inkarnation unter einem anderen Pfad unberührt, und die eigene Hilfsdatei wird über diesen Weg grundsätzlich nicht mehr gelöscht. Der Zombie-Schutz oben ist davon unberührt: er greift beim gleichnamigen Neuanlegen, also unter demselben Pfad. Beim Update auf diese Version werden bestehende Lösch-Markierungen des alten Formats verworfen (ihr Pfad ist nachträglich nicht rekonstruierbar) — im schlechtesten Fall wird eine alte Hilfsdatei einmalig mitgemergt.

**Grenzen des Editier-Schutzes während eines Merges.** Der Write-Back-Guard schützt lokale Edits, die während eines laufenden Remote-Merges getippt werden, über einen 3-Wege-Text-Merge. Der ist nicht konfliktfest:

- Bei direkt überlappenden Änderungen setzt sich die lokale Version durch — die Remote-Änderung dieser Stelle geht verloren.
- Verschiebt die Remote-Änderung den Kontext um viele hundert Zeichen (z. B. großer eingefügter Absatz weiter oben), kann der lokale Edit still verloren gehen.
- Bei Löschung ganzer Absätze remote können einzelne Textreste verschmelzen.

Zusätzlich existiert ein sehr kleines Zeitfenster (Millisekunden um den Write-Back), in dem ein Edit sein modify-Event verliert und beim nächsten Remote-Merge überschrieben werden kann. Für diese Randfälle gilt die Empfehlung in der WARNING oben: Lasst die Konflikt-Kopie-Sicherung eures Sync-Dienstes aktiv.

**Veralteter Stand beim Nachhol-Versuch nach einem Lesefehler.** Ist eine Hilfsdatei kurzzeitig nicht lesbar (Sync-Tool hält gerade ein Handle), bricht Qollab den laufenden Schritt ab und merkt sich den Text, der dabei nicht erfasst wurde; beim nächsten Durchlauf wird genau dieser Text nachgespielt. Wird die Note im Sub-Sekunden-Fenster zwischen Abbruch und Nachhol-Versuch extern editiert, ohne dass dazwischen ein modify-Event verarbeitet wurde, spielt der Nachhol-Versuch den älteren Stand ein. In allen anderen Reihenfolgen fängt der reguläre modify-/Merge-Fenster-Pfad den Edit ab.

**Doppel-Kollision im selben Verarbeitungsschritt.** Enthält eine `.md`-Änderung in *einem* Schritt sowohl einen noch ungemergten Fremd-Edit (aus der Hilfsdatei) als auch einen lokalen Edit, kann der Fremd-Edit verdoppelt werden. Erreichbar über Read-Coalescing im Poll-Fenster (mehrere Änderungen fallen in denselben Lesevorgang) oder über den Restart-Sweep beim App-Start. Das Fenster ist eng und es gibt **keine Verlustrichtung** — nur eine mögliche Verdopplung, kein Datenverlust. Dieselbe Wurzel hat ein Ankunftsreihenfolge-Fenster: Bringt der Datei-Sync die `.md` *vor* der zugehörigen Fremd-Hilfsdatei auf die Disk und verarbeitet der modify-Handler die `.md`, bevor die Hilfsdatei geschrieben ist, findet der Vor-Merge-Schritt nichts einzumergen — der Diff erfindet die Fremd-Edits weiterhin als lokale Ops, und der spätere Hilfsdatei-Merge verdoppelt sie. Beide Restfälle sind ohne Op-Provenienz (Herkunftsverfolgung einzelner Einfügungen) nicht auf Datei-Ebene von einem echten lokalen Edit zu unterscheiden; ein sauberer Fix, der Fremd- von Lokal-Edits im selben Text trennt, ist Kandidat für v0.5.

**Geräte-ID-Kollision — erkannt und automatisch geheilt.** Haben zwei Geräte dieselbe Geräte-ID (nur noch möglich, wenn beide dieselbe alte `data.json` geerbt haben und sie beim Update gleichzeitig migrieren), schreiben sie dieselbe Hilfsdatei. Qollab merkt beim Scan, dass die eigene Hilfsdatei von fremder Hand verändert wurde, vergibt dem Gerät eine neue ID und meldet diese Kollision einmal. Die alte Datei bleibt liegen — sie gehört ab dann dem anderen Gerät und wird als normale Fremd-Datei derselben Note-Inkarnation gemergt. Grenzen davon: Erkannt wird in der Regel innerhalb eines Scan-Intervalls (30 s) — der fremde Stand muss den Scan aber *überleben*; schreibt das eigene Gerät vorher selbst (lokaler Edit, Merge, Start-Sweep), überschreibt es die Spur, und die Kollision fällt erst beim nächsten Mal auf. Und die Historie, die sich beide Geräte bis zur Erkennung gegenseitig überschrieben haben, lässt sich nicht rekonstruieren — dort gewinnt der zuletzt geschriebene Stand.

**Verlorenes Obsidian-Profil = neue Geräte-ID.** Wird das Profil zurückgesetzt (Neuinstallation, neuer Rechner, aufgeräumter `localStorage`), bekommt das Gerät eine frische ID. Der Inhalt ist nicht in Gefahr: die eigene Alt-Datei zählt danach als Fremd-Datei derselben Note-Inkarnation und wird ganz normal eingemergt. Sie bleibt allerdings als verwaiste Hilfsdatei liegen.

Echtzeit-Cursor-Sync (wie in Google Docs) ist angedacht, aber mit der server-losen File-Sync-Architektur nicht ohne Weiteres umsetzbar — kein fester Termin.

## Bekannte Architektur-Schwäche

Qollab legt aktuell pro Note eine eigene `.yjs`-Sidecar-Datei unter `.qollab/<vault-path>/<note>.md.<clientId>.yjs` an — das Vault-Tree wird unter `.qollab/` gespiegelt. Bei großen Vaults (1000+ Notes) entstehen entsprechend viele Dateien, was OneDrive/Dropbox unnötig belastet (jede Sidecar ist eine eigene Konflikt-Achse) und gegen die [Yjs-Empfehlung](https://docs.yjs.dev/api/faq) zu „hunderten gleichzeitig geladenen YDocs" verstößt.

Für kleine Vaults (<100 Notes) ist das vernachlässigbar. Für große Vaults aktuell besser deaktivieren bis [Issue #9](https://github.com/TillQuandel/obsidian-qollab/issues/9) (geplanter späterer Refactor auf Subdocuments + SQLite-Single-Store) umgesetzt ist.

## Für Entwickler

```powershell
npm install
node esbuild.config.mjs production   # → main.js
npx jest                              # Tests
```
