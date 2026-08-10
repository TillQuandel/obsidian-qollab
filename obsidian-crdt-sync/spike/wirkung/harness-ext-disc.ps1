# harness-ext.ps1 — Zusatz-Helfer fuer die Realtest-Batterie R-1.x
# Dot-Source NACH harness.ps1:
#   . C:\tmp\qollab-test\harness\harness.ps1
#   . C:\tmp\qollab-test\harness\harness-ext.ps1
#
# Enthaelt ausschliesslich NEUE Funktionen — harness.ps1 bleibt unveraendert,
# die bestehenden zwoelf Runner sind davon nicht betroffen.

$script:sampleJob = $null

# ─────────────────────────────────────────────────────────────────────────────
# H-SYNC-ONE <a->b|b->a> <relPfad>: kopiert GENAU eine Datei (oder ein Glob im
# Blattnamen) von einem Vault in den anderen. Anders als H-SYNC, das den ganzen
# .qollab-Baum bzw. alle *.md mitzieht — fuer R-1.1 ist genau das entscheidend:
# die Fremd-Sidecar darf reisen, die .md NICHT.
# ─────────────────────────────────────────────────────────────────────────────
function H-SYNC-ONE {
    param(
        [Parameter(Mandatory,Position=0)][ValidateSet('a->b','b->a')][string]$Direction,
        [Parameter(Mandatory,Position=1)][string]$RelPath
    )
    if ($Direction -eq 'a->b') { $src = $script:HarnessVaultA; $dst = $script:HarnessVaultB }
    else                       { $src = $script:HarnessVaultB; $dst = $script:HarnessVaultA }

    $srcFull = Join-Path $src $RelPath
    $relDir  = Split-Path $RelPath -Parent
    $hits    = @(Get-ChildItem -Path $srcFull -File -Force -ErrorAction SilentlyContinue)
    if ($hits.Count -eq 0) {
        _HLog "H-SYNC-ONE $Direction $RelPath — KEINE Quelldatei gefunden"
        return 0
    }
    foreach ($h in $hits) {
        $target = if ($relDir) { Join-Path (Join-Path $dst $relDir) $h.Name } else { Join-Path $dst $h.Name }
        $tdir   = Split-Path $target -Parent
        if (-not (Test-Path $tdir)) { New-Item -ItemType Directory -Force $tdir | Out-Null }
        Copy-Item $h.FullName $target -Force
    }
    _HLog "H-SYNC-ONE $Direction $RelPath -> $($hits.Count) Datei(en)"
    return $hits.Count
}

# ─────────────────────────────────────────────────────────────────────────────
# H-DEL-ONE <vault> <relPfad>: loescht Datei(en) (Glob erlaubt) in einem Vault.
# Simuliert die Loesch-Haelfte eines sync-vermittelten Renames.
# ─────────────────────────────────────────────────────────────────────────────
function H-DEL-ONE {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$RelPath
    )
    $vp    = _HVaultPath $Vault
    $full  = Join-Path $vp $RelPath
    $items = @(Get-ChildItem -Path $full -File -Force -ErrorAction SilentlyContinue)
    foreach ($i in $items) { Remove-Item -Force $i.FullName }
    _HLog "H-DEL-ONE $Vault $RelPath -> $($items.Count) geloescht"
    return $items.Count
}

# ─────────────────────────────────────────────────────────────────────────────
# H-INV <label>: Inventar aller .qollab-Dateien beider Vaults (rel. Pfad, Groesse,
# mtime). Haengt je eine JSON-Zeile an runs/<runId>/inventar.jsonl und gibt die
# Eintraege zurueck.
# ─────────────────────────────────────────────────────────────────────────────
function H-INV {
    param([Parameter(Mandatory)][string]$Label)
    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($v in @('a','b')) {
        $q = Join-Path (_HVaultPath $v) '.qollab'
        if (-not (Test-Path $q)) { continue }
        Get-ChildItem $q -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $out.Add([ordered]@{
                label = $Label
                vault = $v
                rel   = $_.FullName.Substring($q.Length).TrimStart('\')
                size  = $_.Length
                mtime = $_.LastWriteTimeUtc.ToString('o')
            })
        }
    }
    if ($script:HarnessRunDir) {
        $f = Join-Path $script:HarnessRunDir 'inventar.jsonl'
        foreach ($e in $out) { Add-Content -Path $f -Value ($e | ConvertTo-Json -Compress) }
    }
    _HLog "H-INV $Label -> $($out.Count) Sidecar(s)"
    return $out
}

# ─────────────────────────────────────────────────────────────────────────────
# H-CLIENTID <vault> <note>: die 8-Hex-Client-IDs aller Sidecars dieser Note.
# ─────────────────────────────────────────────────────────────────────────────
function H-CLIENTID {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$Note
    )
    $q    = Join-Path (_HVaultPath $Vault) '.qollab'
    $full = Join-Path $q $Note
    $dir  = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { return @() }
    $base = Split-Path $Note -Leaf
    $re   = "^$([regex]::Escape($base))\.([0-9a-f]{8})\.yjs$"
    @(Get-ChildItem $dir -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match $re } |
        ForEach-Object { [regex]::Match($_.Name, $re).Groups[1].Value } |
        Sort-Object -Unique)
}

# ─────────────────────────────────────────────────────────────────────────────
# Sidecar-Kopf lesen. Drei Formen, wie decodeStateFile() in state-file.ts:151:
#   QLB2  [ 'QLB2' (4) | FNV-1a ueber GUID+Update (4, LE) | GUID (16) | Update ]  Kopf 24
#   QLB1  [ 'QLB1' (4) |                                  | GUID (16) | Update ]  Kopf 20
#   v0.1  headerlos — keine GUID, kein Nachweis
# Ein Leser, der nur QLB1 kennt, meldet auf einer QLB2-Datei `guid = $null` und
# haelt ihre Kopf-Bytes fuer Nutzlast. Genau das war hier bis zum Formatwechsel der Fall.
#
# _HFnv1a: FNV-1a, 32 Bit — dieselbe Rechnung wie hashBytes() in state-file.ts:84
# (Offset-Basis 2166136261 = 0x811c9dc5, Prime 16777619 = 0x01000193).
# ─────────────────────────────────────────────────────────────────────────────
function _HFnv1a([byte[]]$B, [int]$Ab) {
    $h = [uint32]2166136261
    for ($i = $Ab; $i -lt $B.Length; $i++) {
        $h = [uint32]($h -bxor $B[$i])
        $h = [uint32](([uint64]$h * [uint64]16777619) -band [uint64]4294967295)
    }
    return $h
}

# ─────────────────────────────────────────────────────────────────────────────
# H-SIDECAR-INFO <vault> <relSidecarPfad>: volle Auskunft ueber eine Hilfsdatei.
#   format  'QLB2' | 'QLB1' | 'v0.1' | '(fehlt)'
#   guid    32 Hex aus dem Kopf, $null bei v0.1 / fehlender / abgeschnittener Datei
#   hashOk  $true/$false bei QLB2, $null wo es keinen Nachweis zu pruefen gibt
#   kopf    24 | 20 | 0
# ─────────────────────────────────────────────────────────────────────────────
function H-SIDECAR-INFO {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$RelPath
    )
    $r = [ordered]@{ format = '(fehlt)'; guid = $null; hashOk = $null; kopf = 0; groesse = 0 }
    $p = Join-Path (_HVaultPath $Vault) $RelPath
    if (-not (Test-Path $p)) { return [pscustomobject]$r }
    $b = [IO.File]::ReadAllBytes($p)
    $r.groesse = $b.Length
    $magic = if ($b.Length -ge 4) { [Text.Encoding]::ASCII.GetString($b, 0, 4) } else { '' }

    if ($magic -eq 'QLB2') {
        $r.format = 'QLB2'
        # Zu kurz fuer den eigenen Kopf: abgeschnittene QLB2-Datei, keine Legacy.
        if ($b.Length -lt 24) { $r.hashOk = $false; return [pscustomobject]$r }
        $r.kopf   = 24
        $r.guid   = ($b[8..23] | ForEach-Object { $_.ToString('x2') }) -join ''
        $r.hashOk = ((_HFnv1a $b 8) -eq [BitConverter]::ToUInt32($b, 4))
        return [pscustomobject]$r
    }
    if ($magic -eq 'QLB1' -and $b.Length -ge 20) {
        $r.format = 'QLB1'
        $r.kopf   = 20
        $r.guid   = ($b[4..19] | ForEach-Object { $_.ToString('x2') }) -join ''
        return [pscustomobject]$r
    }
    # Headerlos — inkl. QLB1-Magic mit weniger als 20 Bytes, wie state-file.ts:172.
    $r.format = 'v0.1'
    return [pscustomobject]$r
}

# ─────────────────────────────────────────────────────────────────────────────
# H-SIDECAR-GUID <vault> <relSidecarPfad>: GUID (32 Hex) aus dem Kopf — QLB2 wie
# QLB1. $null bei fehlender Datei, headerloser v0.1-Datei und bei einer
# QLB2-Datei, die ihren eigenen Nachweis verfehlt (dann ist auch ihre GUID
# unbeglaubigt). Fuer „keine neue Inkarnation gepraegt".
# Format und Hash-Ergebnis selbst: H-SIDECAR-INFO.
# ─────────────────────────────────────────────────────────────────────────────
function H-SIDECAR-GUID {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$RelPath
    )
    $i = H-SIDECAR-INFO $Vault $RelPath
    if ($i.hashOk -eq $false) { return $null }
    return $i.guid
}

# ─────────────────────────────────────────────────────────────────────────────
# H-QUIET-MAX [-Sek 40] [-MaxSec 240]: wie H-QUIET, aber BEGRENZT. H-QUIET laeuft
# bei anhaltendem Churn endlos — genau das ist in R-1.5 der zu messende Befund.
# Rueckgabe: $true wenn Ruhe erreicht, $false bei Timeout.
# ─────────────────────────────────────────────────────────────────────────────
function _HSnapshotAll {
    $result = @{}
    foreach ($vault in @($script:HarnessVaultA, $script:HarnessVaultB)) {
        try {
            Get-ChildItem $vault -Filter '*.md' -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch [regex]::Escape('.obsidian') -and
                           $_.FullName -notmatch [regex]::Escape('.trash') -and
                           $_.FullName -notmatch [regex]::Escape('.qollab') } |
            ForEach-Object { $result[$_.FullName] = [string]$_.LastWriteTimeUtc.Ticks + ':' + [string]$_.Length }
        } catch {}
        $qDir = Join-Path $vault '.qollab'
        if (Test-Path $qDir) {
            try {
                Get-ChildItem $qDir -Filter '*.yjs' -Recurse -ErrorAction SilentlyContinue |
                ForEach-Object { $result[$_.FullName] = [string]$_.LastWriteTimeUtc.Ticks + ':' + [string]$_.Length }
            } catch {}
        }
    }
    return $result
}

function H-QUIET-MAX {
    param([int]$Sek = 40, [int]$MaxSec = 240)
    $prev       = _HSnapshotAll
    $lastChange = [DateTime]::UtcNow
    $deadline   = [DateTime]::UtcNow.AddSeconds($MaxSec)
    _HLog "H-QUIET-MAX: warte auf ${Sek}s Ruhe (max ${MaxSec}s)..."
    while (([DateTime]::UtcNow - $lastChange).TotalSeconds -lt $Sek) {
        if ([DateTime]::UtcNow -gt $deadline) {
            _HLog "H-QUIET-MAX: TIMEOUT nach ${MaxSec}s — dauerhafter Churn."
            return $false
        }
        Start-Sleep -Seconds 2
        $curr = _HSnapshotAll
        $changed = $false
        foreach ($k in $curr.Keys) { if (-not $prev.ContainsKey($k) -or $prev[$k] -ne $curr[$k]) { $changed = $true; break } }
        if (-not $changed) { foreach ($k in $prev.Keys) { if (-not $curr.ContainsKey($k)) { $changed = $true; break } } }
        if ($changed) { $lastChange = [DateTime]::UtcNow; _HLog 'H-QUIET-MAX: Aenderung, Timer zurueck.' }
        $prev = $curr
    }
    _HLog "H-QUIET-MAX: ${Sek}s Ruhe bestaetigt."
    return $true
}

# ─────────────────────────────────────────────────────────────────────────────
# H-CHURN [-Sek 70]: zaehlt ueber <Sek> Sekunden, wie oft sich der Datei-Snapshot
# beider Vaults aendert. 0 = keine Aktivitaet (kein Lösch-/Neuanlage-Pingpong).
# Laeuft immer die volle Zeit — bewusst kein Abbruch, das ist die Messung.
# ─────────────────────────────────────────────────────────────────────────────
function H-CHURN {
    param([int]$Sek = 70)
    $prev  = _HSnapshotAll
    $end   = [DateTime]::UtcNow.AddSeconds($Sek)
    $count = 0
    $log   = [System.Collections.Generic.List[string]]::new()
    while ([DateTime]::UtcNow -lt $end) {
        Start-Sleep -Seconds 2
        $curr = _HSnapshotAll
        foreach ($k in $curr.Keys) {
            if (-not $prev.ContainsKey($k)) { $count++; $log.Add("NEU  $k") }
            elseif ($prev[$k] -ne $curr[$k]) { $count++; $log.Add("AEND $k") }
        }
        foreach ($k in $prev.Keys) { if (-not $curr.ContainsKey($k)) { $count++; $log.Add("WEG  $k") } }
        $prev = $curr
    }
    _HLog "H-CHURN ${Sek}s -> $count Aenderung(en)"
    if ($script:HarnessRunDir -and $log.Count -gt 0) {
        Add-Content -Path (Join-Path $script:HarnessRunDir 'churn.log') -Value $log
    }
    return $count
}

# ─────────────────────────────────────────────────────────────────────────────
# H-SETUP-SHARED <note> <markerA> <markerB>: stellt einen konvergierten Zustand
# mit EINER geteilten Inkarnation her. Vorbedingung: A laeuft, B laeuft NICHT.
#
# Warum nicht einfach beide editieren und dann syncen: praegen beide Geraete
# unabhaengig eine eigene Inkarnation derselben Note, zerstoert der Datei-Sync
# den lokalen Beitrag der Seite, deren .md ueberschrieben wird — der
# modify-Handler difft die fremde .md gegen den eigenen Doc, und die
# inkompatible Fremd-Inkarnation traegt `mergePendingForeign` nicht bei (nur
# GUID-gleiche Siblings). Gemessen in Lauf r14-20260730-224211 (Byte-Timeline).
# Das ist die offene Op-Provenienz-Frage (GH-11), nicht Gegenstand von R-1.x —
# der Aufbau muss sie deshalb umgehen, sonst testet man sie statt des Szenarios.
#
# Ablauf: A praegt die Inkarnation, .md + Sidecar reisen zu B, Bs Startup-Sweep
# adoptiert sie (kein zweites Praegen), erst DANACH editiert B.
# ─────────────────────────────────────────────────────────────────────────────
function H-SETUP-SHARED {
    param(
        [Parameter(Mandatory,Position=0)][string]$Note,
        [Parameter(Mandatory,Position=1)][string]$MarkerA,
        [Parameter(Mandatory,Position=2)][string]$MarkerB
    )
    $script:_ssNote = $Note
    $script:_ssMA   = $MarkerA
    $script:_ssMB   = $MarkerB

    H-EDIT 'a' $Note ($script:HarnessBaseText + $MarkerA)
    H-WAIT { @(Get-ChildItem (Join-Path $script:HarnessVaultA '.qollab') -Filter "$($script:_ssNote).*.yjs" -EA 0).Count -gt 0 } 240 | Out-Null

    H-SYNC 'a->b' -beide
    H-START 'b'
    # Adoption durch den Startup-Sweep: Bs .md traegt danach As Marker, und Bs
    # eigene Sidecar traegt DIESELBE GUID (kein Split-Brain).
    H-WAIT { (H-COUNT 'b' $script:_ssNote $script:_ssMA) -ge 1 } 180 | Out-Null

    H-EDIT 'b' $Note ((H-READ 'b' $Note) + "`n$MarkerB")
    H-WAIT { @(Get-ChildItem (Join-Path $script:HarnessVaultB '.qollab') -Filter "$($script:_ssNote).*.yjs" -EA 0).Count -ge 2 } 240 | Out-Null

    H-SYNC 'b->a' -beide
    H-WAIT { (H-COUNT 'a' $script:_ssNote $script:_ssMB) -ge 1 } 180 | Out-Null
    $null = H-QUIET-MAX -Sek 25 -MaxSec 240
    _HLog "H-SETUP-SHARED ${Note}: konvergiert (A=$MarkerA, B=$MarkerB)."
}

# ─────────────────────────────────────────────────────────────────────────────
# H-CONVERGE-MAX <note> [<runden>=4]: wie H-CONVERGE, aber ohne das unbegrenzte
# H-QUIET am Ende (das bei anhaltendem Churn nie zurueckkehrt). Rueckgabe:
# $true wenn geteilte GUID erreicht.
# ─────────────────────────────────────────────────────────────────────────────
function H-CONVERGE-MAX {
    param(
        [Parameter(Mandatory,Position=0)][string]$Note,
        [Parameter(Position=1)][int]$Runden = 4
    )
    for ($r = 1; $r -le $Runden; $r++) {
        H-SYNC 'a->b' -beide
        H-SYNC 'b->a' -beide
        $null = H-QUIET-MAX -Sek 20 -MaxSec 180
        if (H-ASSERT-SHARED-GUID $Note) {
            _HLog "H-CONVERGE-MAX ${Note}: geteilte GUID nach Runde $r."
            return $true
        }
        _HLog "H-CONVERGE-MAX ${Note}: Runde $r ohne geteilte GUID."
    }
    return $false
}

# ─────────────────────────────────────────────────────────────────────────────
# H-START-FILE <vault> <note>: oeffnet Obsidian DIREKT auf einer Note
# (obsidian://open?path=<abs Dateipfad>). Fuer R-1.3: der file-open-Trigger soll
# so frueh wie moeglich feuern, um das Sweep-Fenster zu treffen.
# ─────────────────────────────────────────────────────────────────────────────
function H-START-FILE {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$Note
    )
    $vaultPath = _HVaultPath $Vault
    $noteFull  = Join-Path $vaultPath $Note
    $wsJson    = Join-Path $vaultPath '.obsidian\workspace.json'
    $startTime = [DateTime]::UtcNow
    $uri       = "obsidian://open?path=$([uri]::EscapeDataString($noteFull))"
    _HLog "H-START-FILE $noteFull"
    Start-Process $uri
    $deadline = $startTime.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-Path $wsJson) {
            if ((Get-Item $wsJson).LastWriteTimeUtc -gt $startTime) {
                _HLog 'H-START-FILE: workspace.json aktualisiert — Fenster geladen.'
                return
            }
        }
    }
    throw "H-START-FILE Timeout fuer $noteFull"
}

# ─────────────────────────────────────────────────────────────────────────────
# H-SAMPLE start <pfade...> / H-SAMPLE stop
# Feinsampler (200 ms) fuer wenige .md-Dateien: schreibt ts/exists/len/content
# nach runs/<runId>/samples.jsonl. Beweismittel fuer „lag der Write-Back VOR dem
# zweiten Edit?" — die 2-s-Timeline von H-WATCH ist dafuer zu grob.
# ─────────────────────────────────────────────────────────────────────────────
function H-SAMPLE {
    param(
        [Parameter(Mandatory,Position=0)][ValidateSet('start','stop')][string]$Action,
        [Parameter(Position=1)][string[]]$Paths
    )
    if ($Action -eq 'start') {
        if ($script:sampleJob) { Write-Host '[H-SAMPLE] laeuft bereits'; return }
        if (-not $script:HarnessRunDir) { throw '[H-SAMPLE] H-RESET muss vorher laufen.' }
        $file = Join-Path $script:HarnessRunDir 'samples.jsonl'
        $joined = ($Paths -join '|')
        $script:sampleJob = Start-Job -ArgumentList $joined, $file -ScriptBlock {
            param($joined, $file)
            $paths = $joined -split '\|'
            while ($true) {
                $ts = [DateTime]::UtcNow.ToString('o')
                $lines = @()
                foreach ($p in $paths) {
                    if (Test-Path $p) {
                        try {
                            $txt = [IO.File]::ReadAllText($p)
                            $lines += (@{ ts=$ts; path=$p; exists=$true; len=$txt.Length; content=$txt } | ConvertTo-Json -Compress)
                        } catch {
                            $lines += (@{ ts=$ts; path=$p; exists=$true; err='read' } | ConvertTo-Json -Compress)
                        }
                    } else {
                        $lines += (@{ ts=$ts; path=$p; exists=$false } | ConvertTo-Json -Compress)
                    }
                }
                if ($lines.Count) { Add-Content -Path $file -Value ($lines -join "`n") }
                Start-Sleep -Milliseconds 200
            }
        }
        Write-Host "[H-SAMPLE] Job $($script:sampleJob.Id) -> $file"
    } else {
        if ($script:sampleJob) {
            Stop-Job  -Job $script:sampleJob -ErrorAction SilentlyContinue
            Remove-Job -Job $script:sampleJob -Force -ErrorAction SilentlyContinue
            $script:sampleJob = $null
            Write-Host '[H-SAMPLE] gestoppt.'
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# H-NOTE-CLEAN <namen...>: entfernt Test-Notes (und deren Sidecars) aus BEIDEN
# Vaults. Nur unter C:\tmp\qollab-test — der Produktiv-Vault wird nie beruehrt.
# ─────────────────────────────────────────────────────────────────────────────
function H-NOTE-CLEAN {
    param([Parameter(Mandatory)][string[]]$Names)
    foreach ($v in @($script:HarnessVaultA, $script:HarnessVaultB)) {
        if ($v -notlike 'C:\tmp\qollab-test\*') { throw "H-NOTE-CLEAN: unerwarteter Vault-Pfad $v" }
        foreach ($n in $Names) {
            $p = Join-Path $v $n
            if (Test-Path $p) { Remove-Item -Force $p }
            $sc = Join-Path (Join-Path $v '.qollab') "$n.*.yjs"
            @(Get-ChildItem -Path $sc -File -Force -ErrorAction SilentlyContinue) |
                ForEach-Object { Remove-Item -Force $_.FullName }
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# H-WRITE-NOTE <vault> <note> <text>: wie H-EDIT, aber ohne Log-Rauschen und
# nutzbar bevor eine RunId existiert (Vorbereitung vor H-RESET/H-START).
# ─────────────────────────────────────────────────────────────────────────────
function H-WRITE-NOTE {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$Note,
        [Parameter(Mandatory,Position=2)][string]$Text
    )
    $p   = Join-Path (_HVaultPath $Vault) $Note
    $dir = Split-Path $p -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    [IO.File]::WriteAllText($p, $Text, [Text.UTF8Encoding]::new($false))
}

# ─────────────────────────────────────────────────────────────────────────────
# H-READ <vault> <note>: Dateiinhalt als String ('' wenn nicht vorhanden).
# H-COUNT <vault> <note> <marker>: Vorkommen eines Markers im Dateiinhalt.
# ─────────────────────────────────────────────────────────────────────────────
function H-READ {
    param([Parameter(Mandatory,Position=0)][string]$Vault,[Parameter(Mandatory,Position=1)][string]$Note)
    $p = Join-Path (_HVaultPath $Vault) $Note
    if (-not (Test-Path $p)) { return '' }
    [IO.File]::ReadAllText($p)
}

function H-COUNT {
    param(
        [Parameter(Mandatory,Position=0)][string]$Vault,
        [Parameter(Mandatory,Position=1)][string]$Note,
        [Parameter(Mandatory,Position=2)][string]$Marker
    )
    $t = H-READ $Vault $Note
    if ($t -eq '') { return 0 }
    ([regex]::Matches($t, [regex]::Escape($Marker))).Count
}
