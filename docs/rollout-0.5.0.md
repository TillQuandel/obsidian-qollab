# Rollout 0.5.0 — Anleitung

**Diese Version bricht mit v0.4.0.** Sie darf nicht gerätweise ausgerollt werden. Lies den
Abschnitt „Warum alle zusammen" einmal ganz, bevor du anfängst — der Fehler ist nicht rückgängig
zu machen.

## Warum alle zusammen

Das Format der Hilfsdateien (`.qollab/*.yjs`) hat sich geändert: `QLB2` statt `QLB1`.

Ein Gerät, das noch auf **v0.4.0** läuft, kann eine `QLB2`-Datei nicht lesen. Es ignoriert sie
nicht — es hält sie für beschädigt, prägt eine eigene Inkarnation, und **löscht sie bei einem
späteren Lauf ohne jede Meldung**. Dein Datei-Sync trägt diese Löschung dann auf alle anderen
Geräte.

Ergebnis eines halb aktualisierten Vaults: Die Hilfsdateien sind weg, und mit ihnen die
Änderungshistorie der betroffenen Notizen. **Die Notizen selbst bleiben** — das Zusammenführen
funktioniert danach aber nicht mehr, bis jede Notiz erneut bearbeitet wurde.

Diese Richtung ist **nicht reparabel**: Das Verhalten steckt im bereits ausgelieferten
v0.4.0-Code, nicht im neuen.

**Wenn du nicht alle Geräte gleichzeitig erreichst: fang gar nicht erst an.** Bleib überall auf
0.4.0, bis es möglich ist. Ein halber Rollout ist schlechter als kein Rollout.

## Vorher

1. **Zähl deine Geräte.** Jedes Gerät, auf dem Qollab in diesem Vault installiert ist — auch
   selten benutzte. Ein vergessenes Gerät, das drei Wochen später einmal startet, richtet denselben
   Schaden an.
2. **Erreich alle Mitnutzenden.** Der Rollout ist erst fertig, wenn auch ihre Geräte aktualisiert
   sind.
3. **Sicherung anlegen.** Kopiere den ganzen Vault, **einschließlich des Ordners `.qollab/`**, an
   einen Ort außerhalb des Syncs. Das ist der einzige Rückweg — ein Downgrade auf 0.4.0 ist keiner,
   weil die neue Version bis dahin schon `QLB2`-Dateien geschrieben hat.

## Der Ablauf

**Reihenfolge einhalten.** Der entscheidende Punkt ist, dass zwischen dem ersten und dem letzten
aktualisierten Gerät **kein Obsidian läuft**.

1. **Auf allen Geräten Obsidian schließen.** Wirklich schließen, nicht nur das Fenster.
2. **Warten, bis der Sync ruhig ist.** OneDrive/Dropbox-Symbol zeigt „aktuell" auf jedem Gerät.
   Wenn noch Dateien unterwegs sind, warte, bis nichts mehr überträgt.
3. **Auf jedem Gerät die beiden Dateien ersetzen** — Obsidian bleibt dabei zu:
   - `main.js`
   - `manifest.json`

   Ziel: `<Vault>/.obsidian/plugins/qollab/`
4. **Erst wenn alle Geräte ersetzt sind: Obsidian öffnen.** Beginn mit einem Gerät, warte bis es
   durchgelaufen ist, dann das nächste.

## Prüfen, ob es geklappt hat

Auf jedem Gerät nach dem ersten Start:

- **Version:** Einstellungen → Community-Plugins → Qollab zeigt **0.5.0**.
- **Keine Fehlermeldung** über beschädigte Sync-Dateien. Eine solche Meldung nach dem Update heißt,
  dass ein Gerät noch auf 0.4.0 war und bereits Dateien angefasst hat — dann sofort stoppen und die
  Sicherung heranziehen.
- **Eine Notiz bearbeiten** und prüfen, dass die zugehörige Datei unter `.qollab/` einen neuen
  Zeitstempel bekommt.
- **Gegenprobe zu zweit:** Auf Gerät A eine Zeile hinzufügen, auf Gerät B eine andere Zeile in
  derselben Notiz. Nach dem Sync sollten **beide** Zeilen auf beiden Geräten stehen, ohne
  Konfliktkopie.

## Was diese Version ändert

Alle drei Punkte sind über die vollständige Zustellordnung gemessen (720 Läufe je Zelle); die
Zahlen und ihre Grenzen stehen im `CHANGELOG.md`.

| | vorher | jetzt |
|---|---|---|
| Eigener Edit geht verloren, wenn Obsidian beim Überschreiben zu war | 33,3 % der Zustellordnungen | **8,3 %** |
| Grundtext zerstört, wenn offline eine Zeile gelöscht wurde | 41 % (jede Aufzählung, jede Überschriftenfolge) | **0** |
| Eigene Hilfsdatei komplett genullt | frische Kennung über die lebende Historie | **Abbruch, Datei bleibt** |

**Was sich nicht ändert:** Gelöschte Zeilen können weiterhin zurückkehren (47,4 % der Läufe mit
einer Löschung). Wenn dein Alltag viel Löschen enthält, bleibt das die spürbarste Grenze.

**Der Konfliktkopie-Schutz deines Anbieters muss anbleiben.** Er fängt die verbleibenden 8,3 % auf.

## Wenn etwas schiefgeht

- **Eine Meldung über beschädigte Sync-Dateien:** Sofort alle Geräte schließen. Prüfe, ob wirklich
  jedes Gerät auf 0.5.0 ist. Fehlen Hilfsdateien, spiel den `.qollab/`-Ordner aus der Sicherung
  zurück — bei geschlossenem Obsidian auf allen Geräten.
- **Ein Gerät war doch noch auf 0.4.0:** Der Schaden betrifft die Hilfsdateien, nicht die Notizen.
  Der Vault ist nicht verloren; die Historie der betroffenen Notizen schon. Sicherung
  zurückspielen, dann von vorn.
- **Zurück auf 0.4.0:** Nur zusammen mit der Sicherung des `.qollab/`-Ordners sinnvoll. Die alte
  Version kann die inzwischen geschriebenen `QLB2`-Dateien nicht lesen und würde sie löschen.
