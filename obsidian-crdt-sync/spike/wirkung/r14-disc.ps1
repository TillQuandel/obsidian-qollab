# R-1.4 — Unvollstaendige Sidecar (Task 17 F-1)
#
# Konvergierter Zustand (EINE geteilte Inkarnation, siehe H-SETUP-SHARED), dann
# wird bei B die FREMDE Sidecar (die von A) durch eine 0-Byte-Datei gleichen
# Namens ersetzt. B editiert weiter und wartet einen Poll ab.
#   Erwartet: die 0-Byte-Datei wird NICHT geloescht (vor dem Fix loeschte B sie
#   als vermeintliche v0.1-Leiche, und der bidirektionale Sync trug die Loeschung
#   zurueck — damit war As echter State weg), und B praegt sich KEINE neue
#   Inkarnation (der own-Branch von ensureDoc lief frueher auch fuer 0 Byte).
# Danach Original zurueckspielen und normalen Merge nachweisen.
param([string]$RunId = ("r14-" + (Get-Date -Format "yyyyMMdd-HHmmss")))

. "C:\tmp\qollab-test\harness\harness.ps1"
. "C:\tmp\qollab-test\harness\harness-ext-disc.ps1"

$szenario        = 'r14'
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
$mB2  = "B2-$RunId"
$mA2  = "A2-$RunId"

try {
    H-DEPLOY
    H-RESET $RunId
    H-NOTE-CLEAN @('AliveA.md','AliveB.md')
    H-WRITE-NOTE 'a' 'AliveA.md' $script:HarnessBaseText
    H-WATCH start

    H-START 'a'
    H-EDIT 'a' 'AliveA.md' ($script:HarnessBaseText + "ALIVE-A-$RunId")
    $script:_qA = Join-Path $script:HarnessVaultA '.qollab'
    H-WAIT { @(Get-ChildItem $script:_qA -Filter 'AliveA.md.*.yjs' -EA 0).Count -gt 0 } 240 | Out-Null
    $cidA = @(H-CLIENTID 'a' 'AliveA.md')[0]
    TA 'plugin-aktiv-A' ($null -ne $cidA) $cidA '8-hex'

    # Konvergierter Ausgangszustand mit EINER Inkarnation.
    H-SETUP-SHARED $note $mA $mB
    $script:_qB = Join-Path $script:HarnessVaultB '.qollab'
    $cidB = @(H-CLIENTID 'b' $note | Where-Object { $_ -ne $cidA })[0]
    TA 'plugin-aktiv-B' ($null -ne $cidB) $cidB '8-hex'
    TA 'clientIds-verschieden' ($cidA -ne $cidB) "$cidA / $cidB" 'ungleich'

    # Positives Gegensignal #1: beide Beitraege stehen beidseits, je einmal.
    TA 'setup-A-in-B' ((H-COUNT 'b' $note $mA) -eq 1) (H-COUNT 'b' $note $mA) '1'
    TA 'setup-B-in-A' ((H-COUNT 'a' $note $mB) -eq 1) (H-COUNT 'a' $note $mB) '1'
    TA 'setup-geteilte-guid' ((H-VERIFY 'a' $note).guid -eq (H-VERIFY 'b' $note).guid) (H-VERIFY 'b' $note).guid (H-VERIFY 'a' $note).guid
    $null = H-INV 'vor-0byte'

    # ── Die Manipulation ────────────────────────────────────────────────────
    $fremdRel  = ".qollab/$note.$cidA.yjs"
    $fremdFull = Join-Path $script:HarnessVaultB $fremdRel
    $ownRel    = ".qollab/$note.$cidB.yjs"
    $ownFull   = Join-Path $script:HarnessVaultB $ownRel

    TA 'fremd-sidecar-in-B-vorhanden' (Test-Path $fremdFull) (Test-Path $fremdFull) '$true'
    $guidOwnVor   = H-SIDECAR-GUID 'b' $ownRel
    $guidFremdVor = H-SIDECAR-GUID 'b' $fremdRel
    $anzahlVor    = @(Get-ChildItem $script:_qB -Filter "$note.*.yjs" -EA 0).Count
    $backup       = Join-Path $script:HarnessRunDir "backup-$note.$cidA.yjs"
    Copy-Item $fremdFull $backup -Force
    Write-Host "[R14] Backup $((Get-Item $backup).Length) B, guid-fremd=$guidFremdVor guid-own=$guidOwnVor anzahl=$anzahlVor"

    $ownMtimeVor = (Get-Item $ownFull).LastWriteTimeUtc
    [IO.File]::WriteAllBytes($fremdFull, @())
    TA '0byte-geschrieben' ((Get-Item $fremdFull).Length -eq 0) (Get-Item $fremdFull).Length '0'

    H-EDIT 'b' $note ((H-READ 'b' $note) + "`n$mB2")
    $script:_ownFull = $ownFull
    $script:_ownMtimeVor = $ownMtimeVor
    $mergeLief = $false
    try {
        H-WAIT { (Get-Item $script:_ownFull -EA 0).LastWriteTimeUtc -gt $script:_ownMtimeVor } 240 | Out-Null
        $mergeLief = $true
    } catch { $mergeLief = $false }
    TA 'B-hat-nach-manipulation-gearbeitet' $mergeLief $mergeLief '$true'

    $ruhe = H-QUIET-MAX -Sek 45 -MaxSec 300
    TA 'ruhe-nach-manipulation' $ruhe $ruhe '$true'

    # ── Kern-Asserts ────────────────────────────────────────────────────────
    TA '0byte-datei-nicht-geloescht' (Test-Path $fremdFull) (Test-Path $fremdFull) '$true'
    $lenNach = if (Test-Path $fremdFull) { (Get-Item $fremdFull).Length } else { -1 }
    TA '0byte-datei-unveraendert' ($lenNach -eq 0) $lenNach '0'
    $guidOwnNach = H-SIDECAR-GUID 'b' $ownRel
    TA 'keine-neue-inkarnation' ($guidOwnNach -eq $guidOwnVor) $guidOwnNach $guidOwnVor
    $anzahlNach = @(Get-ChildItem $script:_qB -Filter "$note.*.yjs" -EA 0).Count
    TA 'sidecar-anzahl-unveraendert' ($anzahlNach -eq $anzahlVor) $anzahlNach $anzahlVor
    TA 'text-A-ueberlebt' ((H-COUNT 'b' $note $mA)  -eq 1) (H-COUNT 'b' $note $mA)  '1'
    TA 'text-B-ueberlebt' ((H-COUNT 'b' $note $mB)  -eq 1) (H-COUNT 'b' $note $mB)  '1'
    TA 'text-B2-erfasst'  ((H-COUNT 'b' $note $mB2) -eq 1) (H-COUNT 'b' $note $mB2) '1'
    $null = H-INV 'nach-0byte'

    # ── Original zurueckspielen + positives Gegensignal #2 ──────────────────
    Copy-Item $backup $fremdFull -Force
    $null = H-QUIET-MAX -Sek 30 -MaxSec 240
    TA 'nach-restore-A-noch-1x' ((H-COUNT 'b' $note $mA) -eq 1) (H-COUNT 'b' $note $mA) '1'

    $aSide = Join-Path $script:_qA "$note.$cidA.yjs"
    $aMtimeVor = (Get-Item $aSide).LastWriteTimeUtc
    H-EDIT 'a' $note ((H-READ 'a' $note) + "`n$mA2")
    $script:_aSide = $aSide; $script:_aMtimeVor = $aMtimeVor
    H-WAIT { (Get-Item $script:_aSide -EA 0).LastWriteTimeUtc -gt $script:_aMtimeVor } 240 | Out-Null
    H-SYNC-ONE 'a->b' ".qollab/$note.$cidA.yjs" | Out-Null
    $script:_note2 = $note; $script:_mA2 = $mA2
    $ctrlOk = $false
    try { H-WAIT { (H-COUNT 'b' $script:_note2 $script:_mA2) -ge 1 } 180 | Out-Null; $ctrlOk = $true } catch {}
    TA 'kontrolle2-merge-funktioniert' $ctrlOk $ctrlOk '$true'
    TA 'kontrolle2-A2-1x' ((H-COUNT 'b' $note $mA2) -eq 1) (H-COUNT 'b' $note $mA2) '1'
    TA 'kontrolle2-keine-duplikate' (((H-COUNT 'b' $note $mA) -eq 1) -and ((H-COUNT 'b' $note $mB) -eq 1) -and ((H-COUNT 'b' $note $mB2) -eq 1)) `
        "$(H-COUNT 'b' $note $mA)/$(H-COUNT 'b' $note $mB)/$(H-COUNT 'b' $note $mB2)" '1/1/1'

    $v = H-VERIFY 'b' $note
    TA 'crdt-markerCount-A-1' ((Get-MC $v.markerCounts $mA) -eq 1) (Get-MC $v.markerCounts $mA) '1'
    $null = H-INV 'nach-restore'

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
