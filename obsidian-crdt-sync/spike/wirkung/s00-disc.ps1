# S00 — Harness Smoke: deterministischer Reset + TESTPLAN Szenario 1
param([string]$RunId = ("s00-" + (Get-Date -Format "yyyyMMdd-HHmmss")))

. "C:\tmp\qollab-test\harness\harness.ps1"

$szenario       = 's00'
$verdictOverride = $null
$klr             = ''
$runAsserts      = [System.Collections.Generic.List[hashtable]]::new()

function TA([string]$N,[bool]$Ok,[string]$Ist='',[string]$Soll='') {
    $runAsserts.Add(@{name=$N;ok=$Ok;ist=[string]$Ist;soll=[string]$Soll})
    if ($Ok) { Write-Host "[OK] $N" } else { Write-Host "[FAIL] $N ist='$Ist' soll='$Soll'" }
}
function Sha256F([string]$P) {
    if (-not (Test-Path $P)) { return 'MISSING' }
    (Get-FileHash $P -Algorithm SHA256).Hash
}

try {
    H-DEPLOY
    H-RESET $RunId
    H-WATCH start

    $aEdit  = "A-EDIT-$RunId-1"
    $mdA    = Join-Path $script:HarnessVaultA 'Meetingprotokoll.md'
    $mdB    = Join-Path $script:HarnessVaultB 'Meetingprotokoll.md'
    $qDirA  = Join-Path $script:HarnessVaultA '.qollab'

    # H-START vault-a
    H-START 'a'

    # H-EDIT a: BASE + Marker
    H-EDIT 'a' 'Meetingprotokoll.md' ($script:HarnessBaseText + $aEdit)

    # H-WAIT: A-Sidecar existiert (90 s)
    H-WAIT {
        if (Test-Path $qDirA) {
            @(Get-ChildItem $qDirA -Filter 'Meetingprotokoll.md.*.yjs' -EA 0).Count -gt 0
        } else { $false }
    } 240

    # H-SYNC a->b -beide
    H-SYNC 'a->b' -beide

    # H-START vault-b
    H-START 'b'

    # H-WAIT: vault-b sha256 == vault-a (180 s)
    $script:_shaA = Sha256F $mdA
    H-WAIT {
        $p = Join-Path $script:HarnessVaultB 'Meetingprotokoll.md'
        (Test-Path $p) -and ((Get-FileHash $p -Algorithm SHA256).Hash -eq $script:_shaA)
    } 180

    # H-QUIET 60
    H-QUIET 60

    # ── ASSERTS ──────────────────────────────────────────────────────────
    $shaA2 = Sha256F $mdA
    $shaB  = Sha256F $mdB

    TA 'sha256-gleich' ($shaA2 -eq $shaB) $shaB $shaA2

    $cntA = (Select-String -Path $mdA -Pattern ([regex]::Escape($aEdit)) -AllMatches -EA 0).Matches.Count
    $cntB = (Select-String -Path $mdB -Pattern ([regex]::Escape($aEdit)) -AllMatches -EA 0).Matches.Count
    TA 'marker-A-1x' ($cntA -eq 1) $cntA '1'
    TA 'marker-B-1x' ($cntB -eq 1) $cntB '1'

    $vA = H-VERIFY 'a' 'Meetingprotokoll.md'
    $vB = H-VERIFY 'b' 'Meetingprotokoll.md'

    $mcA = Get-MC $vA.markerCounts $aEdit
    TA 'crdt-markerCount-A-1' ($mcA -eq 1) $mcA '1'

    $fcA = [IO.File]::ReadAllText($mdA)
    TA 'crdt-text-eq-md-A' ($vA.text -eq $fcA) "len=$($vA.textLen)" "len=$($fcA.Length)"

    TA 'guid-gleich' ($vA.guid -eq $vB.guid) $vB.guid $vA.guid

    $editLine = $vA.perLineClients | Where-Object { $_.line -match [regex]::Escape($aEdit) } | Select-Object -First 1
    $nClients = if ($editLine) { @($editLine.clientIDs).Count } else { 0 }
    TA 'perLineClients-editLine-1' ($nClients -eq 1) $nClients '1'

    # Timeline-Lueckenpruefung (Abstand <= 3 s)
    $tl = Join-Path $script:HarnessRunDir 'timeline.jsonl'
    if (Test-Path $tl) {
        $times = @(Get-Content $tl -EA 0 | ForEach-Object {
            try { ($_ | ConvertFrom-Json -EA 0).ts } catch {}
        } | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
        $maxGap = 0.0
        for ($i = 1; $i -lt $times.Count; $i++) {
            $gap = ([datetime]::Parse($times[$i], [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind) - [datetime]::Parse($times[$i-1], [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)).TotalSeconds
            if ($gap -gt $maxGap) { $maxGap = $gap }
        }
        TA 'timeline-gap-le-3s' ($maxGap -le 3) "$maxGap" '<=3'
    }

    # MD5 deploy check
    $rMd5 = (Get-FileHash (Join-Path $script:HarnessRepoDir 'main.js') -Algorithm MD5).Hash
    $dMd5 = (Get-FileHash (Join-Path $script:HarnessVaultA '.obsidian\plugins\qollab\main.js') -Algorithm MD5).Hash
    TA 'deploy-md5-ok' ($rMd5 -eq $dMd5) $dMd5 $rMd5

} catch {
    Write-Host "[ERROR] $_"
    if (-not $verdictOverride) { $verdictOverride = 'FAIL' }
} finally {
    H-WATCH stop
}

# ── VERDICT ──────────────────────────────────────────────────────────────
$failA   = @($runAsserts | Where-Object { -not $_.ok })
$verdict = if ($verdictOverride) { $verdictOverride } elseif ($failA.Count -gt 0) { 'FAIL' } else { 'PASS' }
$rdir    = $script:HarnessRunDir

$artefakte = if ($rdir -and (Test-Path $rdir)) {
    @(Get-ChildItem $rdir | Select-Object -Exp FullName)
} else { @() }

$vo = @{
    szenario  = $szenario; verdict = $verdict
    asserts   = @($runAsserts | ForEach-Object { [ordered]@{name=$_.name;ok=$_.ok;ist=$_.ist;soll=$_.soll} })
    artefakte = $artefakte
}
if ($rdir) { try { $vo | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $rdir 'verdict.json') -Encoding UTF8 } catch { Write-Host "[WARN] verdict.json: $_" } }

$reason = switch ($verdict) { 'PASS'{'alle Asserts gruen'} 'KNOWN-LIMIT'{$klr} default{"$($failA.Count) Assert(s) fehlgeschlagen"} }
Write-Host "VERDICT: $verdict $szenario $reason"

if ($verdict -eq 'FAIL' -and $rdir) {
    $zip   = Join-Path $script:HarnessRunsDir "$RunId-evidenz.zip"
    $toZip = @($rdir) + @($script:HarnessVaultA,$script:HarnessVaultB | Where-Object { Test-Path $_ })
    try { Compress-Archive -Path $toZip -DestinationPath $zip -Force; Write-Host "[EVIDENZ] $zip" }
    catch { Write-Host "[WARN] ZIP: $_" }
}
