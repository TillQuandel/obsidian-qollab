# agent-t3-fuzz.ps1 — WIRKUNGSNACHWEIS fuer den zeilenweisen 3-Wege-Merge.
#
# Was dieser Lauf zeigen soll, und was ihn von r30 unterscheidet:
# r30 belegt Regressionsfreiheit (das Herkunftstor an EINEM Vault). Die
# Schadensklasse, die `ba9f943` behebt, kommt darin gar nicht vor. Dieser Lauf
# loest sie am ALTEN Build aus und zeigt, dass sie am NEUEN ausbleibt. Ohne den
# roten Lauf am alten Build ist der gruene blind.
#
# DER SCHADENSFALL, zeichengleich aus `spike/schnitt/probe-fuzz.mjs` Seed 3
# (harness-frei vorkalibriert in `spike/wirkung/kalibrierung.mjs`: alt zerstoert
# `n0-base-4`, neu zerstoert nichts):
#
#     base  = n0-base-0 .. n0-base-7                    (8 Zeilen)
#     local = wie base, aber `n0-base-6|n0-D0-9`
#     other = wie base, aber `n0-base-5|n0-D1-4`,
#                            `n0-base-6|n0-D1-0`, plus `n0-D1-6` am Ende
#
# Am alten Build haengt `patch_apply` die lokale Ergaenzung an `n0-base-4` statt
# an `n0-base-6` — `n0-base-4` ist damit als Zeile zerstoert, obwohl alle drei
# Staende sie unveraendert tragen. Das ist K.o.-Kriterium 1.
#
# ROLLEN   a = das Geraet, das lokal ergaenzt. Hier entsteht der 3-Wege-Merge.
#          c = fremdes Geraet 1 (Zeile 5), d = fremdes Geraet 2 (Zeile 6 + Anhang).
#
# WIE DIE FIXTURE IM ECHTEN PLUGIN ENTSTEHT (aus dem Kontrollfluss gelesen):
# `mergeForLocalDiff` (sync-handler.ts:1748) ruft `threeWayMerge(base, content,
# mergedText)`. Dabei ist
#   content    = a's .md-Text                      -> `local`
#   mergedText = Doc nach `mergePendingForeign`    -> `other`
#   base       = `chooseLocalDiffBase` -> `lastSeen`, weil a's Text keine der
#                fremden Einfuegungen enthaelt (:1892)  -> die 8 Basiszeilen
# `mergePendingForeign` listet die Sidecars DIREKT VON DER PLATTE
# (`listYjsFiles`), es braucht also keinen Dateiwaechter. Deshalb: erst die
# Sidecars von c und d nach a kopieren, dann SOFORT a's .md setzen — der
# modify-Handler zieht die Fremdstaende in derselben Runde ein.
#
# Alle .md-Schreibungen laufen ueber `app.vault.modify` im jeweiligen Renderer.
# Das Herkunftstor (main.ts:329) parkt jeden Inhalt, den der Prozess nicht selbst
# geschrieben hat; `WriteProvenance` umhuellt den DataAdapter (`write`,
# `process`, `append`, `writeBinary`), weshalb `app.vault.modify` denselben
# Herkunftsfall darstellt wie ein tippender Mensch. Eine hineinkopierte .md
# erreicht `setContent` nie.

param(
    [Parameter(Mandatory)][ValidateSet('sicherung','deploy','setup','basis','fremd','schlag','zeigen','aufraeumen')][string]$Phase,
    [string]$Tag = 'lauf',
    [ValidateSet('alt','neu')][string]$Build
)

$ErrorActionPreference = 'Stop'
$Wurzel  = 'C:\tmp\qollab-test'
$Vp      = @{ a = "$Wurzel\vault-a"; c = "$Wurzel\vault-c"; d = "$Wurzel\vault-d" }
$Builds  = "$Wurzel\builds"
$ProdVault = 'C:\Users\tillq\Obsidian_Vault'
$ObsJson = "$env:APPDATA\obsidian\obsidian.json"
$NOTE    = 'Fuzz.md'
$NL      = [string][char]10

# Die vier Textstaende. `BASE` ist der gemeinsame Vorfahr.
$BASE = (@('n0-base-0','n0-base-1','n0-base-2','n0-base-3',
           'n0-base-4','n0-base-5','n0-base-6','n0-base-7') -join $NL) + $NL
$LOCAL = (@('n0-base-0','n0-base-1','n0-base-2','n0-base-3',
            'n0-base-4','n0-base-5','n0-base-6|n0-D0-9','n0-base-7') -join $NL) + $NL
$FREMD_C = (@('n0-base-0','n0-base-1','n0-base-2','n0-base-3',
              'n0-base-4','n0-base-5|n0-D1-4','n0-base-6','n0-base-7') -join $NL) + $NL
$FREMD_D = (@('n0-base-0','n0-base-1','n0-base-2','n0-base-3',
              'n0-base-4','n0-base-5','n0-base-6|n0-D1-0','n0-base-7','n0-D1-6') -join $NL) + $NL

$Log = "$Wurzel\runs\agent-t3-fuzz-$Tag.log"

function L([string]$m) {
    $z = "$([DateTime]::Now.ToString('HH:mm:ss')) $m"
    Add-Content -Path $Log -Value $z; Write-Host $z
}
function Cdp([string]$Hint, [string]$Js) {
    $t = (& node "$Wurzel\harness\cdp.mjs" eval $Hint $Js 2>&1 | Out-String).Trim()
    try { return ($t | ConvertFrom-Json) } catch { L "[CDP-ROH $Hint] $t"; return $null }
}
function Setze([string]$v, [string]$Text) {
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
function Guid([string]$v) {
    $f = Side $v | Select-Object -First 1
    if (-not $f) { return $null }
    $b = [IO.File]::ReadAllBytes($f.FullName)
    if ($b.Length -lt 24 -or [Text.Encoding]::ASCII.GetString($b,0,4) -ne 'QLB2') { return $null }
    ($b[8..23] | ForEach-Object { $_.ToString('x2') }) -join ''
}
function Warte([scriptblock]$B, [int]$Sek, [string]$Was) {
    $t0 = [DateTime]::UtcNow
    while (([DateTime]::UtcNow - $t0).TotalSeconds -lt $Sek) {
        if (& $B) { L "[WARTE] $Was ok nach $([int](([DateTime]::UtcNow-$t0).TotalSeconds))s"; return $true }
        Start-Sleep -Seconds 3
    }
    L "[WARTE] $Was TIMEOUT ${Sek}s"; return $false
}
function Kopiere([string]$Von, [string]$Nach) {
    $q = Join-Path $Vp[$Nach] '.qollab'
    if (-not (Test-Path $q)) { New-Item -ItemType Directory -Force $q | Out-Null }
    $n = 0; foreach ($f in (Side $Von)) { Copy-Item $f.FullName (Join-Path $q $f.Name) -Force; $n++ }
    L "[SIDECAR] $Von -> $Nach : $n"
}
function Zeig([string]$was) {
    L "-- $was --"
    foreach ($v in @('a','c','d')) { L ("   {0} = {1}" -f $v, ((Lies $v) -replace $NL,'|')) }
}

# ── Sicherheit ──────────────────────────────────────────────────────────────
# Guard4: `guard.ps1` kennt nur vault-a|vault-b und haelt ein offenes vault-c
# oder -d fuer ein FREMDES Fenster. Fassung aus agent-t2.ps1:52-60.
function Guard4 {
    $procs = @(Get-Process 'Obsidian' -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { L '[Guard4] kein Obsidian-Prozess'; return $true }
    $titel = @($procs | Where-Object { $_.MainWindowTitle } | Select-Object -Exp MainWindowTitle)
    L "[Guard4] $($procs.Count) Prozess(e): $($titel -join ' | ')"
    $fremd = @($titel | Where-Object { $_ -notmatch 'vault-a|vault-b|vault-c|vault-d' })
    if ($fremd.Count -gt 0) { L "[Guard4] ABBRUCH — fremdes Fenster: $($fremd -join ' | ')"; return $false }
    return $true
}
# H-START-CDP startet Obsidian OHNE Vault-Argument und stellt alle mit
# open:true vermerkten Vaults wieder her — so wurde der produktive Vault am
# 2026-08-06 unbeabsichtigt mitgeoeffnet.
function Prod-Nicht-Offen {
    $j = Get-Content $ObsJson -Raw | ConvertFrom-Json
    foreach ($p in $j.vaults.PSObject.Properties) {
        if ($p.Value.path -like '*Obsidian_Vault*' -and $p.Value.open -eq $true) {
            throw "ABBRUCH: produktiver Vault steht auf open:true — erst Phase 'sicherung' fahren."
        }
    }
    L '[Sicherheit] produktiver Vault steht NICHT auf open:true'
}
# Beweis-Stempel ueber sha und size, NICHT ueber ConvertFrom-Json-Zeitstempel:
# letzteres meldet Formatierungsunterschiede als Aenderung.
function Prod-Stempel {
    $out = @()
    foreach ($rel in @('.obsidian\workspace.json','.obsidian\community-plugins.json','.obsidian\plugins\qollab\main.js')) {
        $p = Join-Path $ProdVault $rel
        if (Test-Path $p) {
            $i = Get-Item $p
            $out += [ordered]@{ pfad=$rel; size=$i.Length; sha=(Get-FileHash $p -Algorithm SHA256).Hash.Substring(0,16) }
        }
    }
    $out
}

switch ($Phase) {

  # Sichert obsidian.json und nimmt dem produktiven Vault das open-Flag, damit
  # ein Start ohne Vault-Argument ihn nicht mitoeffnet. `aufraeumen` stellt die
  # Sicherung wieder her.
  'sicherung' {
    $bak = "$Wurzel\obsidian.json.bak-t3fuzz-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss'))"
    Copy-Item $ObsJson $bak -Force
    L "[SICHERUNG] $ObsJson -> $bak"
    $roh = Get-Content $ObsJson -Raw
    $j = $roh | ConvertFrom-Json
    $geaendert = $false
    foreach ($p in $j.vaults.PSObject.Properties) {
        if ($p.Value.path -like '*Obsidian_Vault*' -and $p.Value.open) {
            $p.Value.PSObject.Properties.Remove('open'); $geaendert = $true
            L "[SICHERUNG] open-Flag entfernt: $($p.Value.path)"
        }
    }
    if ($geaendert) { $j | ConvertTo-Json -Depth 8 -Compress | Set-Content $ObsJson -Encoding UTF8 }
    else { L '[SICHERUNG] kein open-Flag am produktiven Vault — nichts zu tun.' }
    Prod-Stempel | ConvertTo-Json | Set-Content "$Wurzel\runs\agent-t3-fuzz-$Tag-prodstempel.json" -Encoding UTF8
    L '[SICHERUNG] Prod-Stempel abgelegt.'
  }

  # Deployt den gewaehlten Build nach a/c/d und HASHT gegen die Quelle.
  # `H-DEPLOY` deployt nur nach a/b; `agent-vaults-cd.ps1` deployt nach c/d aus
  # vault-b und gibt den SHA nur AUS, ohne zu vergleichen. Ein Test-Vault lief
  # schon einmal auf einem drei Tage alten Build.
  'deploy' {
    if (-not $Build) { throw 'Phase deploy braucht -Build alt|neu' }
    $quelle = Join-Path $Builds "main-$Build.js"
    if (-not (Test-Path $quelle)) { throw "Build fehlt: $quelle" }
    $soll = (Get-FileHash $quelle -Algorithm SHA256).Hash
    L "[DEPLOY] Quelle $quelle SHA=$($soll.Substring(0,16))"
    foreach ($v in @('a','c','d')) {
        $pd = Join-Path $Vp[$v] '.obsidian\plugins\qollab'
        if (-not (Test-Path $pd)) { throw "Plugin-Ordner fehlt in vault-${v}: $pd" }
        Copy-Item $quelle (Join-Path $pd 'main.js') -Force
        Remove-Item -Force (Join-Path $pd 'data.json') -EA 0
        $ist = (Get-FileHash (Join-Path $pd 'main.js') -Algorithm SHA256).Hash
        if ($ist -ne $soll) { throw "[DEPLOY] SHA-Mismatch in vault-${v}: soll=$soll ist=$ist" }
        L "[DEPLOY] vault-$v OK SHA=$($ist.Substring(0,16))"
    }
    L "[DEPLOY] Build '$Build' in a/c/d, gegen die Quelle geprueft."
  }

  # Drei Fenster mit Debug-Port. Weg aus agent-t2.ps1:151-166: H-START-CDP
  # startet den EINEN Electron-Prozess mit --remote-debugging-port, c und d
  # kommen als weitere Targets per obsidian://open dazu.
  'setup' {
    Prod-Nicht-Offen
    if (-not (Guard4)) { throw 'Guard4 blockiert' }
    Stop-Process -Name 'Obsidian' -Force -EA 0
    # Ohne die Pause startet Electron nicht — der Singleton-Lock des gerade
    # beendeten Laufs haengt noch.
    Start-Sleep -Seconds 10
    . "$Wurzel\harness\harness.ps1"
    . "$Wurzel\harness\harness-cdp.ps1"
    if (-not (H-START-CDP $Vp['a'])) { throw 'H-START-CDP fehlgeschlagen' }
    foreach ($v in @('c','d')) {
        Start-Process "obsidian://open?path=$([uri]::EscapeDataString($Vp[$v]))"
        Start-Sleep -Seconds 12
    }
    $null = Warte {
        try { @((Invoke-RestMethod 'http://127.0.0.1:9222/json' -TimeoutSec 5) | Where-Object { $_.type -eq 'page' }).Count -ge 3 }
        catch { $false }
    } 180 'drei Fenster'
    foreach ($v in @('a','c','d')) {
        $st = Cdp "vault-$v" 'const p=app.plugins.plugins["qollab"]; return {vault:app.vault.getName(), geladen:!!p, clientId:p?p.clientId:null};'
        L "[SETUP] vault-$v : geladen=$($st.wert.geladen) clientId=$($st.wert.clientId) (Antwort aus '$($st.wert.vault)')"
    }
    foreach ($v in @('a','c','d')) {
        $mp = Join-Path $Vp[$v] '.obsidian\plugins\qollab\main.js'
        L ("[SETUP] Build vault-{0}: {1,8} B {2}" -f $v, (Get-Item $mp).Length, (Get-FileHash $mp -Algorithm SHA256).Hash.Substring(0,16))
    }
  }

  # Gemeinsame Inkarnation auf BASE. Ohne sie praegen c und d eigene
  # Inkarnationen und haetten keine gemeinsame Item-Basis (Split-Brain).
  'basis' {
    foreach ($v in @('a','c','d')) {
        Remove-Item -Recurse -Force (Join-Path $Vp[$v] '.qollab') -EA 0
        Remove-Item -Force (Join-Path $Vp[$v] $NOTE) -EA 0
    }
    L '[B1] Ausgangszustand geleert.'
    Setze 'a' $BASE
    Start-Sleep -Seconds 3
    # Ein blosses `create` erzeugt keine Sidecar, erst ein `modify` tut es.
    Setze 'a' $BASE
    $null = Warte { (Side 'a').Count -ge 1 } 180 'A-Sidecar'
    $script:g = Guid 'a'; L "[B1] A-GUID = $($script:g)"
    # NUR die Sidecar reist — die .md NICHT.
    #
    # Erster Entwurf kopierte auch die .md. Das war falsch, und zwar messbar
    # (Lauf 'neu' vom 19:47): Eine hineinkopierte .md ist fuer das Herkunftstor
    # FREMD, wird geparkt und spaeter per `unionMerge` aufgeloest — ohne
    # gemeinsamen Vorfahren. Die lokale Diff-Basis von c/d stand danach nicht auf
    # BASE, und ihr eigener Edit wurde zum Konfliktfall statt zum reinen lokalen
    # Edit: `n0-base-5` stand bei c zweimal da (einmal roh, einmal ergaenzt), und
    # damit war `other` in beiden Buildlaeufen VERSCHIEDEN — der Vergleich haette
    # nicht mehr den Build isoliert.
    #
    # Deshalb: c und d schreiben BASE SELBST ueber `app.vault.modify`. Das ist ein
    # eigener Write (WriteProvenance umhuellt den DataAdapter), er passiert das
    # Tor, und `noteLocalDiffBase` steht danach sauber auf BASE. Die zuvor
    # kopierte Sidecar sorgt dafuer, dass `ensureDoc` die fremde Inkarnation
    # adoptiert, statt eine eigene zu praegen.
    foreach ($v in @('c','d')) { Kopiere 'a' $v }
    foreach ($v in @('c','d')) {
        Setze $v $BASE
        Start-Sleep -Seconds 3
        Setze $v $BASE
    }
    $null = Warte { ((Guid 'c') -eq $script:g) -and ((Guid 'd') -eq $script:g) } 300 'Adoption c+d'
    $null = Warte { ((Lies 'c') -eq $BASE) -and ((Lies 'd') -eq $BASE) } 180 'c+d stehen auf BASE'
    L "[B2] GUIDs a=$(Guid 'a') c=$(Guid 'c') d=$(Guid 'd')"
    Zeig 'nach Basis'
    $sauber = ((Lies 'a') -eq $BASE) -and ((Lies 'c') -eq $BASE) -and ((Lies 'd') -eq $BASE)
    L "[B2] alle drei exakt auf BASE = $sauber"
    if (-not $sauber) { throw 'Basis unsauber — ein Lauf darauf vergleicht nicht den Build.' }
  }

  # c und d aendern UNABHAENGIG. Ihre Sidecars reisen hier NICHT — weder
  # zueinander noch zu a. Sonst saehe a den Fremdstand schon vor seinem eigenen
  # Edit, schriebe ihn in seine .md zurueck, und `chooseLocalDiffBase` naehme
  # den Fremdstand als Basis: die Fixture waere verfehlt.
  'fremd' {
    Setze 'c' $FREMD_C
    Setze 'd' $FREMD_D
    $ok = Warte { ((Lies 'c') -eq $FREMD_C) -and ((Lies 'd') -eq $FREMD_D) } 180 'c+d auf ihren Staenden'
    Start-Sleep -Seconds 20
    Zeig 'nach den Fremd-Edits, VOR jedem Austausch'
    L "[F] a steht auf BASE = $(((Lies 'a') -eq $BASE))"
    # Hart abbrechen statt weiterlaufen: Steht c oder d nicht exakt auf seinem
    # Stand, ist `other` nicht der Fixture-Stand — der Schlag verglieche dann
    # nicht mehr den Build, sondern zwei verschiedene Eingaben.
    if (-not $ok -or ((Lies 'c') -ne $FREMD_C) -or ((Lies 'd') -ne $FREMD_D)) {
        throw 'Fremd-Staende weichen ab — Lauf nicht vergleichbar, nicht fortsetzen.'
    }
    if ((Lies 'a') -ne $BASE) { throw 'a steht nicht auf BASE — Lauf nicht vergleichbar.' }
  }

  # DER SCHLAG. Erst die Fremd-Sidecars nach a, dann SOFORT a's lokale
  # Ergaenzung. `mergePendingForeign` zieht die Sidecars von der Platte, der
  # 3-Wege-Merge entsteht in derselben Runde.
  'schlag' {
    $vorher = Lies 'a'
    if ($vorher -ne $BASE) {
        L "[SCHLAG] VORBEDINGUNG VERLETZT — a steht nicht auf BASE:"
        L "         $($vorher -replace $NL,'|')"
        L '[SCHLAG] Der 3-Wege-Merge bekaeme eine andere Basis als die Fixture.'
        L '[SCHLAG] Ergebnis: INCONCLUSIVE. Nicht weiterfahren, Lauf wiederholen.'
        Set-Content "$Wurzel\runs\agent-t3-fuzz-$Tag-endstand.json" `
            -Value (@{ verdict='INCONCLUSIVE'; grund='a stand vor dem Schlag nicht auf BASE'; a=$vorher } | ConvertTo-Json) -Encoding UTF8
        return
    }
    L '[SCHLAG] Vorbedingung ok: a steht auf BASE.'
    Kopiere 'c' 'a'
    Kopiere 'd' 'a'
    Setze 'a' $LOCAL
    $null = Warte { (Lies 'a') -ne $BASE } 180 'a hat gemergt'
    Start-Sleep -Seconds 30
    Zeig 'nach dem Schlag (nur a hat gemergt)'
    # Jetzt duerfen alle einander sehen, damit der Endstand konvergiert.
    Kopiere 'a' 'c'; Kopiere 'a' 'd'; Kopiere 'c' 'd'; Kopiere 'd' 'c'
    Start-Sleep -Seconds 75
    Kopiere 'c' 'a'; Kopiere 'd' 'a'; Kopiere 'a' 'c'; Kopiere 'a' 'd'
    Start-Sleep -Seconds 75
    # -Build nur weiterreichen, wenn gesetzt: ein leerer String verletzt das
    # ValidateSet und braeche den Lauf NACH der Messung ab.
    if ($Build) { & $PSCommandPath -Phase zeigen -Tag $Tag -Build $Build }
    else        { & $PSCommandPath -Phase zeigen -Tag $Tag }
  }

  'zeigen' {
    L '==== ENDSTAND (woertlich) ===='
    $e = [ordered]@{}
    foreach ($v in @('a','c','d')) {
        $t = Lies $v; $e[$v] = $t
        L "--- vault-$v ---"
        foreach ($z in ($t -split $NL)) { L "    |$z" }
    }
    # K.o.-Kriterium 1: `n0-base-4` tragen base, local UND other unveraendert.
    # Fehlt sie als eigene Zeile, ist Grundtext zerstoert.
    $fehlt = @()
    foreach ($v in @('a','c','d')) {
        if (($e[$v] -split $NL) -notcontains 'n0-base-4') { $fehlt += $v }
    }
    $schadenZeichengleich = (($e.Values -join '') -match [regex]::Escape('n0-base-4|n0-D0-9'))
    $lokalDa = (($e.Values -join '') -match [regex]::Escape('n0-D0-9'))
    $konvergent = (($e['a'] -eq $e['c']) -and ($e['c'] -eq $e['d']))

    L "[BEFUND] n0-base-4 als eigene Zeile FEHLT in : $(if($fehlt.Count){$fehlt -join ','}else{'(keinem)'})"
    L "[BEFUND] Schaden zeichengleich 'n0-base-4|n0-D0-9' = $schadenZeichengleich"
    L "[BEFUND] lokale Ergaenzung n0-D0-9 vorhanden      = $lokalDa"
    L "[BEFUND] konvergent a=c=d                          = $konvergent"

    $verdict = if ($Build -eq 'alt') {
        if ($fehlt.Count -gt 0) { 'KLASSE-AUSGELOEST' } else { 'BLIND' }
    } elseif ($Build -eq 'neu') {
        if ($fehlt.Count -eq 0) { 'WIRKUNG-BELEGT' } else { 'REGRESSION' }
    } else { 'OHNE-BUILD-ANGABE' }
    L "[VERDICT] Build=$Build -> $verdict"
    if ($verdict -eq 'BLIND') {
        L '           Der alte Build zeigt den Schaden NICHT. Der Lauf beweist damit'
        L '           nichts ueber die Wirkung — Szenario oder Aufbau treffen die Klasse nicht.'
    }
    ([ordered]@{
        build=$Build; verdict=$verdict; endstand=$e
        base4_fehlt_in=$fehlt; schaden_zeichengleich=$schadenZeichengleich
        lokal_da=$lokalDa; konvergent=$konvergent
        builds_sha=@{
            a=(Get-FileHash (Join-Path $Vp['a'] '.obsidian\plugins\qollab\main.js') -Algorithm SHA256).Hash
            c=(Get-FileHash (Join-Path $Vp['c'] '.obsidian\plugins\qollab\main.js') -Algorithm SHA256).Hash
            d=(Get-FileHash (Join-Path $Vp['d'] '.obsidian\plugins\qollab\main.js') -Algorithm SHA256).Hash
        }
    } | ConvertTo-Json -Depth 6) | Set-Content "$Wurzel\runs\agent-t3-fuzz-$Tag-endstand.json" -Encoding UTF8
    L "[ZEIGEN] Endstand -> runs\agent-t3-fuzz-$Tag-endstand.json"
  }

  # Prod-Stempel vergleichen und obsidian.json aus der letzten Sicherung
  # zurueckholen. Die Test-Vaults bleiben REGISTRIERT — sonst sind sie nicht
  # mehr oeffenbar.
  'aufraeumen' {
    Stop-Process -Name 'Obsidian' -Force -EA 0
    Start-Sleep -Seconds 4
    $stempelDatei = "$Wurzel\runs\agent-t3-fuzz-$Tag-prodstempel.json"
    if (Test-Path $stempelDatei) {
        $vor = Get-Content $stempelDatei -Raw
        $nach = Prod-Stempel | ConvertTo-Json
        if ($vor.Trim() -eq $nach.Trim()) { L '[AUFRAEUMEN] produktiver Vault unberuehrt (sha+size gleich).' }
        else { L "[AUFRAEUMEN] ACHTUNG — Prod-Stempel WEICHT AB.`nvor : $vor`nnach: $nach" }
    } else { L '[AUFRAEUMEN] kein Prod-Stempel gefunden — Vergleich entfaellt.' }
    $bak = Get-ChildItem $Wurzel -Filter 'obsidian.json.bak-t3fuzz-*' | Sort-Object Name | Select-Object -Last 1
    if ($bak) { Copy-Item $bak.FullName $ObsJson -Force; L "[AUFRAEUMEN] obsidian.json aus $($bak.Name) zurueckgeholt." }
    else { L '[AUFRAEUMEN] keine Sicherung gefunden — obsidian.json unveraendert gelassen.' }
  }
}
