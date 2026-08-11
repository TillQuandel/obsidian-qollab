# agent-t4-vorlauf.ps1 — DISKRIMINATOR fuer den r11-Befund (Doc-Vorlauf, Task 16).
#
# DIE FRAGE
# `r11` meldete am 2026-08-12 mit erhoehten Wartezeiten 8 rote Asserts: As Zeile
# fehlt in BEIDEN Vaults (`A-A-zeile-1x = 0`, `B-A-zeile-1x = 0`) — genau die
# Signatur, die laut r11-Kopfkommentar "vor dem Fix" auftrat. Das ist
# K.o.-Kriterium 1.
#
# Nur: `r11` schreibt EXTERN (`H-EDIT` = [IO.File]::WriteAllText bei laufendem
# Obsidian). Seit dem Herkunftstor (main.ts:329-335, Commit ae57907 vom
# 2026-08-04) wird so ein Inhalt GEPARKT und erst nach Fristablauf
# (PARK_FRIST_TICKS 4 x SCAN_INTERVAL_MS 30_000 = 120 s) per `unionMerge`
# nachgetragen. Der Runner laeuft damit ueber einen anderen Pfad als am
# 2026-08-03, wo seine Zusage aufgestellt wurde.
#
# DIESES SKRIPT faehrt dasselbe Szenario ueber den PROZESS-Schreibweg
# (`app.vault.modify` im Renderer). Damit ist jeder Schreibvorgang "eigen"
# (WriteProvenance umhuellt den DataAdapter), es wird nichts geparkt, und die
# Sidecar entsteht sofort statt nach 120 s.
#
#   Ergebnis "As Zeile ueberlebt"  -> r11s Rot ist ein Artefakt des Park-Pfades
#   Ergebnis "As Zeile fehlt"      -> echter Verlust, unabhaengig vom Schreibweg
#
# AUFBAU (aus dem Kopfkommentar von r11.ps1 uebernommen)
#   A editiert Note N und synchronisiert NUR die Sidecar zu B (die .md bewusst
#   NICHT — sonst traegt Bs Datei As Zeile schon und es entsteht gar kein
#   Vorlauf). B hat N nie mit dieser Historie gesehen. Sofort danach: zwei Edits
#   in B kurz hintereinander.
#   Erwartet: As Zeile ueberlebt in BEIDEN Vaults, genau einmal.

param(
    [Parameter(Mandatory)][ValidateSet('setup','basis','schlag','zeigen')][string]$Phase,
    [string]$Tag = 'lauf',
    [double]$Pause = 1.0,
    # STRIKTE VARIANTE: B legt die Notiz nur per `app.vault.create` an und praegt
    # damit KEINEN eigenen CRDT-State — gemessen erzeugt ein blosses `create`
    # keine Sidecar, erst ein `modify` tut es (agent-t2b.ps1:87-89).
    #
    # Erst damit ist r11s Vorbedingung zeichengleich: dort hat B die Notiz "nie
    # geoeffnet, hat keinen eigenen State". Im Normalmodus legt B sie selbst an
    # und traegt eine eigene Inkarnation — der Doc-Vorlauf ist derselbe, die
    # Erstkontakt-Lage nicht.
    [switch]$BOhneState,
    # GEGENTEST: Dieselbe Schrittfolge, aber EXTERN geschrieben
    # ([IO.File]::WriteAllText bei laufendem Obsidian) — der Weg, den `r11`,
    # `r13`, `r14`, `r15` ueber `H-EDIT` nehmen. Damit ist jeder Schreibvorgang
    # fuer das Herkunftstor fremd und wird geparkt.
    #
    # Zweck: Wenn derselbe Aufbau ueber den Prozess-Weg sauber laeuft und ueber
    # den externen Weg bricht, liegt es am SCHREIBWEG und nicht am Szenario. Das
    # ist der A/B-Test zu den Batterie-Befunden vom 2026-08-12.
    [switch]$Extern
)

$ErrorActionPreference = 'Stop'
$Wurzel = 'C:\tmp\qollab-test'
$Vp     = @{ a = "$Wurzel\vault-a"; b = "$Wurzel\vault-b" }
$NOTE   = 'Vorlauf-T4.md'
$NL     = [string][char]10
$BASIS  = (@('t4-base-0','t4-base-1','t4-base-2') -join $NL) + $NL
$MA     = "AAA-$Tag"
$MB1    = "BBB1-$Tag"
$MB2    = "BBB2-$Tag"
$Log    = "$Wurzel\runs\agent-t4-vorlauf-$Tag.log"

function L([string]$m) {
    $z = "$([DateTime]::Now.ToString('HH:mm:ss')) $m"
    Add-Content -Path $Log -Value $z; Write-Host $z
}
function Cdp([string]$Hint, [string]$Js) {
    $t = (& node "$Wurzel\harness\cdp.mjs" eval $Hint $Js 2>&1 | Out-String).Trim()
    try { return ($t | ConvertFrom-Json) } catch { L "[CDP-ROH $Hint] $t"; return $null }
}
function Setze([string]$v, [string]$Text) {
    if ($Extern) {
        # Derselbe Weg wie `H-EDIT` in den Runnern: ein fremder Prozess schreibt
        # in die Datei, waehrend Obsidian laeuft. Das Herkunftstor parkt das.
        $p = Join-Path $Vp[$v] $NOTE
        [IO.File]::WriteAllText($p, $Text, [Text.UTF8Encoding]::new($false))
        L "[SETZE $v] EXTERN n=$($Text.Length)"
        return
    }
    $j = 'const p=' + ($NOTE | ConvertTo-Json) + '; const t=' + ($Text | ConvertTo-Json) + ';' +
         'let f=app.vault.getAbstractFileByPath(p);' +
         'if(!f){ await app.vault.create(p,t); return {weg:"create",n:t.length}; }' +
         'await app.vault.modify(f,t); return {weg:"modify",n:t.length};'
    $r = Cdp "vault-$v" $j
    L "[SETZE $v] $($r.wert.weg) n=$($r.wert.n)"
}
function Lies([string]$v) {
    $p = Join-Path $Vp[$v] $NOTE
    if (-not (Test-Path $p)) { return '(fehlt)' }
    [IO.File]::ReadAllText($p)
}
function Side([string]$v) { @(Get-ChildItem (Join-Path $Vp[$v] '.qollab') -Filter "$NOTE.*.yjs" -Force -EA 0) }
function Warte([scriptblock]$B, [int]$Sek, [string]$Was) {
    $t0 = [DateTime]::UtcNow
    while (([DateTime]::UtcNow - $t0).TotalSeconds -lt $Sek) {
        if (& $B) { L "[WARTE] $Was ok nach $([int](([DateTime]::UtcNow-$t0).TotalSeconds))s"; return $true }
        Start-Sleep -Seconds 2
    }
    L "[WARTE] $Was TIMEOUT ${Sek}s"; return $false
}
# NUR die Sidecar reist — das ist der Kern des Aufbaus.
function KopiereSidecar([string]$Von, [string]$Nach) {
    $q = Join-Path $Vp[$Nach] '.qollab'
    if (-not (Test-Path $q)) { New-Item -ItemType Directory -Force $q | Out-Null }
    $n = 0; foreach ($f in (Side $Von)) { Copy-Item $f.FullName (Join-Path $q $f.Name) -Force; $n++ }
    L "[SIDECAR] $Von -> $Nach : $n"
}
function Zaehle([string]$t, [string]$m) { ([regex]::Matches($t, [regex]::Escape($m))).Count }

function Guard2 {
    $procs = @(Get-Process 'Obsidian' -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { L '[Guard] kein Obsidian'; return $true }
    $titel = @($procs | Where-Object { $_.MainWindowTitle } | Select-Object -Exp MainWindowTitle)
    L "[Guard] $($procs.Count) Prozess(e): $($titel -join ' | ')"
    $fremd = @($titel | Where-Object { $_ -notmatch 'vault-a|vault-b|vault-c|vault-d' })
    if ($fremd.Count -gt 0) { L "[Guard] ABBRUCH — fremdes Fenster: $($fremd -join ' | ')"; return $false }
    return $true
}
function Prod-Nicht-Offen {
    $j = Get-Content "$env:APPDATA\obsidian\obsidian.json" -Raw | ConvertFrom-Json
    foreach ($p in $j.vaults.PSObject.Properties) {
        if ($p.Value.path -like '*Obsidian_Vault*' -and $p.Value.open -eq $true) {
            throw 'ABBRUCH: produktiver Vault steht auf open:true — erst Phase sicherung fahren.'
        }
    }
    L '[Sicherheit] produktiver Vault steht NICHT auf open:true'
}

switch ($Phase) {

  'setup' {
    Prod-Nicht-Offen
    if (-not (Guard2)) { throw 'Guard blockiert' }
    Stop-Process -Name 'Obsidian' -Force -EA 0
    Start-Sleep -Seconds 10
    . "$Wurzel\harness\harness.ps1"
    . "$Wurzel\harness\harness-cdp.ps1"
    if (-not (H-START-CDP $Vp['a'])) { throw 'H-START-CDP fehlgeschlagen' }
    Start-Process "obsidian://open?path=$([uri]::EscapeDataString($Vp['b']))"
    Start-Sleep -Seconds 12
    $null = Warte {
        try { @((Invoke-RestMethod 'http://127.0.0.1:9222/json' -TimeoutSec 5) | Where-Object { $_.type -eq 'page' }).Count -ge 2 }
        catch { $false }
    } 180 'zwei Fenster'
    foreach ($v in @('a','b')) {
        $st = Cdp "vault-$v" 'const p=app.plugins.plugins["qollab"]; return {vault:app.vault.getName(), geladen:!!p, clientId:p?p.clientId:null};'
        L "[SETUP] vault-$v : geladen=$($st.wert.geladen) clientId=$($st.wert.clientId) (aus '$($st.wert.vault)')"
        $mp = Join-Path $Vp[$v] '.obsidian\plugins\qollab\main.js'
        L ("[SETUP] Build vault-{0}: {1,8} B {2}" -f $v, (Get-Item $mp).Length, (Get-FileHash $mp -Algorithm SHA256).Hash.Substring(0,16))
    }
  }

  # Beide Vaults auf denselben Basistext, KEINE gemeinsame Historie noetig —
  # r11s Aufbau setzt gerade voraus, dass B die Notiz mit As Historie nie sah.
  'basis' {
    foreach ($v in @('a','b')) {
        Remove-Item -Recurse -Force (Join-Path $Vp[$v] '.qollab') -EA 0
        Remove-Item -Force (Join-Path $Vp[$v] $NOTE) -EA 0
    }
    L '[B] Ausgangszustand geleert.'
    # A praegt immer: create + modify -> Sidecar entsteht.
    Setze 'a' $BASIS
    Start-Sleep -Seconds 3
    Setze 'a' $BASIS
    $null = Warte { (Side 'a').Count -ge 1 } 180 'A-Sidecar'

    if ($BOhneState) {
        # NUR create — kein modify, damit keine Sidecar und kein eigener State
        # entsteht. Das ist r11s Vorbedingung.
        Setze 'b' $BASIS
        Start-Sleep -Seconds 20
        $bSide = (Side 'b').Count
        L "[B] STRIKT: b hat $bSide Sidecar(s) (soll 0)"
        if ($bSide -ne 0) {
            throw "B hat einen eigenen State ($bSide Sidecars) — die strikte Vorbedingung ist NICHT hergestellt."
        }
    } else {
        Setze 'b' $BASIS
        Start-Sleep -Seconds 3
        Setze 'b' $BASIS
        $null = Warte { (Side 'b').Count -ge 1 } 180 'B-Sidecar'
    }
    L "[B] a = $((Lies 'a') -replace $NL,'|')"
    L "[B] b = $((Lies 'b') -replace $NL,'|')"
    L "[B] Sidecars: a=$((Side 'a').Count) b=$((Side 'b').Count)"
  }

  # DER SCHLAG. A editiert im Prozess, NUR die Sidecar reist, dann tippt B
  # zweimal kurz hintereinander.
  'schlag' {
    # Beim externen Weg ist der Text sofort in der Datei, aber das Herkunftstor
    # parkt ihn: die Sidecar folgt erst nach PARK_FRIST_TICKS(4) x
    # SCAN_INTERVAL_MS(30_000) = 120 s. Ohne dieses Warten reiste eine Sidecar,
    # die den Marker noch gar nicht kennt.
    $parkWarten = if ($Extern) { 150 } else { 5 }
    if ($Extern) { L "[S] EXTERNER Modus — nach jedem Schreiben ${parkWarten}s auf den Nachtrag warten." }

    Setze 'a' ($BASIS + $MA + $NL)
    $null = Warte { (Lies 'a') -match [regex]::Escape($MA) } 120 'A traegt seinen Marker'
    Start-Sleep -Seconds $parkWarten
    L "[S] a vor der Zustellung = $((Lies 'a') -replace $NL,'|')"
    L "[S] b vor der Zustellung = $((Lies 'b') -replace $NL,'|')"

    # NUR .yjs — die .md bleibt, sonst entsteht kein Vorlauf.
    KopiereSidecar 'a' 'b'
    Start-Sleep -Seconds 5

    # Zwei Edits in B kurz hintereinander. Bs .md traegt As Marker NICHT,
    # Bs Doc (nach Sidecar-Merge) sehr wohl — das ist der Doc-Vorlauf.
    $bText = Lies 'b'
    Setze 'b' ($bText + $MB1 + $NL)
    Start-Sleep -Seconds $Pause
    $bText2 = Lies 'b'
    Setze 'b' ($bText2 + $MB2 + $NL)

    Start-Sleep -Seconds (30 + $parkWarten)
    L "[S] nach den B-Edits:"
    L "[S] a = $((Lies 'a') -replace $NL,'|')"
    L "[S] b = $((Lies 'b') -replace $NL,'|')"

    # Jetzt in beide Richtungen zustellen, damit der Endstand konvergiert.
    KopiereSidecar 'b' 'a'
    Start-Sleep -Seconds 45
    KopiereSidecar 'a' 'b'
    Start-Sleep -Seconds 45
    & $PSCommandPath -Phase zeigen -Tag $Tag
  }

  'zeigen' {
    L '==== ENDSTAND ===='
    $e = [ordered]@{}
    foreach ($v in @('a','b')) {
        $t = Lies $v; $e[$v] = $t
        L "--- vault-$v ---"
        foreach ($z in ($t -split $NL)) { L "    |$z" }
    }
    $aA = Zaehle $e['a'] $MA; $bA = Zaehle $e['b'] $MA
    $aB1 = Zaehle $e['a'] $MB1; $bB1 = Zaehle $e['b'] $MB1
    $aB2 = Zaehle $e['a'] $MB2; $bB2 = Zaehle $e['b'] $MB2
    L "[BEFUND] As Marker  in a: $aA  (soll 1)   in b: $bA  (soll 1)"
    L "[BEFUND] Bs Marker1 in a: $aB1 (soll 1)   in b: $bB1 (soll 1)"
    L "[BEFUND] Bs Marker2 in a: $aB2 (soll 1)   in b: $bB2 (soll 1)"
    $konv = ($e['a'] -eq $e['b'])
    L "[BEFUND] konvergent = $konv"
    $verdict = if ($aA -eq 1 -and $bA -eq 1) { 'A-ZEILE-UEBERLEBT' }
               elseif ($aA -eq 0 -and $bA -eq 0) { 'A-ZEILE-WEG-IN-BEIDEN' }
               else { 'TEILWEISE' }
    L "[VERDICT] $verdict"
    ([ordered]@{
        verdict=$verdict; pause=$Pause; endstand=$e
        as_marker=@{ a=$aA; b=$bA }; bs_marker1=@{ a=$aB1; b=$bB1 }; bs_marker2=@{ a=$aB2; b=$bB2 }
        konvergent=$konv
        build_sha=(Get-FileHash (Join-Path $Vp['a'] '.obsidian\plugins\qollab\main.js') -Algorithm SHA256).Hash
    } | ConvertTo-Json -Depth 6) | Set-Content "$Wurzel\runs\agent-t4-vorlauf-$Tag-endstand.json" -Encoding UTF8
    L "[ZEIGEN] -> runs\agent-t4-vorlauf-$Tag-endstand.json"
  }
}
