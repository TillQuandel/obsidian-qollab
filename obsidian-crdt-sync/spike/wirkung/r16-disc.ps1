# R-1.6 — Zombie-Schutz (Nicht-Regression zu Task 15)
#
#   Note loeschen, gleichnamig mit anderem Inhalt neu anlegen, ERST DANACH die
#   alte Fremd-Sidecar nachliefern.
#   Erwartet: Der alte Inhalt taucht nicht auf. Traegt die alte Sidecar die
#   lexikografisch kleinere GUID, gewaenne sie ohne Tombstone den Tie-Break, und
#   switchToGuid/unionMerge zoege den toten Inhalt in die neue Note.
#
#   Positives Gegensignal: zeitgleich mit der alten Sidecar wird eine FRISCHE
#   Fremd-Sidecar einer Kontroll-Note zugestellt. Kommt deren Inhalt an, lief der
#   Poll nachweislich — „alter Inhalt taucht nicht auf" ist dann kein Artefakt
#   eines stillstehenden Plugins.
param([string]$RunId = ("r16-" + (Get-Date -Format "yyyyMMdd-HHmmss")))

. "C:\tmp\qollab-test\harness\harness.ps1"
. "C:\tmp\qollab-test\harness\harness-ext.ps1"

$szenario        = 'r16'
$verdictOverride = $null
$klr             = ''
$runAsserts      = [System.Collections.Generic.List[hashtable]]::new()

function TA([string]$N,[bool]$Ok,[string]$Ist='',[string]$Soll='') {
    $runAsserts.Add(@{name=$N;ok=$Ok;ist=[string]$Ist;soll=[string]$Soll})
    if ($Ok) { Write-Host "[OK] $N" } else { Write-Host "[FAIL] $N ist='$Ist' soll='$Soll'" }
}

$zn   = 'zombie.md'
$kn   = 'KontrolleZ.md'
$mA   = "AALT-$RunId"
$mB   = "BALT-$RunId"
$mNeu = "NEU-$RunId"
$mK   = "KTRL-$RunId"

try {
    H-DEPLOY
    H-RESET $RunId
    H-NOTE-CLEAN @($zn, $kn, 'AliveA.md', 'AliveB.md')
    foreach ($v in @('a','b')) {
        H-WRITE-NOTE $v $zn $script:HarnessBaseText
        H-WRITE-NOTE $v $kn $script:HarnessBaseText
    }
    H-WRITE-NOTE 'a' 'AliveA.md' $script:HarnessBaseText
    H-WRITE-NOTE 'b' 'AliveB.md' $script:HarnessBaseText
    H-WATCH start

    H-START 'a'
    H-EDIT 'a' 'AliveA.md' ($script:HarnessBaseText + "ALIVE-A-$RunId")
    $script:_qA = Join-Path $script:HarnessVaultA '.qollab'
    H-WAIT { @(Get-ChildItem $script:_qA -Filter 'AliveA.md.*.yjs' -EA 0).Count -gt 0 } 240 | Out-Null
    $cidA = @(H-CLIENTID 'a' 'AliveA.md')[0]
    TA 'plugin-aktiv-A' ($null -ne $cidA) $cidA '8-hex'
    # Kontroll-Note bekommt schon hier eine A-Sidecar; H-SETUP-SHARED synct sie
    # mit und Bs Startup-Sweep adoptiert sie.
    H-EDIT 'a' $kn ($script:HarnessBaseText + "KBASE-$RunId")
    H-WAIT { Test-Path (Join-Path $script:_qA "$kn.$cidA.yjs") } 240 | Out-Null

    # Konvergierter Ausgangszustand mit EINER geteilten Inkarnation.
    H-SETUP-SHARED $zn $mA $mB
    $script:_qB = Join-Path $script:HarnessVaultB '.qollab'
    $cidB = @(H-CLIENTID 'b' $zn | Where-Object { $_ -ne $cidA })[0]
    TA 'plugin-aktiv-B' ($null -ne $cidB) $cidB '8-hex'
    TA 'konvergenz-zombie' ((H-VERIFY 'a' $zn).guid -eq (H-VERIFY 'b' $zn).guid) (H-VERIFY 'b' $zn).guid (H-VERIFY 'a' $zn).guid
    $guidAlt = (H-VERIFY 'b' $zn).guid
    TA 'kontrolle-A-in-B' ((H-COUNT 'b' $zn $mA) -eq 1) (H-COUNT 'b' $zn $mA) '1'
    $null = H-INV 'vor-delete'

    # Die alte Fremd-Sidecar sichern — sie wird spaeter nachgeliefert.
    $fremdRel  = ".qollab/$zn.$cidA.yjs"
    $fremdFull = Join-Path $script:HarnessVaultB $fremdRel
    $backup    = Join-Path $script:HarnessRunDir "alt-$zn.$cidA.yjs"
    Copy-Item $fremdFull $backup -Force
    TA 'alte-sidecar-gesichert' ((Get-Item $backup).Length -gt 20) (Get-Item $backup).Length '>20'

    # ── Loeschen ────────────────────────────────────────────────────────────
    Remove-Item -Force (Join-Path $script:HarnessVaultB $zn)
    $script:_zn = $zn
    $deleteHandler = $false
    try {
        H-WAIT { @(Get-ChildItem $script:_qB -Filter "$($script:_zn).*.yjs" -EA 0).Count -eq 0 } 120 | Out-Null
        $deleteHandler = $true
    } catch { $deleteHandler = $false }
    TA 'delete-handler-hat-gefeuert' $deleteHandler $deleteHandler '$true'

    # ── Gleichnamige Neuanlage mit anderem Inhalt ───────────────────────────
    H-WRITE-NOTE 'b' $zn "# Neue Note`n`n"
    Start-Sleep -Seconds 4
    H-EDIT 'b' $zn "# Neue Note`n`n$mNeu`n"
    H-WAIT { Test-Path (Join-Path $script:_qB "$zn.$cidB.yjs") } 240 | Out-Null
    $guidNeu = H-SIDECAR-GUID 'b' ".qollab/$zn.$cidB.yjs"
    TA 'neue-inkarnation-eigene-guid' (($null -ne $guidNeu) -and ($guidNeu -ne $guidAlt)) "$guidNeu" "!= $guidAlt"
    Write-Host "[R16] guidAlt=$guidAlt guidNeu=$guidNeu (alt<neu: $($guidAlt -lt $guidNeu))"

    # ── Erst JETZT die alte Sidecar nachliefern + Kontroll-Signal ───────────
    $aKtrlSide = Join-Path $script:_qA "$kn.$cidA.yjs"
    $kMt = if (Test-Path $aKtrlSide) { (Get-Item $aKtrlSide).LastWriteTimeUtc } else { [DateTime]::MinValue }
    H-EDIT 'a' $kn ((H-READ 'a' $kn) + "`n$mK")
    $script:_aKtrlSide = $aKtrlSide; $script:_kMt = $kMt
    H-WAIT { (Get-Item $script:_aKtrlSide -EA 0).LastWriteTimeUtc -gt $script:_kMt } 240 | Out-Null

    Copy-Item $backup $fremdFull -Force
    # Copy-Item uebernimmt die mtime der Quelle. Die stale Datei traege damit
    # exakt (mtime,size) ihres Standes VOR dem Loeschen — und `hasChanged` im
    # Watcher vergleicht genau dieses Paar. Im ersten Lauf (r16-20260730-230006)
    # blieb der Trigger deshalb aus, die Datei lag unbeachtet herum und
    # „alter Inhalt taucht nicht auf" war ein Nicht-Ereignis statt eines
    # Nachweises. Ein echtes Sync-Tool schreibt die Datei neu, also frische mtime.
    (Get-Item $fremdFull).LastWriteTime = (Get-Date)
    H-SYNC-ONE 'a->b' ".qollab/$kn.$cidA.yjs" | Out-Null

    $script:_kn = $kn; $script:_mK = $mK
    $ktrlOk = $false
    try { H-WAIT { (H-COUNT 'b' $script:_kn $script:_mK) -ge 1 } 180 | Out-Null; $ktrlOk = $true } catch {}
    TA 'kontrolle-poll-lief' $ktrlOk $ktrlOk '$true'

    $ruhe = H-QUIET-MAX -Sek 45 -MaxSec 300
    TA 'ruhe-nach-nachlieferung' $ruhe $ruhe '$true'

    # ── Kern-Asserts ────────────────────────────────────────────────────────
    TA 'kein-alter-A-inhalt' ((H-COUNT 'b' $zn $mA) -eq 0) (H-COUNT 'b' $zn $mA) '0'
    TA 'kein-alter-B-inhalt' ((H-COUNT 'b' $zn $mB) -eq 0) (H-COUNT 'b' $zn $mB) '0'
    TA 'neuer-inhalt-1x'     ((H-COUNT 'b' $zn $mNeu) -eq 1) (H-COUNT 'b' $zn $mNeu) '1'
    $guidNach = H-SIDECAR-GUID 'b' ".qollab/$zn.$cidB.yjs"
    TA 'inkarnation-nicht-gewechselt' ($guidNach -eq $guidNeu) $guidNach $guidNeu
    # Dokumentierte Folge des Tombstones (C.3): die stale Fremd-Datei wird als
    # Leiche entfernt statt nur ignoriert.
    TA 'stale-sidecar-als-leiche-entfernt' (-not (Test-Path $fremdFull)) (Test-Path $fremdFull) '$false'

    $v = H-VERIFY 'b' $zn
    TA 'crdt-kein-alter-inhalt' (-not $v.text.Contains($mA)) ($v.text.Contains($mA)) '$false'

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
