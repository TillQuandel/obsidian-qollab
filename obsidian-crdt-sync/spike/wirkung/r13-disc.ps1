# R-1.3 — Sweep-Gate (Task 17 F-2)
#
#   Bei geschlossener App wird Bs Note extern geaendert, gleichzeitig trifft eine
#   frische Fremd-Sidecar von A ein. Dann startet B und die Note wird SOFORT
#   geoeffnet (Start direkt auf der Datei per obsidian://open?path=<Datei>), ohne
#   auf irgendetwas zu warten.
#   Erwartet: Die externe Aenderung ueberlebt. Vor dem Fix konnte der file-open-
#   Trigger den Startup-Sweep ueberholen; loadAndMerge laeuft dann im own-Branch,
#   der den .md-Text bewusst nicht einspielt, und der Write-Back schrieb den nie
#   erfassten Text weg — in Datei UND CRDT, auf beiden Geraeten.
#   Zusaetzlich als positives Gegensignal: As frischer Stand muss ankommen.
param([string]$RunId = ("r13-" + (Get-Date -Format "yyyyMMdd-HHmmss")))

. "C:\tmp\qollab-test\harness\harness.ps1"
. "C:\tmp\qollab-test\harness\harness-ext-disc.ps1"

$szenario        = 'r13'
$verdictOverride = $null
$klr             = ''
$runAsserts      = [System.Collections.Generic.List[hashtable]]::new()

function TA([string]$N,[bool]$Ok,[string]$Ist='',[string]$Soll='') {
    $runAsserts.Add(@{name=$N;ok=$Ok;ist=[string]$Ist;soll=[string]$Soll})
    if ($Ok) { Write-Host "[OK] $N" } else { Write-Host "[FAIL] $N ist='$Ist' soll='$Soll'" }
}

$note = 'Meetingprotokoll.md'
$mA   = "AAA-$RunId"
$mB   = "BBB-$RunId"
$mA2  = "A2-$RunId"
$mOff = "OFFLINE-B-$RunId"

try {
    H-DEPLOY
    H-RESET $RunId
    H-NOTE-CLEAN @('AliveA.md','AliveB.md')
    H-WRITE-NOTE 'a' 'AliveA.md' $script:HarnessBaseText
    H-WRITE-NOTE 'b' 'AliveB.md' $script:HarnessBaseText
    H-WATCH start

    H-START 'a'
    H-EDIT 'a' 'AliveA.md' ($script:HarnessBaseText + "ALIVE-A-$RunId")
    $script:_qA = Join-Path $script:HarnessVaultA '.qollab'
    H-WAIT { @(Get-ChildItem $script:_qA -Filter 'AliveA.md.*.yjs' -EA 0).Count -gt 0 } 240 | Out-Null
    $cidA = @(H-CLIENTID 'a' 'AliveA.md')[0]
    TA 'plugin-aktiv-A' ($null -ne $cidA) $cidA '8-hex'
    # Konvergierter Ausgangszustand mit EINER geteilten Inkarnation.
    H-SETUP-SHARED $note $mA $mB
    $script:_qB = Join-Path $script:HarnessVaultB '.qollab'
    $cidB = @(H-CLIENTID 'b' $note | Where-Object { $_ -ne $cidA })[0]
    TA 'plugin-aktiv-B' ($null -ne $cidB) $cidB '8-hex'
    TA 'konvergenz-geteilte-guid' ((H-VERIFY 'a' $note).guid -eq (H-VERIFY 'b' $note).guid) (H-VERIFY 'b' $note).guid (H-VERIFY 'a' $note).guid
    TA 'kontrolle-A-in-B' ((H-COUNT 'b' $note $mA) -eq 1) (H-COUNT 'b' $note $mA) '1'

    # ── A macht einen frischen Edit, dann werden beide Apps geschlossen ─────
    $aSide = Join-Path $script:_qA "$note.$cidA.yjs"
    $aMt   = (Get-Item $aSide).LastWriteTimeUtc
    H-EDIT 'a' $note ((H-READ 'a' $note) + "`n$mA2")
    $script:_aSide = $aSide; $script:_aMt = $aMt
    H-WAIT { (Get-Item $script:_aSide -EA 0).LastWriteTimeUtc -gt $script:_aMt } 240 | Out-Null
    $null = H-QUIET-MAX -Sek 20 -MaxSec 180

    H-STOP
    Start-Sleep -Seconds 3
    $null = H-INV 'nach-stop'

    # ── Externe Aenderung bei B + gleichzeitig frische Fremd-Sidecar ────────
    H-WRITE-NOTE 'b' $note ((H-READ 'b' $note) + "`n$mOff")
    H-SYNC-ONE 'a->b' ".qollab/$note.$cidA.yjs" | Out-Null
    TA 'offline-edit-in-datei' ((H-COUNT 'b' $note $mOff) -eq 1) (H-COUNT 'b' $note $mOff) '1'

    # ── Start DIREKT auf der Note (file-open so frueh wie moeglich) ─────────
    H-START-FILE 'b' $note
    $ruhe = H-QUIET-MAX -Sek 45 -MaxSec 300
    TA 'ruhe-nach-start' $ruhe $ruhe '$true'

    # ── Kern-Assert: die externe Aenderung ueberlebt ────────────────────────
    TA 'externe-aenderung-ueberlebt' ((H-COUNT 'b' $note $mOff) -eq 1) (H-COUNT 'b' $note $mOff) '1'
    # Positives Gegensignal: der Fremd-Stand ist wirklich angekommen (sonst waere
    # „nichts geloescht" nur die Aussage „es lief gar nichts").
    TA 'fremd-stand-angekommen' ((H-COUNT 'b' $note $mA2) -eq 1) (H-COUNT 'b' $note $mA2) '1'
    TA 'alt-A-1x' ((H-COUNT 'b' $note $mA) -eq 1) (H-COUNT 'b' $note $mA) '1'
    TA 'alt-B-1x' ((H-COUNT 'b' $note $mB) -eq 1) (H-COUNT 'b' $note $mB) '1'

    $v = H-VERIFY 'b' $note
    $mc = Get-MC $v.markerCounts $mOff
    TA 'crdt-offline-edit-erfasst' ($mc -eq 1) $mc '1'

    # ── Rueckweg: der Offline-Edit darf auf A nicht verloren gehen ──────────
    H-SYNC-ONE 'b->a' ".qollab/$note.$cidB.yjs" | Out-Null
    H-START 'a'
    $script:_note = $note; $script:_mOff = $mOff
    $backOk = $false
    try { H-WAIT { (H-COUNT 'a' $script:_note $script:_mOff) -ge 1 } 180 | Out-Null; $backOk = $true } catch {}
    TA 'A-erhaelt-offline-edit' $backOk $backOk '$true'
    TA 'A-offline-edit-1x' ((H-COUNT 'a' $note $mOff) -eq 1) (H-COUNT 'a' $note $mOff) '1'

    $null = H-INV 'ende'

} catch {
    Write-Host "[ERROR] $_"
    if (-not $verdictOverride) { $verdictOverride = 'FAIL' }
} finally {
    H-WATCH stop
}

$failA   = @($runAsserts | Where-Object { -not $_.ok })
$verdict = if ($failA.Count -gt 0) { 'FAIL' } elseif ($verdictOverride) { $verdictOverride } else { 'PASS' }
$rdir    = $script:HarnessRunDir
$artefakte = if ($rdir -and (Test-Path $rdir)) { @(Get-ChildItem $rdir | Select-Object -Exp FullName) } else { @() }
$vo = @{ szenario=$szenario; verdict=$verdict
         asserts=@($runAsserts | ForEach-Object { [ordered]@{name=$_.name;ok=$_.ok;ist=$_.ist;soll=$_.soll} })
         artefakte=$artefakte }
if ($rdir) { try { $vo | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $rdir 'verdict.json') -Encoding UTF8 } catch { Write-Host "[WARN] verdict.json: $_" } }
$reason = switch ($verdict) { 'PASS'{'alle Asserts gruen'} 'INCONCLUSIVE'{$klr} default{"$($failA.Count) Assert(s) fehlgeschlagen"} }
Write-Host "VERDICT: $verdict $szenario $reason"
if ($verdict -ne 'PASS' -and $rdir) {
    $zip   = Join-Path $script:HarnessRunsDir "$RunId-evidenz.zip"
    $toZip = @($rdir) + @($script:HarnessVaultA,$script:HarnessVaultB | Where-Object { Test-Path $_ })
    try { Compress-Archive -Path $toZip -DestinationPath $zip -Force; Write-Host "[EVIDENZ] $zip" } catch { Write-Host "[WARN] ZIP: $_" }
}
