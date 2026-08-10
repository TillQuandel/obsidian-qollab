# R-1.1 — Doc-Vorlauf (Task 16, der schwerste Fund aus fund-endzustaende.md)
#
# Aufbau:
#   A editiert Note N und synchronisiert NUR die Sidecar (nicht die .md) zu B.
#   B hat N nie geoeffnet, hat keinen eigenen State. Sofort danach: zwei Edits in
#   B kurz hintereinander, ohne dass dazwischen ein 30-s-Poll laeuft.
#   Erwartet: As Zeile ueberlebt in BEIDEN Vaults, genau einmal.
#   Vor dem Fix verschwand sie beim zweiten Tippen auf beiden Geraeten.
#
# Warum die .md NICHT mitsynchronisiert wird: sonst traegt Bs Datei As Zeile
# bereits, es entsteht gar kein Vorlauf. Deshalb H-SYNC-ONE statt H-SYNC.
#
# Drei Versuche mit verschiedenen Tastenpausen (1.0 / 2.5 / 6.0 s), weil nur die
# Messung zeigt, welche Haelfte von Task 16 greift:
#   - c1 traegt As Zeile  -> der Write-Back im modify-Pfad hat gefeuert (Haelfte 1)
#   - c1 traegt sie nicht -> der Doc ist der Datei voraus, jetzt haengt alles an
#                            der korrekten Diff-Basis (localDiffBase, Haelfte 2)
# Ein Versuch, bei dem schon VOR dem ersten Edit gemergt wurde (Poll war
# schneller), ist ungueltig — dann existierte der Vorlauf-Zustand nie.
param([string]$RunId = ("r11-" + (Get-Date -Format "yyyyMMdd-HHmmss")))

. "C:\tmp\qollab-test\harness\harness.ps1"
. "C:\tmp\qollab-test\harness\harness-ext.ps1"

$szenario        = 'r11'
$verdictOverride = $null
$klr             = ''
$runAsserts      = [System.Collections.Generic.List[hashtable]]::new()
$befunde         = [System.Collections.Generic.List[object]]::new()

function TA([string]$N,[bool]$Ok,[string]$Ist='',[string]$Soll='') {
    $runAsserts.Add(@{name=$N;ok=$Ok;ist=[string]$Ist;soll=[string]$Soll})
    if ($Ok) { Write-Host "[OK] $N" } else { Write-Host "[FAIL] $N ist='$Ist' soll='$Soll'" }
}
function Sha256F([string]$P) {
    if (-not (Test-Path $P)) { return 'MISSING' }
    (Get-FileHash $P -Algorithm SHA256).Hash
}

$notes = @('Vorlauf-1.md','Vorlauf-2.md','Vorlauf-3.md')
$gaps  = @(1.0, 2.5, 6.0)

try {
    H-DEPLOY
    H-RESET $RunId
    H-NOTE-CLEAN @($notes + @('AliveA.md','AliveB.md'))

    # Ausgangstexte anlegen — in BEIDEN Vaults identisch, damit kein Vorab-Diff
    # existiert. AliveA/AliveB nur je einseitig (Lebendbeweis pro Geraet).
    foreach ($n in $notes) {
        H-WRITE-NOTE 'a' $n $script:HarnessBaseText
        H-WRITE-NOTE 'b' $n $script:HarnessBaseText
    }
    H-WRITE-NOTE 'a' 'AliveA.md' $script:HarnessBaseText
    H-WRITE-NOTE 'b' 'AliveB.md' $script:HarnessBaseText

    H-WATCH start
    H-SAMPLE start @(
        (Join-Path $script:HarnessVaultB 'Vorlauf-1.md'),
        (Join-Path $script:HarnessVaultB 'Vorlauf-2.md'),
        (Join-Path $script:HarnessVaultB 'Vorlauf-3.md')
    )

    # ── Gerät A ──────────────────────────────────────────────────────────────
    H-START 'a'
    H-EDIT 'a' 'AliveA.md' ($script:HarnessBaseText + "ALIVE-A-$RunId")
    $script:_qA = Join-Path $script:HarnessVaultA '.qollab'
    H-WAIT { @(Get-ChildItem $script:_qA -Filter 'AliveA.md.*.yjs' -EA 0).Count -gt 0 } 240
    $cidA = @(H-CLIENTID 'a' 'AliveA.md')
    TA 'plugin-aktiv-A' ($cidA.Count -eq 1) "$($cidA -join ',')" '1 clientId'
    $cidA = $cidA[0]

    # A editiert alle drei Notes; die Sidecars liegen danach bereit.
    for ($i = 0; $i -lt $notes.Count; $i++) {
        $n = $notes[$i]
        H-EDIT 'a' $n ($script:HarnessBaseText + "AAA-$RunId-$i")
    }
    $script:_needA = @($notes | ForEach-Object { "$_.$cidA.yjs" })
    H-WAIT {
        $ok = $true
        foreach ($f in $script:_needA) { if (-not (Test-Path (Join-Path $script:_qA $f))) { $ok = $false } }
        $ok
    } 240

    # ── Gerät B ──────────────────────────────────────────────────────────────
    H-START 'b'
    H-EDIT 'b' 'AliveB.md' ($script:HarnessBaseText + "ALIVE-B-$RunId")
    $script:_qB = Join-Path $script:HarnessVaultB '.qollab'
    H-WAIT { @(Get-ChildItem $script:_qB -Filter 'AliveB.md.*.yjs' -EA 0).Count -gt 0 } 240
    $cidB = @(H-CLIENTID 'b' 'AliveB.md')
    TA 'plugin-aktiv-B' ($cidB.Count -eq 1) "$($cidB -join ',')" '1 clientId'
    $cidB = $cidB[0]
    TA 'clientIds-verschieden' ($cidA -ne $cidB) "$cidA / $cidB" 'ungleich'

    $null = H-INV 'vor-vorlauf'

    # ── Die drei Versuche ────────────────────────────────────────────────────
    for ($i = 0; $i -lt $notes.Count; $i++) {
        $n   = $notes[$i]
        $mA  = "AAA-$RunId-$i"
        $mB1 = "B1-$RunId-$i"
        $mB2 = "B2-$RunId-$i"

        # Vorbedingung: B kennt die Note nur als eigene Datei, ohne jede Sidecar.
        $sidecarsB = @(Get-ChildItem $script:_qB -Filter "$n.*.yjs" -EA 0).Count
        $preText   = H-READ 'b' $n

        H-SYNC-ONE 'a->b' ".qollab/$n.$cidA.yjs" | Out-Null
        $tSync = [DateTime]::UtcNow

        # SOFORT der erste Edit — der Poll darf nicht zuvorkommen.
        $c0 = H-READ 'b' $n
        H-EDIT 'b' $n ($c0 + "`n$mB1")
        $tE1 = [DateTime]::UtcNow

        Start-Sleep -Milliseconds ([int]($gaps[$i] * 1000))

        # Zweiter Edit auf dem, was jetzt in der Datei steht (= Editor-Puffer).
        $c1 = H-READ 'b' $n
        H-EDIT 'b' $n ($c1 + "`n$mB2")
        $tE2 = [DateTime]::UtcNow

        $praemerged = $c0.Contains($mA)          # Poll war schneller -> ungueltig
        $writeBack  = $c1.Contains($mA)          # Haelfte 1 hat gefeuert
        $leg = if ($praemerged) { 'ungueltig-praemerged' }
               elseif ($writeBack) { 'writeback' } else { 'vorlauf' }

        $befunde.Add([ordered]@{
            note          = $n
            leg           = $leg
            sidecarsBvor  = $sidecarsB
            preTextGleich = ($preText -eq $script:HarnessBaseText)
            gapSoll       = $gaps[$i]
            dtSyncEdit1Ms = [int]($tE1 - $tSync).TotalMilliseconds
            dtEdit1Edit2Ms= [int]($tE2 - $tE1).TotalMilliseconds
        })
        Write-Host "[R11] $n leg=$leg dt(sync->e1)=$([int]($tE1-$tSync).TotalMilliseconds)ms dt(e1->e2)=$([int]($tE2-$tE1).TotalMilliseconds)ms"

        TA "vorbedingung-keine-sidecar-B-$i" ($sidecarsB -eq 0) $sidecarsB '0'
        TA "kein-poll-zwischen-edits-$i" ((($tE2 - $tE1).TotalSeconds) -lt 30) "$([math]::Round(($tE2-$tE1).TotalSeconds,1))s" '<30s'
    }

    # Alles einschwingen lassen (mind. ein Poll-Zyklus).
    $ruheB = H-QUIET-MAX -Sek 45 -MaxSec 300
    TA 'ruhe-nach-edits' $ruheB $ruheB '$true'

    # ── Asserts auf Gerät B ──────────────────────────────────────────────────
    for ($i = 0; $i -lt $notes.Count; $i++) {
        $n = $notes[$i]
        TA "B-A-zeile-1x-$i"  ((H-COUNT 'b' $n "AAA-$RunId-$i") -eq 1) (H-COUNT 'b' $n "AAA-$RunId-$i") '1'
        TA "B-B1-1x-$i"       ((H-COUNT 'b' $n "B1-$RunId-$i")  -eq 1) (H-COUNT 'b' $n "B1-$RunId-$i")  '1'
        TA "B-B2-1x-$i"       ((H-COUNT 'b' $n "B2-$RunId-$i")  -eq 1) (H-COUNT 'b' $n "B2-$RunId-$i")  '1'
    }

    # ── Rueckweg + Konvergenz ────────────────────────────────────────────────
    # Bis zu drei Runden: jede Seite mergt nach dem Empfang selbst weiter, ein
    # einzelner Hin-und-Rueckweg ist deshalb nicht zwingend deckungsgleich.
    $rounds = 0
    $allEq  = $false
    $ruheK  = $true
    do {
        H-SYNC 'b->a' -beide
        $null = H-QUIET-MAX -Sek 20 -MaxSec 180
        H-SYNC 'a->b' -beide
        $ruheK = H-QUIET-MAX -Sek 25 -MaxSec 300
        $allEq = $true
        foreach ($n in $notes) {
            if ((Sha256F (Join-Path $script:HarnessVaultA $n)) -ne (Sha256F (Join-Path $script:HarnessVaultB $n))) { $allEq = $false }
        }
        $rounds++
    } while (-not $allEq -and $rounds -lt 3)
    TA 'ruhe-nach-konvergenz' $ruheK $ruheK '$true'
    Write-Host "[R11] Konvergenz-Runden: $rounds allEq=$allEq"

    for ($i = 0; $i -lt $notes.Count; $i++) {
        $n = $notes[$i]
        TA "A-A-zeile-1x-$i" ((H-COUNT 'a' $n "AAA-$RunId-$i") -eq 1) (H-COUNT 'a' $n "AAA-$RunId-$i") '1'
        TA "A-B1-1x-$i"      ((H-COUNT 'a' $n "B1-$RunId-$i")  -eq 1) (H-COUNT 'a' $n "B1-$RunId-$i")  '1'
        TA "A-B2-1x-$i"      ((H-COUNT 'a' $n "B2-$RunId-$i")  -eq 1) (H-COUNT 'a' $n "B2-$RunId-$i")  '1'

        $shaA = Sha256F (Join-Path $script:HarnessVaultA $n)
        $shaB = Sha256F (Join-Path $script:HarnessVaultB $n)
        TA "sha-gleich-$i" ($shaA -eq $shaB) $shaB $shaA

        # CRDT-Provenienz: As Zeile darf nur unter EINER Client-ID stehen.
        $v = H-VERIFY 'b' $n
        $mc = Get-MC $v.markerCounts "AAA-$RunId-$i"
        TA "crdt-markerCount-$i" ($mc -eq 1) $mc '1'
        $line = $v.perLineClients | Where-Object { $_.line -match [regex]::Escape("AAA-$RunId-$i") } | Select-Object -First 1
        $nCl  = if ($line) { @($line.clientIDs).Count } else { 0 }
        TA "crdt-provenienz-1-client-$i" ($nCl -eq 1) $nCl '1'

        $vA = H-VERIFY 'a' $n
        TA "guid-gleich-$i" ($vA.guid -eq $v.guid) $v.guid $vA.guid
    }

    # ── Positives Gegensignal: der Merge-Pfad funktioniert nachweislich ──────
    # Ein negativer Befund allein waere mehrdeutig — hier wird gezeigt, dass ein
    # frischer Fremd-Stand ueber den Poll wirklich ankommt.
    $ctrl = "KONTROLLE-$RunId"
    H-EDIT 'a' 'Vorlauf-1.md' ((H-READ 'a' 'Vorlauf-1.md') + "`n$ctrl")
    H-WAIT { @(Get-ChildItem $script:_qA -Filter 'Vorlauf-1.md.*.yjs' -EA 0).Count -gt 0 } 240
    H-SYNC-ONE 'a->b' ".qollab/Vorlauf-1.md.$cidA.yjs" | Out-Null
    $script:_ctrl = $ctrl
    $ctrlOk = $false
    try {
        H-WAIT { (H-COUNT 'b' 'Vorlauf-1.md' $script:_ctrl) -ge 1 } 150 | Out-Null
        $ctrlOk = $true
    } catch { $ctrlOk = $false }
    TA 'kontrolle-merge-kommt-an' $ctrlOk $ctrlOk '$true'
    TA 'kontrolle-1x' ((H-COUNT 'b' 'Vorlauf-1.md' $ctrl) -eq 1) (H-COUNT 'b' 'Vorlauf-1.md' $ctrl) '1'

    $null = H-INV 'nach-vorlauf'

    # Gueltigkeit: mindestens ein Versuch muss den Vorlauf-Zustand erreicht haben.
    $gueltig = @($befunde | Where-Object { $_.leg -ne 'ungueltig-praemerged' })
    if ($gueltig.Count -eq 0) {
        $verdictOverride = 'INCONCLUSIVE'
        $klr = 'Kein Versuch erreichte den Vorlauf-Zustand (Poll war jedes Mal schneller).'
    }

} catch {
    Write-Host "[ERROR] $_"
    if (-not $verdictOverride) { $verdictOverride = 'FAIL' }
} finally {
    H-SAMPLE stop
    H-WATCH stop
}

# ── VERDICT ──────────────────────────────────────────────────────────────────
$failA   = @($runAsserts | Where-Object { -not $_.ok })
$verdict = if ($failA.Count -gt 0) { 'FAIL' } elseif ($verdictOverride) { $verdictOverride } else { 'PASS' }
$rdir    = $script:HarnessRunDir

$artefakte = if ($rdir -and (Test-Path $rdir)) { @(Get-ChildItem $rdir | Select-Object -Exp FullName) } else { @() }
$vo = @{
    szenario = $szenario; verdict = $verdict
    asserts  = @($runAsserts | ForEach-Object { [ordered]@{name=$_.name;ok=$_.ok;ist=$_.ist;soll=$_.soll} })
    befunde  = @($befunde)
    artefakte = $artefakte
}
if ($rdir) { try { $vo | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $rdir 'verdict.json') -Encoding UTF8 } catch { Write-Host "[WARN] verdict.json: $_" } }

$reason = switch ($verdict) { 'PASS'{'alle Asserts gruen'} 'INCONCLUSIVE'{$klr} default{"$($failA.Count) Assert(s) fehlgeschlagen"} }
Write-Host "VERDICT: $verdict $szenario $reason"

if ($verdict -ne 'PASS' -and $rdir) {
    $zip   = Join-Path $script:HarnessRunsDir "$RunId-evidenz.zip"
    $toZip = @($rdir) + @($script:HarnessVaultA,$script:HarnessVaultB | Where-Object { Test-Path $_ })
    try { Compress-Archive -Path $toZip -DestinationPath $zip -Force; Write-Host "[EVIDENZ] $zip" }
    catch { Write-Host "[WARN] ZIP: $_" }
}
