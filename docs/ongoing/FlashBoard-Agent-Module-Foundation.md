# FlashBoard Agent: Modul-Bauordnung

Status: **Verbindliche Arbeitsgrundlage**<br>
Stand: **2. August 2026**<br>
Zweck: Jeder neue Agent — Claude-Session als Orchestrator, Codex-Worker als
Bauer — versteht in fünf Minuten, wie FlashBoard-Agent-Module entstehen,
gebaut und abgenommen werden.<br>
Zielbild und Architekturreferenz:
[FlashBoard-Kernel-Agent-ChatCut-Plan.md](./FlashBoard-Kernel-Agent-ChatCut-Plan.md)

## 1. Arbeitsmodus: workflow-getrieben, fix-forward

- Das Backlog kommt aus dem echten Schnitt-Workflow, nicht aus Feature-Listen.
  Jede Reibungsstelle einer echten Aufgabe wird ein Modulkandidat; die echte
  Aufgabe ist zugleich der Akzeptanztest des Moduls.
- Vollausbau-Haltung nach Plan-Abschnitt 2.5: fix-forward, keine gestaffelte
  Freischaltung, keine Canary- oder Paket-Flags; ein einzelner Kill-Switch
  bleibt als Notbremse.
- ChatCut ist Referenz, nicht Messlatte. Geschlagen wird es über
  Passgenauigkeit zum realen Workflow plus härtere Garantien (Atomicity,
  Undo, Evidence), nicht über Feature-Parität.

## 2. Was ein Modul ist

Ein Modul ist eine Workflow-Fähigkeit end-to-end über Fast V2
(`/api/kernel/hosted-agent/v2/*`), bestehend aus:

1. einem versionierten Capability Bundle `fast-v2-<name>-<jjjj-mm-tt>`,
   gepinnt in public Repo, privatem Kernel und Edge;
2. Kernel-Tool(s) im privaten Kernel, die der Agent-Loop als Provider-Tools
   sieht;
3. öffentlichen Operation Contracts — mutierende Module immer als Paar
   `*.preview.v1` + `*.commit.v1`;
4. einem lokalen Executor: Simulator (nichtdestruktiv, beliebig oft) und
   atomarem Apply (genau ein History-Batch);
5. Chat-Darstellung über Blocks — nie über ein neues Parallelfeld;
6. Evidence, Contract-Tests und einem Bridge-Akzeptanzszenario.

Größenregel: Ein Modul ist in Tagen baubar, nicht in Wochen. Wenn nicht,
kleiner schneiden.

## 3. Fünf Invarianten (nicht verhandelbar)

1. Prompt-, Tool-, Modell- und Budgetautorität bleiben serverseitig; der
   Browser kann nichts davon bestimmen.
2. Revision- und Fingerprint-Prüfung vor jeder Mutation; Drift bricht
   fail-closed ab.
3. Genau ein atomarer History-Batch pro mutierendem Turn, mit gebundenem
   Undo.
4. Preview→Commit: Commit nur mit gültigem, an Plan-Digest und Fingerprint
   gebundenem Preview-Token.
5. Billing-Idempotenz pro Runde.

Begründung: Fix-forward bleibt nur billig, solange jeder durchgerutschte
Fehler einen Undo-Klick kostet statt eines korrupten Projekts oder doppelter
Abbuchungen. Diese fünf Regeln sind der Fix-forward-Mechanismus selbst.

## 4. Substrate (einmal bauen, von jedem Modul benutzt)

| Substrat | Zweck | Status |
|---|---|---|
| Block-Stream (`ChatBlock`/`ChatBlockEvent`, idempotenter Reducer; Plan §4) | Rendering-Substrat jedes Moduls: Text, Narration, Tool, Progress, Evidence, ChangeSet in echter Reihenfolge, mit Replay und Reload | geplant — erstes Fundament-Stück |
| Cross-Turn-Gedächtnis (Conversation Store pro `conversationRef` im Kernel, provider-native Historie, minimale Compaction; Plan §5 als Zielbild) | Ohne das ist jeder V2-Turn amnesisch | offen — zweites Fundament-Stück |
| Operation-Maschinerie (Round-Trip, Transaction-Adapter, Fingerprints, Settlement; `wp1Spike/*`) | Deterministische lokale Ausführung | existiert |
| Evidence-Rendering (`timeline.visual.capture-grid.v1`) | Frames als Beweis | existiert |

Neue Module erweitern Substrate, duplizieren sie aber nie.

## 5. Modul-Rezept (vom Reibungspunkt zum Commit)

1. **Reibungspunkt festhalten.** Konkrete echte Aufgabe und gewünschtes
   Verhalten in zwei bis drei Sätzen. Daraus sofort das
   Bridge-Akzeptanzszenario (`bridge_send_chat_message`) formulieren —
   bevor gebaut wird.
2. **Scope schneiden.** Kleinste end-to-end nützliche Fähigkeit; Optionen
   weglassen, bis der Workflow sie wirklich verlangt.
3. **Contracts zuerst.** Operation-IDs
   (`<bereich>.<fähigkeit>.<preview|commit>.v1`), neue Blocktypen,
   Bundle-Version; in public Repo, Kernel und Edge pinnen; Contract-Tests
   dazu.
4. **Lanes zuschneiden.** Disjunkte Datei-Ownership pro Lane (typisch:
   Kernel-Tool/Loop ⋅ Executor/Simulator ⋅ UI-Blocks ⋅ Tests). Bis zu 10
   Codex-Worker-Lanes (gpt-5.6-sol, Reasoning high, fast) parallel im selben
   Worktree je Repo; Lanes werden nach Fertigstellung sofort neu befüllt.
   Worker schreiben nur Code entlang ihres Auftrags und committen nie;
   Sandbox mit workspace-write und den bekannten
   `exclude_tmpdir_env_var`/`exclude_slash_tmp`-Overrides.
5. **Bauen und integrieren.** Der Orchestrator integriert, löst Konflikte
   und hält die Ownership-Grenzen sauber.
6. **Verifizieren (Evidenzpflicht).** Worker liefern: Liste der geänderten
   Dateien, tsc-/Build-Ausgabe, gezielte Läufe der berührten Testdateien.
   Der Orchestrator prüft unabhängig: mtimes der angeblich geänderten
   Dateien, Spot-Reads der Kernstellen, eigener Build-/Test-Lauf am
   Integrationspunkt. Worker-Reports werden nie ungeprüft übernommen.
   Danach das Bridge-Szenario an der echten Aufgabe fahren — curl gegen den
   Kernel beweist nur die halbe Kette.
7. **Committen und registrieren.** Build vor Commit ist Pflicht; ein Commit
   pro Modul-Integrationspunkt; Eintrag im Modul-Register (Abschnitt 7).

## 6. Abnahme-Checkliste (gilt für jedes Modul)

- Preview mutiert nie; beliebig viele Previews sind erlaubt.
- Commit erzeugt genau eine Timeline-Revision und genau einen Undo-Schritt.
- Revision-/Fingerprint-Drift bricht fail-closed ab; kein stilles Re-Basing.
- Nach dem Commit wird der Zustand erneut gelesen und gegen den erwarteten
  Diff geprüft; Erfolg wird nur mit Evidence behauptet; Bewegung oder Audio
  nie mit einem Einzelframe belegen.
- Blocks: Live-Ausführung, Replay und Reload ergeben dieselbe Reihenfolge;
  keine neuen Parallel-State-Pfade im Chat.
- Contract-Tests pinnen Bundle-Version und Digests in beiden Repos.
- Das Bridge-Akzeptanzszenario aus Rezept-Schritt 1 besteht an der echten
  Aufgabe.

## 7. Modul-Register

Das kanonische Register lebt **im Code**: `src/agentRuntime/agentModule.ts`
im privaten Kernel-Repo. Jedes Modul ist dort eine typisierte
`AgentModuleDefinition` (Bundle, Capability, öffentliche Operationen,
Evidence-Policies, Akzeptanz-Szenario); die Registrierung validiert beim
Boot fail-closed — ein halb deklariertes Modul erreicht den Provider-Loop
nicht. Neue Module werden dort registriert, nie an der Registry vorbei.
Die Tabelle hier ist die menschenlesbare Spiegelung:

| Modul | Bundle | Operationen | Status | Akzeptanz-Aufgabe |
|---|---|---|---|---|
| remove-ranges | `fast-v2-transcript-assembly-2026-08-03` | `timeline.segment.split.v1`, `timeline.segment.delete-many.v1`, `timeline.visual.capture-grid.v1` | live (Referenzmodul, grandfathered ohne Preview/Commit-Paar) | Bereiche aus einem Clip entfernen, optional visuell prüfen |
| timeline-intercut | `fast-v2-transcript-assembly-2026-08-03` | `timeline.intercut.preview.v1`, `timeline.segment.split.v1`, `timeline.segment.delete-many.v1`, `timeline.intercut.commit.v1` | live | Transkript-getaktete Shots aus mehreren Takes atomar abwechseln und verknüpften Ton erhalten |
| transcript-assembly | `fast-v2-transcript-assembly-2026-08-03` | `timeline.editor.program.preview.v1`, `timeline.editor.program.commit.v1` | live | Verbatim Text in Wort-, Phrasen- oder Satzgranularität deklarieren; der private Kernel löst Zeitstempel auf und kompiliert eine neue Komposition aus atomaren Segment-Inserts. Die öffentliche Grenze bleibt ein generisches Edit-Programm ohne Transkript-Orchestrierung. |
| editable-hook | `fast-v2-transcript-assembly-2026-08-03` | `timeline.hook.preview.v1`, `timeline.hook.commit.v1`, `timeline.hook.refine.commit.v1`, `timeline.visual.capture-grid.v1` | live | Editierbaren Text-Hook mit nativen Backplates schnell erzeugen und danach automatisch einen Kontrollframe liefern |
| editable-hook-refinement | `fast-v2-transcript-assembly-2026-08-03` | `timeline.hook.preview.v1`, `timeline.hook.commit.v1`, `timeline.hook.refine.commit.v1`, `timeline.visual.capture-grid.v1` | live | Einzelne Text-/Backplate-Zeilen über stabilen `hookId` und `rowIndex` nachbessern, nach jeder Änderung neu rendern, maximal zwei Refinements |

## 8. Einstiegspunkte und Regeln

Public Repo:

- `src/services/kernelClient/hostedAgent/fastV2StartContract.ts` (Pins,
  Start-Contract)
- `src/services/kernelClient/wp1Spike/publicOperationContracts.ts`
  (Operationen, Digests)
- `src/services/kernelClient/wp1Spike/operationRoundTrip.ts` und
  `agentTransactionAdapter.ts` (Ausführung, ein History-Batch)
- `src/services/flashboard/FlashBoardHostedAgentTransport.ts` (Session-Loop)
- `functions/lib/hostedAgent/route.ts` (Edge, Flags, Billing-Modelle)

Privater Kernel (`Documents\masterselects-kernel` — Kernel-Code und -Docs
niemals in dieses öffentliche Repo committen):

- `src/agentRuntime/agentModule.ts` — **zuerst lesen**: der Modul-Contract
  und das kanonische Register; die Validierung dort erzwingt die Bauordnung
  (Bundle-Muster, Evidence-Pflicht für mutierende Module,
  Preview/Commit-Paar für alle neuen Module)
- `src/agentRuntime/operationFamilies/*` (Capability-Dateien; Vorlage:
  `rangeRemoval.ts`)
- `src/service/hostedAgentFastV2Service.ts` (Agent-Loop)
- `src/contracts/hostedAgentFastV2.ts` (Server-Pins)

Ein paralleles Modul-Register im public Repo gibt es bewusst nicht: Die
Modul-Autorität liegt serverseitig (Invariante 1). Auf Client-Seite ist
`publicOperationContracts.ts` das Operations-Register, gegen das jeder
Executor validiert.

Arbeitsregeln aus dem Projektgedächtnis: `npm run build` fehlerfrei vor
jedem Commit; die volle Build-/Lint-/Test-Kette einmal am Ende, nicht nach
jeder Änderung; Kernel-/Chat-Verhalten immer über die Dev-Bridge
verifizieren.
