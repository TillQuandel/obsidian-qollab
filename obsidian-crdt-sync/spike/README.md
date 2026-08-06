# Messapparat

Kein Produktivcode. Läuft **nicht** im normalen `npx jest` mit (die Default-Config
in `package.json` matcht nur `**/tests/**/*.test.ts`).

## Ausführen

```powershell
cd obsidian-crdt-sync
npx jest --config ../jest.spike.config.js --rootDir .. -t "misst drei Lagen" `
  --no-cache --cacheDirectory "<ein-eigenes-Verzeichnis>"
```

Das eigene Cache-Verzeichnis ist unter Windows Pflicht — sonst kollidiert der Lauf
mit dem der normalen Suite (EPERM).

## Was hier misst was

| Datei | Gegenstand |
| --- | --- |
| `geraet.ts` | Zwei-Geräte-Treiber gegen den **echten** `SyncHandler` samt echter Schreibspur. Nachgebaut ist nur die Klammer aus `main.ts`: modify-Handler, Write-Back, Poll und der **Start-Sweep**. |
| `wolke.ts` | Der Datei-Sync als eigene Schicht, mit getrenntem Hoch- und Herunterladen und drei Konfliktmodi. |
| `lauf-rueckfall.ts` | Das Szenario „die `.md` fällt fremdbestimmt hinter den Merge-Zustand zurück". |
| `zzRF-rueckfall.spec.ts` | Die Messung dazu: drei Lagen × zwei Konfliktmodi, je die **vollständigen** 720 Zustellreihenfolgen. |
| `zzRF0-rauch.spec.ts` | Rauchtest — läuft das Szenario überhaupt den Weg, den es messen soll. |
| `invarianten.ts` | Verlust und Verdopplung, getrennt gezählt, beide Seiten geprüft. |
| `guid-quelle.ts`, `zufall-quelle.ts` | Determinismus: Kennungen und Yjs-clientIDs sind gestellt, nicht gewürfelt. |

Herkunft: portiert von `mess/verdopplung` (`spike/lauf.ts` misst dort den
Prägemoment). Getrimmt auf die API dieses Branches, plus `Geraet.sweep()` — den
Start-Sweep kannte die Vorlage nicht, und ohne ihn ist der gemessene Schadensweg
unsichtbar.

## Warum das hier im Repo liegt

Weil das Vorgängerinstrument es nicht tat. Die Zahlen „68 von 400" und
„162 von 400" aus der deutschen README-Fassung stammen aus `endz/zzdet.spec.ts`,
das außerhalb des Repos im `tmp` eines Jobs lag und mit ihm gelöscht wurde. Es
existiert kein Rohdatensatz dieses Laufs; die Zahlen sind nur noch Prosa und
nicht nachrechenbar. Ein Messapparat, der eine README-Aussage trägt, gehört
neben den Code, den er misst.
