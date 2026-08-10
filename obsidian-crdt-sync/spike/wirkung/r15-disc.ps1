# R-1.5 — Sync-vermittelter Rename (Task 15)
#
#   alt.md ist auf beiden Geraeten etabliert, beide Sidecars liegen vor.
#   A benennt nach neu.md um. Der Datei-Sync stellt B das als LOESCHEN von alt.md
#   plus NEUANLAGE von neu.md zu. B editiert neu.md weiter.
#   Erwartet: Bs Edit kommt an; .qollab/neu.md.<A>.yjs existiert weiterhin auf
#   beiden Seiten (der Tombstone gilt seit Fix A nur fuer das Paar (Pfad, GUID) —
#   vorher haette das Delete von alt.md die GUID global beerdigt und die frisch
#   angekommene Sidecar unter neu.md als Leiche geloescht); kein Lösch-/Neuanlage-
#   Pingpong im Poll-Takt.
param([string]$RunId = ("r15-" + (Get-Date -Format "yyyyMMdd-HHmmss")))

. "C:\tmp\qollab-test\harness\harness.ps1"
. "C:\tmp\qollab-test\harness\harness-ext.ps1"

$szenario        = 'r15'
$verdictOverride = $null
$klr             = ''
$runAsserts      = [System.Collections.Generic.List[hashtable]]::new()
$notizen         = [System.Collections.Generic.List[string]]::new()

function TA([string]$N,[bool]$Ok,[string]$Ist='',[string]$Soll='') {
    $runAsserts.Add(@{name=$N;ok=$Ok;ist=[string]$Ist;soll=[string]$Soll})
    if ($Ok) { Write-Host "[OK] $N" } else { Write-Host "[FAIL] $N ist='$Ist' soll='$Soll'" }
}

$alt = 'alt.md'
$neu = 'neu.md'
$mA  = "AAA-$RunId"
$mB  = "BBB-$RunId"
$mB2 = "B2-$RunId"

try {
    H-DEPLOY
    H-RESET $RunId
    H-NOTE-CLEAN @($alt, $neu, 'AliveA.md', 'AliveB.md')
    H-WRITE-NOTE 'a' $alt $script:HarnessBaseText
    H-WRITE-NOTE 'b' $alt $script:HarnessBaseText
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
    H-SETUP-SHARED $alt $mA $mB
    $script:_qB = Join-Path $script:HarnessVaultB '.qollab'
    $cidB = @(H-CLIENTID 'b' $alt | Where-Object { $_ -ne $cidA })[0]
    TA 'plugin-aktiv-B' ($null -ne $cidB) $cidB '8-hex'
    TA 'konvergenz-alt-md' ((H-VERIFY 'a' $alt).guid -eq (H-VERIFY 'b' $alt).guid) (H-VERIFY 'b' $alt).guid (H-VERIFY 'a' $alt).guid
    TA 'kontrolle-A-in-B' ((H-COUNT 'b' $alt $mA) -eq 1) (H-COUNT 'b' $alt $mA) '1'
    TA 'kontrolle-B-in-A' ((H-COUNT 'a' $alt $mB) -eq 1) (H-COUNT 'a' $alt $mB) '1'
    $guidAlt = (H-VERIFY 'a' $alt).guid
    $null = H-INV 'vor-rename'

    # ── A benennt um ────────────────────────────────────────────────────────
    # GEMESSEN (Lauf r15-20260730-225118): Eine reine Dateisystem-Umbenennung bei
    # laufender App liefert Obsidian NICHT als rename-Event, sondern als
    # delete+create — der delete-Handler raeumte dabei alle Sidecars von alt.md ab.
    # Der Obsidian-UI-Rename (den der Plan meint) ruft dagegen den rename-Handler
    # auf, der die Sidecars mitzieht und die GUID erhaelt. Per Skript ist die UI
    # nicht bedienbar, deshalb wird ihr ERGEBNIS nachgestellt: erst die Sidecars,
    # dann die .md. Der delete-Handler findet dann nichts mehr zum Abraeumen und
    # setzt nur den pfadgebundenen Tombstone (alt.md, guid) — genau die Lage, in
    # der Fix A greifen muss.
    foreach ($f in @(Get-ChildItem $script:_qA -Filter "$alt.*.yjs" -EA 0)) {
        $suffix = $f.Name.Substring($alt.Length)
        Move-Item $f.FullName (Join-Path $script:_qA "$neu$suffix") -Force
    }
    Move-Item (Join-Path $script:HarnessVaultA $alt) (Join-Path $script:HarnessVaultA $neu) -Force
    $notizen.Add('A-seitige Umbenennung: Sidecars vor der .md verschoben (Nachstellung des UI-Rename-Ergebnisses; externer FS-Rename liefert Obsidian als delete+create — gemessen).')
    $null = H-QUIET-MAX -Sek 25 -MaxSec 180
    TA 'A-sidecar-unter-neu-name' (Test-Path (Join-Path $script:_qA "$neu.$cidA.yjs")) (Test-Path (Join-Path $script:_qA "$neu.$cidA.yjs")) '$true'
    TA 'A-keine-sidecar-unter-alt' (@(Get-ChildItem $script:_qA -Filter "$alt.*.yjs" -EA 0).Count -eq 0) (@(Get-ChildItem $script:_qA -Filter "$alt.*.yjs" -EA 0).Count) '0'

    # ── Der Sync stellt B delete+create zu ──────────────────────────────────
    H-SYNC-ONE 'a->b' $neu | Out-Null
    H-SYNC-ONE 'a->b' ".qollab/$neu.*.yjs" | Out-Null
    H-DEL-ONE 'b' $alt | Out-Null
    H-DEL-ONE 'b' ".qollab/$alt.*.yjs" | Out-Null
    $tSync = [DateTime]::UtcNow

    # ── B editiert neu.md ───────────────────────────────────────────────────
    $script:_neu = $neu
    H-WAIT { Test-Path (Join-Path $script:HarnessVaultB $script:_neu) } 240 | Out-Null
    Start-Sleep -Seconds 3
    H-EDIT 'b' $neu ((H-READ 'b' $neu) + "`n$mB2")
    $ruhe = H-QUIET-MAX -Sek 45 -MaxSec 300
    TA 'ruhe-nach-B-edit' $ruhe $ruhe '$true'

    $null = H-INV 'nach-rename-b'

    # ── Kern-Asserts auf B ──────────────────────────────────────────────────
    TA 'B-fremd-sidecar-neu-existiert' (Test-Path (Join-Path $script:_qB "$neu.$cidA.yjs")) (Test-Path (Join-Path $script:_qB "$neu.$cidA.yjs")) '$true'
    TA 'B-eigene-sidecar-neu-existiert' (Test-Path (Join-Path $script:_qB "$neu.$cidB.yjs")) (Test-Path (Join-Path $script:_qB "$neu.$cidB.yjs")) '$true'
    TA 'B-text-A-1x'  ((H-COUNT 'b' $neu $mA)  -eq 1) (H-COUNT 'b' $neu $mA)  '1'
    TA 'B-text-B-1x'  ((H-COUNT 'b' $neu $mB)  -eq 1) (H-COUNT 'b' $neu $mB)  '1'
    TA 'B-text-B2-1x' ((H-COUNT 'b' $neu $mB2) -eq 1) (H-COUNT 'b' $neu $mB2) '1'

    # ── Rueckweg: Bs Edit muss bei A ankommen ───────────────────────────────
    H-SYNC-ONE 'b->a' ".qollab/$neu.$cidB.yjs" | Out-Null
    $script:_mB2 = $mB2
    $backOk = $false
    try { H-WAIT { (H-COUNT 'a' $script:_neu $script:_mB2) -ge 1 } 180 | Out-Null; $backOk = $true } catch {}
    TA 'A-erhaelt-B-edit' $backOk $backOk '$true'
    TA 'A-text-B2-1x' ((H-COUNT 'a' $neu $mB2) -eq 1) (H-COUNT 'a' $neu $mB2) '1'
    TA 'A-fremd-sidecar-neu-existiert' (Test-Path (Join-Path $script:_qA "$neu.$cidB.yjs")) (Test-Path (Join-Path $script:_qA "$neu.$cidB.yjs")) '$true'
    TA 'A-eigene-sidecar-neu-existiert' (Test-Path (Join-Path $script:_qA "$neu.$cidA.yjs")) (Test-Path (Join-Path $script:_qA "$neu.$cidA.yjs")) '$true'

    # GUID muss die der Inkarnation geblieben sein (Rename = gleiche Inkarnation).
    $guidNeuA = (H-VERIFY 'a' $neu).guid
    TA 'guid-ueberlebt-rename' ($guidNeuA -eq $guidAlt) $guidNeuA $guidAlt

    # ── Kein Pingpong im Poll-Takt ──────────────────────────────────────────
    $null = H-QUIET-MAX -Sek 20 -MaxSec 180
    $churn = H-CHURN -Sek 75
    TA 'kein-pingpong-75s' ($churn -eq 0) $churn '0'

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
         notizen=@($notizen); artefakte=$artefakte }
if ($rdir) { try { $vo | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $rdir 'verdict.json') -Encoding UTF8 } catch { Write-Host "[WARN] verdict.json: $_" } }
$reason = switch ($verdict) { 'PASS'{'alle Asserts gruen'} 'INCONCLUSIVE'{$klr} default{"$($failA.Count) Assert(s) fehlgeschlagen"} }
Write-Host "VERDICT: $verdict $szenario $reason"
if ($verdict -ne 'PASS' -and $rdir) {
    $zip   = Join-Path $script:HarnessRunsDir "$RunId-evidenz.zip"
    $toZip = @($rdir) + @($script:HarnessVaultA,$script:HarnessVaultB | Where-Object { Test-Path $_ })
    try { Compress-Archive -Path $toZip -DestinationPath $zip -Force; Write-Host "[EVIDENZ] $zip" } catch { Write-Host "[WARN] ZIP: $_" }
}
