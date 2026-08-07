# Inhaltsadressierter Zustands-Log (S3log) — die Messung bei N >= 3

Fortsetzung der am 2026-08-03 abgebrochenen Messung (`.superpowers/sdd/erstkontakt-synthese-2026-08-03.md:85-97`).

## Woher der Apparat kommt

Der Apparat lag auf **`spike/schnitt-messung`** (Spitze `28301c2`), dort unter **repo-root** `spike/`.
Hier liegt er unveraendert kopiert; `real.cjs` ist der eingecheckte esbuild-Bundle des
Produktionscodes von damals und wurde **nicht neu gebaut** — sonst waeren die Zahlen nicht
vergleichbar. `schnitte-alt.mjs` ist derselbe Modulstand aus `83b3806`.

Neu und nur hier: `wachstum.mjs`, `bilanz-n.mjs`, `gegenprobe.mjs`, `mechanik.mjs`,
`vergleich-alt.mjs`, `probe-n1.mjs`, `wiederhol.mjs`, `schnitte-mut.mjs`.

## Aufrufe

    node run.mjs 40 10 120                    # die veroeffentlichte Kerntabelle
    node vergleich-alt.mjs 40                 # aus welchem Codestand die Zahlen stammen
    node probe-n.mjs                          # N=2 ok, N=3 terminiert nicht
    node wachstum.mjs S3log <N> 40 10 1200 800 20000 900   # Fixpunkt ja/nein
    node bilanz-n.mjs <S3log|S0real> <N> 40 800 900        # Bilanz mit Knotenkappe
    node gegenprobe.mjs 40 2                  # Mutationsprobe des unverwandt-Zaehlers
    node mechanik.mjs 3 1 300                 # Zerlegung eines davongelaufenen Laufs

Zellbasis ueberall: 40 Seeds x 10 Notizen, je 1 Edit pro Geraet, Praegefenster 120 Ticks,
`.md`-Kanal `kopie`. Nichts gekuerzt.

## Ergebnis

N = 2 ist exakt reproduziert. Bei N >= 3 **traegt der Kandidat nicht**: der Merge ist nicht
konfluent, die Geraete rechnen je nach Merge-Reihenfolge verschiedene Ergebnisse, jedes Ergebnis
ist ein neuer inhaltsadressierter Zustand, und der Austausch laeuft davon.

