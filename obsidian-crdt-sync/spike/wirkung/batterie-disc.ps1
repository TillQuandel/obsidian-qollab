# batterie-disc.ps1 — Faehrt die sechs bislang blockierten Runner mit erhoehten
# Wartezeiten nacheinander.
#
# Warum: Die Runner warteten 90-120 s auf die erste Sidecar. Extern geschriebene
# `.md` parkt das Herkunftstor (main.ts:329-335); der Nachtrag kommt erst nach
# PARK_FRIST_TICKS(4) x SCAN_INTERVAL_MS(30_000) = 120 s. Am 2026-08-12 an `r01`
# gemessen: 118,6 s. Die `-disc`-Kopien heben genau diese Wartezeiten auf 240 s,
# sonst ist keine Zeile geaendert.
#
# SEQUENZIELL, nicht parallel: jeder Runner ruft H-RESET (killt Obsidian) und
# H-START, und alle teilen sich vault-a/vault-b.
#
# Aufruf: pwsh -NoProfile -File C:\tmp\qollab-test\runners\batterie-disc.ps1

$ErrorActionPreference = 'Continue'
$runner = @('s00', 'r11', 'r13', 'r14', 'r15', 'r16')
$start = Get-Date

foreach ($r in $runner) {
    Write-Host ""
    Write-Host "######## START $r  $((Get-Date).ToString('HH:mm:ss')) ########"
    try {
        & "C:\tmp\qollab-test\runners\$r-disc.ps1" 2>&1 | Out-Host
    } catch {
        Write-Host "######## $r WARF: $($_.Exception.Message)"
    }
    Write-Host "######## ENDE  $r  $((Get-Date).ToString('HH:mm:ss')) ########"
}

Write-Host ""
Write-Host "######## BATTERIE FERTIG nach $([int](((Get-Date) - $start).TotalMinutes)) min ########"
