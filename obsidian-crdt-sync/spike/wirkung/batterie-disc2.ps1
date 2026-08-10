# batterie-disc2.ps1 — zweiter Anlauf fuer die vier Runner, die im ersten Lauf
# weiterhin VOR ihren Asserts starben.
#
# Grund des ersten Fehlschlags: Die Wartestelle sitzt nicht im Runner, sondern im
# gemeinsamen Helfer `H-SETUP-SHARED` (harness-ext.ps1:288 mit 90 s, :297 mit
# 120 s) — beide unter der 120-s-Park-Frist. Die `-disc`-Runner sind deshalb auf
# `harness-ext-disc.ps1` umgebogen, wo genau diese zwei Werte auf 240 s stehen.
#
# Aufruf: pwsh -NoProfile -File C:\tmp\qollab-test\runners\batterie-disc2.ps1

$ErrorActionPreference = 'Continue'
$start = Get-Date

foreach ($r in @('r13', 'r14', 'r15', 'r16')) {
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
Write-Host "######## FERTIG nach $([int](((Get-Date) - $start).TotalMinutes)) min ########"
