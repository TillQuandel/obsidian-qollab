# Qollab

Du kennst das: Du und eine Kollegin arbeitet im selben Obsidian-Vault über OneDrive.
Ihr bearbeitet gleichzeitig dieselbe Note — und am nächsten Morgen findet ihr das:

```
Meetingprotokoll (Marias conflicted copy 2026-05-18).md
```

Jetzt müsst ihr manuell schauen was die andere geschrieben hat und die Änderungen zusammenführen.

**Qollab versucht das automatisch zusammenzuführen.** Beide Texte sollen erhalten bleiben — ohne dass ihr Konflikt-Kopien von Hand mergen müsst.

> [!WARNING]
> **Experimentell — noch nicht für wichtige Daten.** Der frühere Verdopplungs-Fehler beim ersten Merge ist behoben (positionsgenaue Diff-Updates + Basis-Adoption) — eine *andere*, gemessene Verdopplung beim Erstkontakt zweier Geräte besteht dagegen weiter und ist unter [Grenzen](#grenzen) beschrieben. Bis zum finalen Review vor dem ersten Release bleibt Qollab dennoch experimentell: Lasst die Konflikt-Kopie-Sicherung eures Sync-Dienstes vorerst **aktiv** und verlasst euch nicht allein auf Qollab. Details unter [Grenzen](#grenzen).

## Installation

1. [Letzten Release herunterladen](https://github.com/TillQuandel/obsidian-qollab/releases/latest) — `main.js` + `manifest.json`
2. Ordner `.obsidian/plugins/qollab/` in deinem Vault anlegen
3. Beide Dateien hineinkopieren
4. Obsidian: Einstellungen → Community Plugins → **Qollab** aktivieren

Funktioniert mit OneDrive, Dropbox, Google Drive, iCloud, Syncthing — und jedem anderen Dienst der Dateien synchronisiert.

**Voraussetzung: Obsidian 1.8.7 oder neuer.** Qollab legt seine Geräte-ID im vault-spezifischen Profilspeicher ab, den Obsidian erst ab dieser Version bereitstellt.

**Geräte-ID, Sync-Schalter und Lösch-Markierungen liegen nicht im Vault.** Jede Installation bekommt beim ersten Start eine eigene, zufällige Geräte-ID (sichtbar in den Plugin-Einstellungen). Sie steht — wie der Schalter „Sync aktiviert" und die Lösch-Markierungen — im Obsidian-Profil des jeweiligen Geräts, nicht in der mitsynchronisierten `data.json`. Bis v0.4.0 stand die ID in `.obsidian/plugins/qollab/data.json`: wurde die mitsynchronisiert, trugen beide Geräte dieselbe ID, schrieben dieselbe Hilfsdatei und der automatische Merge fand **nie** statt. Schalter und Markierungen standen bis v0.4.1 dort — mit der Folge, dass ein „Sync aus" auf einem Gerät das andere still mit abschaltete. Beim ersten Start nach dem Update wandern vorhandene Werte automatisch ins Geräteprofil und werden aus `data.json` entfernt.

**Was das kostet: ein neu aufgesetztes Geräteprofil setzt beides zurück.** Neuinstallation, neuer Rechner, aufgeräumter `localStorage` — dann sind der Schalterstand und die Lösch-Markierungen dieses Geräts weg, und Qollab startet dort wieder mit „Sync aktiviert". Qollab kann das nicht abfangen: Ein zurückgesetztes Profil sieht lokal genauso aus wie ein Gerät, das zum ersten Mal an diesen Vault kommt — leere Profilablage, dieselbe `data.json` (die trägt seit v0.4.1 nur noch die Anzeigepräferenz), dieselben schon vorhandenen Hilfsdateien. Würde Qollab daraus „hier war es aus" schließen, käme es auf jedem neu hinzugefügten Gerät stumm ausgeschaltet hoch — und „synct nicht und sagt nichts" ist der teurere Irrtum. **Prüft den Schalter also nach jeder Neuinstallation.**

> **Richtigstellung.** Bis einschließlich v0.4.0 stand hier „ihr könnt den Vault-Ordner also komplett synchronisieren, `.obsidian/` eingeschlossen". Das war falsch, und zwar unabhängig von Qollab.

**`.obsidian/` gehört nur teilweise in den Sync.** Nehmt diese Dateien aus dem Sync-Scope (OneDrive & Co. können Unterordner selektiv ausschließen):

| Datei | Warum |
| --- | --- |
| `workspace*.json` | Fensteranordnung und offene Notes, von Obsidian dauernd geschrieben — gerätespezifisch |
| `vault-stats.json` | wird beim Tippen fortlaufend geschrieben |
| `graph.json`, `appearance.json`, `hotkeys.json` | Ansichts- und Eingabepräferenzen der Person, nicht des Vaults |
| `plugins/*/data.json`, sofern sie Zugangsdaten, Geräte-IDs oder Sync-Wasserstände tragen | Secrets gehören nicht auf zwei Rechner, geteilte Wasserstände erzeugen doppelte oder verpasste Einträge |

Diese Dateien haben zwei Schreiber und keine Merge-Semantik: der Sync-Dienst legt dafür Konflikt-Kopien an, und die schützt Qollab nicht — es kümmert sich ausschließlich um `.md`-Notes.

**Ein Update wandert mit.** `main.js` und `manifest.json` liegen selbst unter `.obsidian/plugins/qollab/`. Synchronisiert ihr diesen Ordner, ist ein Update auf einem Gerät ein unfreiwilliges auf dem anderen — wirksam beim nächsten Obsidian-Start dort. Aktualisiert entweder bewusst gemeinsam, oder nehmt auch den Plugin-Ordner aus dem Sync und kopiert die Dateien auf beiden Geräten von Hand.

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

Qollab legt zu einer Note eine kleine Hilfsdatei an (für `note.md` also `.qollab/note.md.a1b2c3d4.yjs`, wobei `a1b2c3d4` die Geräte-ID ist), **sobald die Note zum ersten Mal bearbeitet wird** — oder sobald die Hilfsdatei eines anderen Geräts für sie ankommt (die wird dann übernommen).
Diese Datei enthält die Änderungshistorie der Note auf eine Art, die automatisch zusammengeführt werden kann — egal in welcher Reihenfolge die Änderungen ankommen.

**Unveränderte Notes bekommen bewusst keine Hilfsdatei.** Grund: Wer sie blind für jede Note anlegt, gibt derselben Note auf jedem Gerät eine eigene Historie — beim Rollout auf zwei Geräten entstehen dann zwei konkurrierende Historien für dieselbe Datei, von denen eine beim ersten Kontakt aufgegeben werden muss. So entsteht die Historie genau einmal: auf dem Gerät, das zuerst editiert; alle anderen Geräte übernehmen sie. Praktische Folge: Bis zum ersten Edit in Obsidian schützt Qollab eine Note nicht — bearbeiten in dieser Zeit zwei Geräte dieselbe Note, greift wie gehabt die Konfliktkopie-Sicherung eures Sync-Dienstes.

Wenn deine Sync-Lösung die `.yjs`-Datei deiner Kollegin synchronisiert, erkennt Qollab das innerhalb einer halben Minute und aktualisiert die Note — beim Öffnen einer Note sofort. Du siehst eine kurze Meldung oben rechts. Wartet also nicht vor der offenen Note darauf, dass etwas passiert, und tippt vor allem nicht selbst nach: Qollab prüft im 30-Sekunden-Takt, und ein Edit genau in diesem Fenster fällt unter die weiter unten beschriebenen Merge-Grenzen.

Die `.yjs`-Dateien siehst du im Vault-Explorer nicht — Obsidian blendet sie aus.

**Beim Start** sieht Qollab einmal alle Notes durch, um Änderungen nachzuziehen, die bei geschlossener App entstanden sind. Seit v0.4.1 merkt es sich dabei, was es beim letzten Mal gesehen hat: Eine Note, die sich seither nicht geändert hat, wird übersprungen, ohne dass eine Datei angefasst wird. Gemessen an einem Vault mit 1 625 Notes in 32 Ordnern: 301 ms beim ersten Start, 7 ms bei jedem weiteren, solange sich nichts geändert hat. Notes, für die es noch keine Hilfsdatei gibt, kosten weiterhin einen Blick in den Ordner — aber nur noch einen pro Ordner statt einen pro Note (im selben Vault: 1 850 ms → 760 ms). Wer das Geräteprofil zurücksetzt, bekommt einmalig wieder den vollen Durchlauf; verloren geht dabei nichts.

## Für IT-Abteilungen

- Keine externen Server, keine Cloud-Dienste
- Alle Daten bleiben auf eurer Sync-Infrastruktur (SharePoint, OneDrive, ...)
- Kein Netzwerk-Traffic außer dem normalen Dateisync
- Open Source, vollständig auditierbar

## Grenzen

**Inhalts-Verdopplung beim ersten Merge — behoben.** Qollab setzt Änderungen jetzt über positionsgenaue Diffs (unveränderte Zeichen behalten ihre Identität) und baut den Merge-Zustand aus dem persistierten State auf statt aus dem Volltext. Zwei Geräte, die unabhängig vom selben Ausgangsstand starten, verdoppeln den Inhalt dadurch nicht mehr.

**Simultan-Erstkontakt — gelöst.** Wenn zwei Geräte dieselbe Note unabhängig anlegen, *bevor* sie die Hilfsdatei des anderen sehen, bekam früher jede Seite eine eigene Historie und der Sync spaltete sich dauerhaft. Jede Note-Inkarnation trägt jetzt eine Doc-GUID; beim Erstkontakt gewinnt deterministisch die (bytewise) kleinere GUID, das unterlegene Gerät wechselt auf dieselbe Basis. Beide Seiten konvergieren ohne Konflikt-Kopie. Wichtig: Bei *identischem* Text konvergieren beide Seiten verlustfrei; bei *divergentem* Text werden beim Wechsel **beide Stände vereinigt** (zeilenweise, Gewinner-Beitrag zuerst) — vorher setzte sich der Volltext einer Seite durch und die Abweichungen der anderen gingen verloren. Drei Konsequenzen der fehlenden gemeinsamen Wurzel: Die Reihenfolge kann überraschen (kein echter 3-Wege-Merge möglich); eine Zeile, die nur eine Seite gelöscht hat, kommt beim Wechsel zurück; und hat eine Seite Zeilen **umsortiert**, steht die verschobene Zeile danach zweimal da (ein Verschieben ist ohne Vergleichsbasis nicht von „gelöscht und woanders eingefügt" zu unterscheiden). Bewusst so gewählt: sichtbares Zuviel statt stillem Verlust. Die Änderungshistorie *einzelner Zeichen* der aufgegebenen Inkarnation geht dabei verloren; ihr Text zählt danach als frische Eingabe dieses Geräts.

**Doppelter Text beim Erstkontakt — gemessen, offen.** Der Wechsel auf die Gewinner-Inkarnation läuft nicht immer auf dem neuesten Stand der Gegenseite: Datei-Sync-Dienste stellen die `.md` und die Hilfsdatei in beliebiger Reihenfolge zu. Bringt ein Gerät dabei seinen Überschuss als eigene Eingabe ein, während die Gegenseite denselben Text unabhängig ebenfalls schon erfasst hat, steht er anschließend **zweimal** in der Note — der gemeinsame Bestand bleibt einfach, der zuletzt hinzugekommene Absatz nicht. In einem Zufallstest über 40 Zwei-Geräte-Durchläufe passiert das in 23 Fällen. In den übrigen 17 waren beide Stände im Moment des Wechsels Byte für Byte gleich; dann wird nur die Inkarnation übernommen und es entsteht kein Duplikat (seit dieser Version als ausdrückliche Prüfung im Code, vorher als Nebeneffekt).

Das ist kein Fehler beim Zusammenführen des Textes, sondern die Folge der fehlenden gemeinsamen Wurzel: Zwei unabhängig getippte Fassungen desselben Satzes sind für ein CRDT zwei verschiedene Sätze, gleich wie identisch sie aussehen. Die naheliegende Gegenmaßnahme — den Überschuss der unterlegenen Seite einfach verwerfen — ist gemessen worden: Sie senkt die Verdopplungen von 23 auf 5, erzeugt dafür aber **15 stille Textverluste**, wo es vorher keinen einzigen gab. Sichtbares Zuviel statt stillem Verlust bleibt deshalb die gewählte Richtung. Praktische Folge für euch: Wenn ihr eine Note auf beiden Geräten anlegt oder bearbeitet, *bevor* sie sich das erste Mal gesehen haben, lest sie nach dem ersten Sync einmal durch — doppelte Absätze löscht ihr gefahrlos von Hand, sie kommen nicht wieder.

**Ihr müsst dafür nicht mehr raten, welche Note es trifft.** Bis v0.4.0 passierte dieses Zusammenlegen stillschweigend; der einzige Hinweis war dieselbe Meldung, die auch ein ganz gewöhnlicher, sauber aufgegangener Abgleich auslöst — und die ließ sich in den Einstellungen abschalten. Seit v0.4.1 meldet Qollab den Fall ausdrücklich:

> Qollab: „Einkaufsliste" wurde auf zwei Geräten getrennt bearbeitet. Beide Fassungen stehen jetzt untereinander in der Notiz — bitte einmal durchsehen, Absätze können doppelt vorkommen.

Die Meldung erscheint höchstens einmal pro Notiz und Sitzung und hängt **nicht** am Schalter für die Routine-Meldungen. Sie erscheint nur, wenn wirklich beide Seiten etwas beigetragen haben; war eine Fassung in der anderen ohnehin enthalten (der häufige Fall), gibt es nichts zu melden. Qollab weigert sich dabei bewusst **nicht**, die Fassungen zusammenzulegen — ein Abbruch müsste eine der beiden Fassungen aus der Notiz nehmen, und der Grundsatz bleibt „sichtbares Zuviel statt stillem Verlust". Was aufhört, ist das Schweigen darüber. Eine zusätzliche Konflikt-Kopie legt Qollab aus demselben Grund nicht an: Beide Fassungen stehen bereits in der Notiz, eine Kopie verdoppelt nur, was ohnehin dasteht.

**Der umgekehrte Fall wird ebenfalls gemeldet.** Treffen zwei getrennt entstandene Fassungen aufeinander, legt Qollab sie nicht immer zusammen: Auf **einem** der beiden Geräte behält es die eigene Fassung und übernimmt die andere nicht. Welches Gerät das ist, entscheidet ein Vergleich zweier interner Kennungen, also praktisch der Zufall. Bis v0.4.1 sagte dieses Gerät dazu nichts — dort fehlte anschließend der Text des anderen, ohne jeden Hinweis, während das andere Gerät die Meldung oben sah. Gemeldet wird das jetzt hier:

> Qollab: Von „Einkaufsliste" gibt es eine zweite, getrennt entstandene Fassung. Sie wurde hier nicht übernommen — steht dort Text, der hier fehlt, muss er von Hand übertragen werden.

Auch diese Meldung kommt höchstens einmal pro Notiz und Sitzung. Betrifft es beim ersten Zusammentreffen sehr viele Notizen auf einmal — der typische Fall, wenn zwei bereits benutzte Vaults zum ersten Mal aufeinandertreffen —, meldet Qollab die ersten drei einzeln und fasst den Rest zu einem Hinweis zusammen; die vollständige Liste steht in der Entwicklerkonsole. **Was in dieser Lage praktisch hilft:** Schaut auf dem *anderen* Gerät in dieselbe Notiz. Dort steht der Stand, der hier fehlt — und dort seht ihr in der Regel die Meldung oben, weil dieses Gerät beide Fassungen zusammengelegt hat.

**Zombie-Resurrection — behoben, mit zwei Ausnahmen.** Eine gelöschte und gleichnamig neu angelegte Note wird nicht mehr durch eine verspätet ankommende alte Hilfsdatei „wiederbelebt": Beim Löschen wird die GUID der alten Inkarnation lokal getombstoned; stale Hilfsdateien dieser GUID werden erkannt, ignoriert und aufgeräumt. v0.1-Legacy-Dateien werden ausschließlich für den einmaligen Erst-Import akzeptiert; sobald GUID-tragender State existiert, werden sie ignoriert und gelöscht. Als Legacy gilt dabei nur, was es nachweislich ist: die Datei muss lesbar sein **und** die alte Namensform ohne Geräte-ID tragen. Eine Hilfsdatei, die euer Sync-Dienst leer oder unvollständig auf die Platte legt (bei OneDrive ein dokumentierter Fall), wird übersprungen und gemeldet — nicht gelöscht. Bis v0.4.0 galt sie als Altlast und wurde entfernt; traf es die Datei des anderen Geräts, trug der Sync die Löschung dorthin zurück. Die beiden Ausnahmen — kein Schutz ohne Markierung, und die Markierung entsteht nicht immer — stehen weiter unten unter „Zwei Lagen, in denen gar keine Markierung entsteht".

Wenn zwei Personen **gleichzeitig dieselbe Zeile** ändern, entscheidet Qollab automatisch welche Version vorne steht — beide Texte bleiben erhalten, aber die Reihenfolge kann überraschend sein.

**Erstkontakt bei ungeordnetem Datei-Sync.** Trackt ein Gerät eine Note zum ersten Mal und kommt die fremde Hilfsdatei *vor* der neueren `.md` an, wird der lokale Dateistand mit dem übernommenen Fremd-Stand vereinigt statt darüber gelegt. Das frühere kurzzeitige Zurückspringen einer frischen Remote-Änderung entfällt damit; im Gegenzug kann eine remote gelöschte Zeile, die der lokale Dateistand noch führt, wieder auftauchen (siehe oben). Kommt die Hilfsdatei ganz **ohne** zugehörige `.md` an (Note gibt es hier noch nicht), rührt Qollab sie nicht an: keine eigene Historie, keine eigene Hilfsdatei — sie wird erst verwendet, wenn die `.md` nachsynct.

> **Richtigstellung.** Der folgende Absatz behauptete bis einschließlich v0.4.0, die Lösch-Markierungen lägen „nur auf dem Gerät, das die Löschung durchführt". Das war falsch: sie standen in `.obsidian/plugins/qollab/data.json`, also in dem Ordner, den derselbe README zum Mitsynchronisieren empfahl. Über diese Datei sprang eine Markierung auf das andere Gerät und traf dort womöglich eine lebende Note; außerdem überschrieb jedes Speichern die komplette Liste der Gegenseite. Seit v0.4.1 stimmt die Aussage — die Markierungen liegen im Geräteprofil, wie die Geräte-ID.

**Gerätelokale Tombstones (bewusste Grenze).** Die Lösch-Markierungen liegen nur auf dem Gerät, das die Löschung durchführt. Ein anderes Gerät, das während Löschung + Neuanlage geschlossen/offline war, kann mit seiner alten Historie weiterlaufen und nimmt am CRDT-Merge der neuen Inkarnation nicht mehr teil (sein Tie-Break bevorzugt womöglich die alte GUID). Durch zwei Schutz-Guards kann ein zurückkehrender leerer State die Note nicht mehr leeren: Qollab startet keinen Merge ohne existierende `.md` (Guard 1), und ein historienloser Frisch-Doc ohne Ops überschreibt keine vorhandene `.md` (Guard 2). Bei Delete-vs-Offline-Edit überlebt der Inhalt über den normalen Datei-Sync; die CRDT-Historie der Offline-Edits geht dabei verloren (die Note startet mit frischer Historie). Die vollständige Lösung — Löschen als CRDT-Operation mit Add-wins-Semantik — ist für v0.5 geplant.

**Zwei Lagen, in denen gar keine Markierung entsteht.** War Qollab auf diesem Gerät im Moment des Löschens **ausgeschaltet**, wird keine gesetzt: „aus" heißt bewusst *keine Zustandsänderung*. Sonst beerdigte das ausgeschaltete Plugin eine Notiz, die euer Sync-Dienst nur umbenannt hat — eine Umbenennung kommt dort als Löschen-plus-Neuanlegen an, und die Markierung hielte 90 Tage. Geht das **Geräteprofil verloren** (Neuinstallation, neuer Rechner), sind alle bestehenden Markierungen weg; sie woanders abzulegen hieße, sie in die mitsynchronisierte `data.json` zu schreiben — genau der Fehler, den die Richtigstellung oben beschreibt. In beiden Lagen kann eine später eintreffende Hilfsdatei des anderen Geräts den alten Text in eine gleichnamige neue Notiz zurückbringen, wie unten bei den weggeräumten Ordnern. Das ist der Preis des Aus-Schalters und der gerätelokalen Ablage, kein offener Fehler: Der Aus-Schalter darf nichts anfassen, und eine geteilte Markierung träfe auf dem anderen Gerät eine lebende Notiz.

**Tombstone-Reichweite: pro Pfad und Inkarnation.** Eine Lösch-Markierung gilt für genau ein Paar aus Note-Pfad und Inkarnation, nicht mehr für die Inkarnation unter allen Pfaden. Das ist wichtig, weil Datei-Sync-Dienste eine Umbenennung häufig als Löschen-plus-Neuanlegen zustellen: Früher entwertete so ein sync-vermittelter Rename die Historie der Note, obwohl niemand sie gelöscht hatte — die Hilfsdateien unter dem neuen Namen galten als Leichen und wurden weggeräumt. Jetzt bleibt dieselbe Inkarnation unter einem anderen Pfad unberührt, und die eigene Hilfsdatei wird über diesen Weg grundsätzlich nicht mehr gelöscht. Der Zombie-Schutz oben ist davon unberührt: er greift beim gleichnamigen Neuanlegen, also unter demselben Pfad — und zusätzlich unter allen Namen, die dieselbe Note in derselben Obsidian-Sitzung vorher getragen hat. Wer eine Note erst umbenennt und dann löscht, ist also auch unter dem alten Namen geschützt. Diese Umbenennungs-Historie liegt allerdings nur im Arbeitsspeicher: Wird Obsidian zwischen Umbenennen und Löschen neu gestartet, deckt die Markierung nur noch den zuletzt getragenen Namen ab.

**Ordner, die euer Sync-Dienst lokal wegräumt.** Dropbox und OneDrive können einzelne Ordner pro Gerät abwählen — der Ordner verschwindet dann von der Platte *dieses* Geräts, während die Notizen auf dem anderen Gerät unverändert weiterleben. Für Obsidian sieht das aus wie Löschen. Bis v0.4.0 zog Qollab daraus die volle Konsequenz: Es markierte die Notizen als gelöscht und räumte **alle** Hilfsdateien weg, auch die des anderen Geräts — und euer Sync-Dienst trug diese Löschung dorthin zurück, wo sie die Historie vernichtete, ohne dass dort jemand etwas gelöscht hätte. Jetzt gilt: Ist der **Ordner** der Notiz mit verschwunden, war das kein Löschbefehl für diese Notiz — Qollab setzt keine Markierung und fasst die Hilfsdateien nicht an; schaltet ihr den Ordner wieder ein, läuft dieselbe Historie weiter. Der Preis ist die Kehrseite: Löscht *ihr selbst* einen ganzen Ordner, ist das auf diesem Gerät nicht davon zu unterscheiden. Dann bleiben die Hilfsdateien dieser Notizen liegen, und der Zombie-Schutz oben greift für sie nicht — legt ihr später eine gleichnamige Notiz an genau derselben Stelle an, kann der alte Text darin auftauchen. Für Notizen direkt in der Vault-Wurzel und für einzeln gelöschte Notizen ändert sich nichts.

Zwei Grenzen bleiben. Erstens: Trägt die eigene, lebende Hilfsdatei noch eine als gelöscht markierte Inkarnation (möglich, wenn das Aufräumen beim Löschen scheitert oder der Datei-Sync die Note zurückbringt), wird sie selbst zwar verschont — eine *fremde* Hilfsdatei derselben Inkarnation unter demselben Pfad wird aber bei jedem Scan gelöscht. Legt das andere Gerät sie danach neu an, entsteht ein Lösch-/Neuanlage-Pingpong im Scan-Takt, bis die Markierung nach 90 Tagen verfällt. Zweitens: Beim Update auf diese Version werden bestehende Lösch-Markierungen des alten Formats verworfen (ihr Pfad ist nachträglich nicht rekonstruierbar). Im schlechtesten Fall wird dadurch der Inhalt einer bereits gelöschten Note einmalig in eine gleichnamige neue Note übernommen — durch die Vereinigungs-Semantik oben steht dann ihr voller Text in der neuen Note. Kein Datenverlust, aber von Hand zu bereinigen.

**Grenzen des Editier-Schutzes während eines Merges.** Der Write-Back-Guard schützt lokale Edits, die während eines laufenden Remote-Merges getippt werden, über einen 3-Wege-Text-Merge. Der ist nicht konfliktfest:

- Bei direkt überlappenden Änderungen setzt sich die lokale Version durch — die Remote-Änderung dieser Stelle geht verloren.
- Verschiebt die Remote-Änderung den Kontext um viele hundert Zeichen (z. B. großer eingefügter Absatz weiter oben), kann der lokale Edit still verloren gehen.
- Bei Löschung ganzer Absätze remote können einzelne Textreste verschmelzen.

Zusätzlich existiert ein sehr kleines Zeitfenster (Millisekunden um den Write-Back), in dem ein Edit sein modify-Event verliert und beim nächsten Remote-Merge überschrieben werden kann. Für diese Randfälle gilt die Empfehlung in der WARNING oben: Lasst die Konflikt-Kopie-Sicherung eures Sync-Dienstes aktiv.

**Was „Sync aktiviert: aus" bedeutet.** Ausgeschaltet erfasst Qollab keine Bearbeitungen, führt nichts zusammen, setzt keine Lösch-Markierungen und vergibt keine neue Geräte-ID. Was weiterläuft, ist reines Aufräumen: Benennt ihr eine Note um oder löscht sie, ziehen die Hilfsdateien mit bzw. verschwinden — sonst blieben sie als Waisen liegen. Beim Wieder-Einschalten holt Qollab die Aus-Phase in einem Durchlauf nach, bevor es wieder auf Änderungen der Gegenseite reagiert; bis v0.4.0 fehlte dieser Durchlauf, und der erste Abgleich nach dem Einschalten überschrieb alles, was in der Aus-Phase entstanden war.

**Wenn eine Hilfsdatei nicht geschrieben werden kann.** Hält der Sync-Dienst gerade ein Handle, ist das Volume voll oder der Pfad zu lang, scheitert das Speichern des internen Stands. Die Bearbeitung selbst ist nicht verloren — sie steht in der Note und im Arbeitsspeicher —, und der nächste Durchlauf wiederholt den Schreibversuch. Hält der Fehler an, meldet Qollab das nach dem dritten Versuch einmalig. Bis v0.4.0 gab es dafür kein Signal: „meine Änderungen kommen nicht an" war von „alles in Ordnung" nicht unterscheidbar.

**Veralteter Stand beim Nachhol-Versuch nach einem Lesefehler.** Ist eine Hilfsdatei kurzzeitig nicht lesbar (Sync-Tool hält gerade ein Handle), bricht Qollab den laufenden Schritt ab und merkt sich den Text, der dabei nicht erfasst wurde; beim nächsten Durchlauf wird genau dieser Text nachgespielt. Wird die Note im Sub-Sekunden-Fenster zwischen Abbruch und Nachhol-Versuch extern editiert, ohne dass dazwischen ein modify-Event verarbeitet wurde, spielt der Nachhol-Versuch den älteren Stand ein. In allen anderen Reihenfolgen fängt der reguläre modify-/Merge-Fenster-Pfad den Edit ab.

**Doppel-Kollision im selben Verarbeitungsschritt.** Enthält eine `.md`-Änderung in *einem* Schritt sowohl einen noch ungemergten Fremd-Edit (aus der Hilfsdatei) als auch einen lokalen Edit, kann der Fremd-Edit verdoppelt werden. Erreichbar über Read-Coalescing im Poll-Fenster (mehrere Änderungen fallen in denselben Lesevorgang) oder über den Restart-Sweep beim App-Start. Dieselbe Wurzel hat ein Ankunftsreihenfolge-Fenster: Bringt der Datei-Sync die `.md` *vor* der zugehörigen Fremd-Hilfsdatei auf die Disk und verarbeitet der modify-Handler die `.md`, bevor die Hilfsdatei geschrieben ist, findet der Vor-Merge-Schritt nichts einzumergen — der Diff erfindet die Fremd-Edits weiterhin als lokale Ops, und der spätere Hilfsdatei-Merge verdoppelt sie.

> **Richtigstellung.** An dieser Stelle stand bis einschließlich v0.4.0: „Das Fenster ist eng und es gibt **keine Verlustrichtung** — nur eine mögliche Verdopplung, kein Datenverlust." Das ist widerlegt. Verlust und Verdopplung sind zwei Seiten derselben Ursache und treten im selben Schritt auf: Qollab hielt den `.md`-Text für die vollständige, gewollte Wahrheit des lokalen Nutzers und verglich ihn mit dem *Merge-Zustand* statt mit dem zuletzt gesehenen Dateiinhalt. Jeder Unterschied wurde damit zur gewollten Löschung — auch dann, wenn er gar nicht vom Nutzer kam.

Diese Wurzel hat zwei Richtungen. Die eine ist **behoben**: Nach dem Einmergen einer Fremd-Hilfsdatei kannte nur der interne Merge-Zustand den fremden Satz, die Datei noch nicht — und der nächste Tastendruck (Obsidian speichert wenige Sekunden nach jedem Tippstopp, das Zeitfenster war so breit wie das 30-Sekunden-Intervall des Wächters) löschte ihn auf **beiden** Geräten, ohne Meldung und ohne Möglichkeit ihn wiederzuholen. Das gemergte Ergebnis wird jetzt sofort in die Datei zurückgeschrieben, und der lokale Vergleich läuft gegen den zuletzt gesehenen Dateiinhalt statt gegen den Merge-Zustand.

Die andere Richtung ist **offen**: Fällt die `.md` *fremdbestimmt* hinter den Merge-Zustand zurück — der Sync-Dienst überschreibt eine lokal geänderte Datei mit der Fassung des anderen Geräts (OneDrive legt die Serverversion an den Originalnamen, die lokale wird zur Konfliktkopie), eine Fassung wird aus dem Versionsverlauf wiederhergestellt, ein Lesevorgang liefert die Datei verkürzt — dann ist das Ergebnis auf Datei-Ebene von einer echten lokalen Löschung nicht zu unterscheiden. Der eigene, noch nicht synchronisierte Edit wird dabei als Löschung in die eigene Hilfsdatei geschrieben, also gerade dort entfernt, wo er als letztes noch existierte; der Text des Peers kommt zusätzlich als eigene Einfügung dazu und steht danach doppelt. Gemessen in einem Zwei-Geräte-Fuzz über 400 Abläufe je Transport-Variante: überschreibt der Sync-Dienst die `.md`, verlieren **68 von 400** Abläufen Text und **173** enthalten am Ende mindestens einen doppelten Textbaustein; 65 sind sauber, 162 konvergieren im Testrahmen gar nicht. Überschreibt er sie nicht, verliert **kein** Ablauf Text (vorher 19) — aber **242 von 400** enthalten trotzdem einen doppelten Baustein (vorher 240). Diese Verdopplung ist überwiegend die weiter unten beschriebene Erstkontakt-/Vereinigungs-Verdopplung und von diesem Fix unberührt. (Die Konfliktsemantik von OneDrive ist im Testaufbau modelliert, nicht gemessen.) Die Konfliktkopie-Sicherung eures Sync-Dienstes hilft hier nur der `.md` — die Kopie liegt unter neuem Namen —, nicht dem internen Zustand.

> **Zu den Zahlen.** Bis einschließlich der ersten Fassung dieses Absatzes stand hier „37 von 80 sauber" bzw. „**80 von 80**". Diese Zahlen kamen aus einem Messinstrument, das ausschließlich *fehlende* Textbausteine zählte; ein **verdoppelter** Baustein fiel dort in die Kategorie „sauber". „80 von 80" hieß also nie „der Text ist heil", sondern nur „nichts fehlt". Die Zahlen oben zählen Verlust und Verdopplung getrennt.

Ein sauberer Fix für diese Richtung ist **nicht in Sicht und nicht zugesagt**. Naheliegend wäre Op-Provenienz (Herkunftsverfolgung einzelner Einfügungen) mit der Regel „fehlen in der Datei Zeichen, die ein *fremdes* Gerät geschrieben hat, ist das keine plausible lokale Löschung" — die ist gemessen **unbrauchbar**: Sie kann „ich lösche den Satz der Kollegin" nicht von „der Sync hat ihn herausfallen lassen" unterscheiden (die Herkunft der gelöschten Zeichen ist in beiden Fällen dieselbe) und würde damit das bewusste Löschen fremden Textes dauerhaft verhindern — in einer gemeinsam geschriebenen Note der Normalfall. Sie verfehlt zusätzlich den belegten Schaden, bei dem *eigener* Text verschwindet. Tragfähig wirkt allenfalls die umgekehrte Klausel — Text, der einer dekodierten *fremden* Änderung zuzuordnen ist, gilt nicht als lokal eingefügt —, und die deckt nur die eine der beiden Ankunftsreihenfolgen ab. Es braucht daher voraussichtlich zwei getrennte Mechanismen statt einer Regel; bis dahin bleibt diese Richtung offen.

**Geräte-ID-Kollision — erkannt und automatisch geheilt.** Haben zwei Geräte dieselbe Geräte-ID (nur noch möglich, wenn beide dieselbe alte `data.json` geerbt haben und sie beim Update gleichzeitig migrieren), schreiben sie dieselbe Hilfsdatei. Qollab merkt beim Scan, dass die eigene Hilfsdatei von fremder Hand verändert wurde, vergibt dem Gerät eine neue ID und meldet diese Kollision einmal. Die alte Datei bleibt liegen — sie gehört ab dann dem anderen Gerät und wird als normale Fremd-Datei derselben Note-Inkarnation gemergt. Grenzen davon: Erkannt wird in der Regel innerhalb eines Scan-Intervalls (30 s) — der fremde Stand muss den Scan aber *überleben*; schreibt das eigene Gerät vorher selbst (lokaler Edit, Merge, Start-Sweep), überschreibt es die Spur, und die Kollision fällt erst beim nächsten Mal auf. Und die Historie, die sich beide Geräte bis zur Erkennung gegenseitig überschrieben haben, lässt sich nicht rekonstruieren — dort gewinnt der zuletzt geschriebene Stand.

> **Richtigstellung.** Der folgende Absatz nannte bis einschließlich v0.4.1 als einzige Folge eines verlorenen Profils eine „verwaiste Hilfsdatei". Das war unvollständig: Mit dem Profil gehen auch der Sync-Schalter und sämtliche Lösch-Markierungen dieses Geräts.

**Verlorenes Obsidian-Profil = neue Geräte-ID, und ein zurückgesetztes Plugin.** Wird das Profil zurückgesetzt (Neuinstallation, neuer Rechner, aufgeräumter `localStorage`), bekommt das Gerät eine frische ID. Der Text der lebenden Notizen ist nicht in Gefahr: die eigene Alt-Datei zählt danach als Fremd-Datei derselben Note-Inkarnation und wird ganz normal eingemergt. Sie bleibt allerdings als verwaiste Hilfsdatei liegen. Mitgegangen sind außerdem der Schalter „Sync aktiviert" — er steht wieder auf an — und sämtliche Lösch-Markierungen: gelöschte Notizen sind ab da nicht mehr dagegen geschützt, über eine verspätet eintreffende alte Hilfsdatei zurückzukehren. Beides ist die Kehrseite davon, dass diese Werte gerätelokal liegen; die Alternative wäre die mitsynchronisierte `data.json`, und die hat auf dem anderen Gerät nachweislich Schaden angerichtet.

Echtzeit-Cursor-Sync (wie in Google Docs) ist angedacht, aber mit der server-losen File-Sync-Architektur nicht ohne Weiteres umsetzbar — kein fester Termin.

## Bekannte Architektur-Schwäche

Qollab legt aktuell pro Note eine eigene `.yjs`-Sidecar-Datei unter `.qollab/<vault-path>/<note>.md.<clientId>.yjs` an — das Vault-Tree wird unter `.qollab/` gespiegelt. Bei großen Vaults (1000+ Notes) entstehen entsprechend viele Dateien, was OneDrive/Dropbox unnötig belastet (jede Sidecar ist eine eigene Konflikt-Achse) und gegen die [Yjs-Empfehlung](https://docs.yjs.dev/api/faq) zu „hunderten gleichzeitig geladenen YDocs" verstößt.

Für kleine Vaults (<100 Notes) ist das vernachlässigbar. Für große Vaults aktuell besser deaktivieren bis [Issue #9](https://github.com/TillQuandel/obsidian-qollab/issues/9) (geplanter späterer Refactor auf Subdocuments + SQLite-Single-Store) umgesetzt ist. **Der Schalter gilt pro Gerät** und liegt im Obsidian-Profil: Ihr müsst ihn auf jedem Gerät einzeln umlegen, und nach einer Neuinstallation oder einem zurückgesetzten Profil steht er dort wieder auf „an" (siehe [oben](#installation)).

## Für Entwickler

```powershell
npm install
node esbuild.config.mjs production   # → main.js
npx jest                              # Tests
```
