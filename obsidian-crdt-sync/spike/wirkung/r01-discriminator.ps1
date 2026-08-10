# R-0.1 — Konvergenz beidseitiger Edits (P0 aus realtest-plan.md)
#
#   „Beide bearbeiten dieselbe Note an verschiedenen Stellen, synchronisieren,
#    warten je einen Poll ab. Erwartet: Beide Texte auf beiden Geraeten, jeder
#    genau einmal, Dateien am Ende SHA-gleich."
#
# Gefahren wird der Fall OHNE vorher etablierte gemeinsame Inkarnation: beide
# Geraete haben dieselbe .md (Datei-Sync vor der Qollab-Installation) und
# editieren, bevor je eine Sidecar gereist ist. Genau diese Lage ist beim ersten
# Aufsetzen der Normalfall — und sie ist beim Aufbau von r14 (Lauf
# r14-20260730-224211) aufgefallen, deshalb hier als eigenes Szenario mit drei
# Wiederholungen.
#
# Der Sync liefert wie in der Realitaet Sidecar UND .md (H-SYNC -beide, yjs vor md).
# Achtung: KEIN Parameter namens $N — PowerShell-Variablen sind case-insensitiv,
# ein [int]$N kollidiert mit der Schleifenvariablen $n (Fehlschlag in
# r01-20260730-230436).
param([string]$RunId = ("r01-" + (Get-Date -Format "yyyyMMdd-HHmmss")), [int]$Anzahl = 3)

. "C:\tmp\qollab-test\harness\harness.ps1"
. "C:\tmp\qollab-test\harness\harness-ext.ps1"

$szenario        = 'r01disc'
$verdictOverride = $null
$klr             = ''
$runAsserts      = [System.Collections.Generic.List[hashtable]]::new()
$befunde         = [System.Collections.Generic.List[object]]::new()

function TA([string]$N2,[bool]$Ok,[string]$Ist='',[string]$Soll='') {
    $runAsserts.Add(@{name=$N2;ok=$Ok;ist=[string]$Ist;soll=[string]$Soll})
    if ($Ok) { Write-Host "[OK] $N2" } else { Write-Host "[FAIL] $N2 ist='$Ist' soll='$Soll'" }
}
function Sha256F([string]$P) {
    if (-not (Test-Path $P)) { return 'MISSING' }
    (Get-FileHash $P -Algorithm SHA256).Hash
}

$notes = @(1..$Anzahl | ForEach-Object { "Split-$_.md" })

try {
    H-DEPLOY
    H-RESET $RunId
    H-NOTE-CLEAN @($notes + @('AliveA.md'))
    foreach ($n in $notes) {
        H-WRITE-NOTE 'a' $n $script:HarnessBaseText
        H-WRITE-NOTE 'b' $n $script:HarnessBaseText
    }
    H-WRITE-NOTE 'a' 'AliveA.md' $script:HarnessBaseText
    H-WATCH start

    H-START 'a'
    H-EDIT 'a' 'AliveA.md' ($script:HarnessBaseText + "ALIVE-A-$RunId")
    $script:_qA = Join-Path $script:HarnessVaultA '.qollab'
    H-WAIT { @(Get-ChildItem $script:_qA -Filter 'AliveA.md.*.yjs' -EA 0).Count -gt 0 } 240 | Out-Null
    H-START 'b'
    $script:_qB = Join-Path $script:HarnessVaultB '.qollab'

    foreach ($n in $notes) {
        $mA = "AAA-$RunId-$n"
        $mB = "BBB-$RunId-$n"
        # Beide editieren, BEVOR irgendetwas gesynct wurde.
        H-EDIT 'a' $n ($script:HarnessBaseText + $mA)
        H-EDIT 'b' $n ($script:HarnessBaseText + $mB)
        $script:_n = $n
        H-WAIT {
            (@(Get-ChildItem $script:_qA -Filter "$($script:_n).*.yjs" -EA 0).Count -gt 0) -and
            (@(Get-ChildItem $script:_qB -Filter "$($script:_n).*.yjs" -EA 0).Count -gt 0)
        } 240 | Out-Null
        $gA = H-SIDECAR-GUID 'a' ".qollab/$((Get-ChildItem $script:_qA -Filter "$n.*.yjs")[0].Name)"
        $gB = H-SIDECAR-GUID 'b' ".qollab/$((Get-ChildItem $script:_qB -Filter "$n.*.yjs")[0].Name)"
        $befunde.Add([ordered]@{ note=$n; guidA=$gA; guidB=$gB; splitBrain=($gA -ne $gB) })
        Write-Host "[R01] $n guidA=$gA guidB=$gB split=$($gA -ne $gB)"
    }

    # Datei-Sync in beide Richtungen (Sidecar vor .md, wie H-SYNC -beide).
    H-SYNC 'a->b' -beide
    H-SYNC 'b->a' -beide
    $ruhe1 = H-QUIET-MAX -Sek 45 -MaxSec 300
    H-SYNC 'a->b' -beide
    H-SYNC 'b->a' -beide
    $ruhe2 = H-QUIET-MAX -Sek 45 -MaxSec 300
    TA 'ruhe-erreicht' ($ruhe1 -and $ruhe2) "$ruhe1/$ruhe2" '$true/$true'

    foreach ($n in $notes) {
        $mA = "AAA-$RunId-$n"
        $mB = "BBB-$RunId-$n"
        $cAA = H-COUNT 'a' $n $mA; $cAB = H-COUNT 'a' $n $mB
        $cBA = H-COUNT 'b' $n $mA; $cBB = H-COUNT 'b' $n $mB
        Write-Host "[R01] $n  A:[A=$cAA B=$cAB]  B:[A=$cBA B=$cBB]"
        TA "$n-A-hat-A-1x" ($cAA -eq 1) $cAA '1'
        TA "$n-A-hat-B-1x" ($cAB -eq 1) $cAB '1'
        TA "$n-B-hat-A-1x" ($cBA -eq 1) $cBA '1'
        TA "$n-B-hat-B-1x" ($cBB -eq 1) $cBB '1'
        TA "$n-sha-gleich" ((Sha256F (Join-Path $script:HarnessVaultA $n)) -eq (Sha256F (Join-Path $script:HarnessVaultB $n))) `
            (Sha256F (Join-Path $script:HarnessVaultB $n)) (Sha256F (Join-Path $script:HarnessVaultA $n))
    }

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
         befunde=@($befunde); artefakte=$artefakte }
if ($rdir) { try { $vo | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $rdir 'verdict.json') -Encoding UTF8 } catch { Write-Host "[WARN] verdict.json: $_" } }
$reason = switch ($verdict) { 'PASS'{'alle Asserts gruen'} 'INCONCLUSIVE'{$klr} default{"$($failA.Count) Assert(s) fehlgeschlagen"} }
Write-Host "VERDICT: $verdict $szenario $reason"
if ($verdict -ne 'PASS' -and $rdir) {
    $zip   = Join-Path $script:HarnessRunsDir "$RunId-evidenz.zip"
    $toZip = @($rdir) + @($script:HarnessVaultA,$script:HarnessVaultB | Where-Object { Test-Path $_ })
    try { Compress-Archive -Path $toZip -DestinationPath $zip -Force; Write-Host "[EVIDENZ] $zip" } catch { Write-Host "[WARN] ZIP: $_" }
}
