# FlashBoard Kernel Agent: ChatCut-inspirierter Ausbauplan

Status: **Zielbild und Architekturreferenz – die Ausführung folgt der
[Modul-Bauordnung](./FlashBoard-Agent-Module-Foundation.md)
(workflow-getriebene Module)**<br>
Stand: **2. August 2026**<br>
Umsetzungshaltung: **Vollausbau-Substrate, fix-forward, keine gestaffelte
Freischaltung; Umsetzung orchestriert über bis zu 10 Codex-Worker-Lanes
(siehe 2.5 und 2.6)**<br>
Zielpfad: **Hosted Agent Fast V2 mit serverseitig kontrollierten Capability
Bundles und versionierten öffentlichen Editor-Operationen**

## 1. Ziel

FlashBoard Chat soll sich wie ein transparenter, fortlaufender Editing-Agent
anfühlen:

- Text, sichere Narration, Tool-Aufrufe, Fortschritt, Entscheidungen und
  Beweisbilder erscheinen in ihrer tatsächlichen Reihenfolge;
- der Kernel besitzt Agentenloop, Conversation-Historie, Skills,
  Capability-Auswahl, Edit-Dokument, Planung, Verifikation und ChangeSet-Audit;
- React rendert ausschließlich typisierte Kernel-Ereignisse und sendet
  typisierte Benutzerentscheidungen zurück;
- die lokale Editor-Engine bleibt der deterministische Ausführungsort für das
  lokale Projekt, besitzt aber keine Agenten- oder Planungslogik;
- Transcript-Remixe werden zunächst als deklarativer Edit-Plan entworfen,
  beliebig oft simuliert und anschließend genau einmal atomar angewendet;
- jeder mutierende Agenten-Turn endet mit überprüfbarer Evidence und einer
  gebundenen Undo- beziehungsweise Restore-Aktion.

Der Plan übernimmt die nützlichen Interaktionsmuster von ChatCut, baut sie aber
auf den strengeren MasterSelects-Verträgen für Revisionen, Fingerprints,
Transaktionen, Idempotenz, Freigaben und Rollback auf.

## 2. Verbindliche Architekturentscheidung

### 2.1 Fast V2 ist der Zielpfad

Der Ausbau erfolgt auf dem **Fast-V2-Operation-Plan-Pfad**, nicht auf dem
älteren Hosted-Agent-K2-Muster, bei dem der Browser beliebige vom Modell
angeforderte Tool-Batches ausführt.

Fast V2 besitzt bereits die richtigen Grundlagen:

- serverseitig ausgewähltes Modell und Ausführungsprofil;
- serverseitig gepinnter Capability-Katalog und kontrolliertes aktives Set;
- kompakter Browser-Snapshot mit Timeline-Revision und Fingerprint;
- geordnete und replaybare Events;
- Operation-Plan, Prepare, Settlement und Commit;
- genau-einmalige beziehungsweise konfliktprüfende Ausführung;
- Abbruch bei Revision- oder Fingerprint-Drift;
- Browser-Requests können keine Provider-Prompts, Tools oder Budgets
  einschleusen.

### 2.2 Der aktuelle Fast-V2-Stand ist noch zu schmal

Der Plan passt **architektonisch** in Fast V2, aber nicht unverändert in das
heutige Capability Bundle. Der aktuelle öffentliche Stand ist bewusst eng:

- Capability Bundle: `fast-v2-remove-ranges-2026-08-01`;
- öffentliche Operationen: Segment-Split, Segment-Löschung und visuelles
  Frame-Grid;
- Fast V2 lehnt unerwartete normale Client-Tool-Batches ab.

Darum werden neue Fähigkeiten als **neue versionierte Capability Bundles und
öffentliche Operation Contracts** ergänzt. Fast V2 wird nicht durch einen
freien Tool-Katalog aufgeweicht. Eine neue Protokollgeneration ist nur nötig,
wenn die Wire-Semantik inkompatibel geändert werden muss; neue additive Events
und Capability-Versionen allein rechtfertigen noch kein „V3“.

### 2.3 Fast V2 ist das einzige neue öffentliche Agentenprotokoll

Alle in diesem Plan beschriebenen Fähigkeiten werden über die bestehende
**Fast-V2-Route** ausgeliefert. Es entsteht weder ein paralleler V3-Pfad noch
eine neue K2-Variante mit freien Browser-Tool-Batches.

Das bedeutet nicht, dass die gesamte Implementierung in einem einzigen
HTTP-Route-Handler lebt. Fast V2 ist der versionierte äußere Vertrag und die
Autoritätsgrenze; dahinter bleiben klar getrennte Kernel-Module:

| Verantwortlichkeit | Fast-V2-Vertrag | Ausführungsort |
|---|---|---|
| Turn, Resume, Cancel und Block-Stream | Fast-V2-Turn- und Event-Endpunkte | Edge und privater Kernel |
| Conversation-Historie, Skills und Capability-Auswahl | gepinnte Versionen und opaque Referenzen | privater Kernel |
| Edit-Dokument, Planung und Verifikation | typisierte Kernel-Ereignisse und Operation-Pläne | privater Kernel |
| Jobs, Decisions, Approvals und ChangeSets | additive Fast-V2-Events und gebundene IDs | privater Kernel |
| Projektmutation, Preview und Evidence-Rendering | öffentliche, versionierte Operation Contracts | lokale Editor-Engine |

Vorhandene K2-Transport-, Cursor- oder Reducerbausteine dürfen intern
wiederverwendet werden. Sie definieren jedoch weder die Fast-V2-Semantik noch
erlauben sie normale modellgewählte Client-Tool-Batches. Jeder neue
Browserpfad beginnt extern unter `/api/kernel/hosted-agent/v2/*` und wird intern
als `hosted-agent/v2/*` dispatcht. Er bestätigt die Fast-V2-Pins und akzeptiert
nur die für das aktive Capability Set veröffentlichten Operationen.

### 2.4 Autoritätsgrenzen

```text
React / FlashBoard UI
  - Benutzerprompt und Klicks
  - Darstellung des geordneten Block-Streams
  - lokale Preview-Overlays
  - keine Agenten-, Tool-Auswahl- oder Compilerlogik
                         │
                         ▼
MasterSelects Kernel
  - Provider- und Agentenloop
  - providerneutrales Conversation Journal und native Provider-Projektionen
  - Event-Journal und Replay
  - Skills, Playbooks und Capability Registry
  - Edit-Script-Dokument und Compiler
  - Job-Orchestrierung und Verifikation
  - Decisions, Approvals und ChangeSet-Metadaten
                         │
                         ▼
signierter, versionierter Operation-Plan
                         │
                         ▼
lokale Editor-Engine
  - liest den autoritativen lokalen Projektzustand
  - prüft Revision, Fingerprint und Operation Contract
  - simuliert oder führt deterministisch aus
  - rendert Evidence und importiert fertige Assets
  - schreibt genau einen History-Batch
```

„Alles im Kernel“ bedeutet in diesem Plan: keine semantische Agentenlogik im
Browser. Solange Projekt und Medien lokal liegen, muss die endgültige Mutation
lokal ausgeführt werden. Der Browser entscheidet jedoch weder, welches Tool
benötigt wird, noch wie ein Edit-Plan aufgebaut, korrigiert oder verifiziert
wird.

### 2.5 Umsetzungshaltung: Vollausbau, fix-forward

Entscheidung vom 2. August 2026: Die Fähigkeiten dieses Plans werden als ein
zusammenhängender Ausbau in der Paketreihenfolge aus Abschnitt 11 gebaut, nicht
als lange Folge einzeln freigeschalteter Minimal-Slices. Die Gates in
Abschnitt 11 sind Definition-of-Done-Checks je Paket, keine
Freischaltbedingungen. Fehler werden nach vorne gefixt.

Damit entfällt:

- Canary-Prozente sowie konto- oder kohortenweise Freischaltung;
- Feature-Flags pro Arbeitspaket; ein einzelner Kill-Switch bleibt als
  Notbremse;
- eine dauerhafte K2-Rollback-Reserve: K2 wird unmittelbar nach dem Cutover
  gelöscht statt beobachtend weitergepflegt;
- die dauerhafte Legacy-Projektion der Blocks in
  `text/activityEvents/toolCalls`; der Projektcodec migriert alte Chats
  einmalig;
- das Repräsentativkorpus- und Budget-Zeremoniell vor Produktionsausweitung;
  Contract- und Invariantentests bleiben.

Zwei bewusst enge Grenzen des heutigen Stands werden angehoben statt
verteidigt:

- `HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS` steigt von 4 auf einen Wert für
  echte Orchestrierung (Richtwert 16 bis 24); das Spend-Limit bleibt die
  eigentliche Bremse;
- das Ein-Tool-Bundle wird direkt durch die Familien aus Abschnitt 6.2
  ersetzt, ohne künstliche Zwischenstufen.

Nicht aufgeweicht werden fünf Invarianten, weil sie der
Fix-forward-Mechanismus selbst sind:

1. Prompt-, Tool-, Modell- und Budgetautorität bleiben serverseitig;
2. Revision- und Fingerprint-Prüfung vor jeder Mutation;
3. genau ein atomarer History-Batch pro mutierendem Turn mit gebundenem Undo;
4. Preview-Token-Bindung für jedes Apply;
5. Billing-Idempotenz pro Runde.

Solange jede Agentenänderung atomar, fingerprintgeprüft und undo-fähig bleibt,
kostet ein durchgerutschter Fehler einen Klick Rückgängig statt eines
korrupten Projekts oder doppelter Abbuchungen. Das ist keine Vorsicht, sondern
die Bedingung dafür, dass Risiko billig bleibt.

Der Prod-Cutover folgt der Fähigkeit, nicht dem Kalender: Fast V2 geht auf
100 %, sobald es im Chat mehr kann als K2 (Blocks, Kernel-Historie,
Transcript-Edit). Vorher wäre der Wechsel ein Downgrade auf einen amnesischen
Ein-Tool-Agenten, danach gibt es keine Beobachtungsfrist.

### 2.6 Orchestrierungsmodell: Claude orchestriert, Codex-Worker bauen

Die Umsetzung läuft als orchestrierter Parallelbau über beide Repositories
(öffentliches Editor-Repo und privates Kernel-Repo):

- **Orchestrator: Claude Code.** Zuständig für Scoping und Zuschnitt der
  Arbeitsitems, Lane-Vergabe mit disjunkter Datei-Ownership, Integration und
  Konfliktauflösung, Evidenzprüfung, die Build-/Lint-/Test-Kette und Commits.
  Worker committen nie selbst.
- **Worker: Codex-CLI-Agents** (gpt-5.6-sol, Reasoning high, fast). Worker
  schreiben ausschließlich Code entlang eines präzise zugeschnittenen
  Auftrags; sie haben kein Review-, Scope- oder Architekturmandat.
  Sandbox-Aufruf mit workspace-write und den bekannten
  `exclude_tmpdir_env_var`/`exclude_slash_tmp`-Overrides.
- **Lanes: bis zu 10 parallel, im selben Worktree je Repo.** Kein
  Worktree-Splitting (Junction-Setups brechen die Vitest-Suite, und
  Merge-Overhead frisst den Parallelgewinn). Kollisionsfreiheit entsteht
  durch Datei-Ownership statt Isolation: Kein Pfad gehört zeitgleich zwei
  Lanes. Geteilte Contract- und Typdateien legt der Orchestrator (oder eine
  einzelne Vorab-Lane) sequenziell, bevor der Fan-out startet — P0-Verträge
  zuerst, dahinter parallelisieren die Pakete.
- **Refill statt statischer Zuordnung.** Lanes sind nicht an Pakete gebunden.
  Sobald eine Lane fertig und verifiziert ist, wird sie sofort mit dem
  nächsten Item aus dem aktuellen oder dem nächsten entsperrten Paket neu
  befüllt, bis der Plan abgearbeitet ist. Der Orchestrator hält dafür einen
  laufenden Backlog pro Paket.
- **Evidenzpflicht.** Ein Lane-Ergebnis zählt erst mit Evidenz, nie per
  Selbstauskunft. Jeder Worker liefert: Liste der geänderten Dateien,
  tsc-/Build-Ausgabe und gezielte Läufe der berührten Testdateien. Der
  Orchestrator verifiziert unabhängig: mtime-Prüfung der angeblich geänderten
  Dateien, Spot-Reads der Kernstellen, eigener Build-/Test-Lauf an jedem
  Integrationspunkt. Chat-sichtbares Verhalten wird zusätzlich end-to-end
  über die Dev-Bridge (`bridge_send_chat_message`) belegt, nicht nur per curl
  gegen den Kernel.
- **Integrationspunkte.** Paketgrenzen aus Abschnitt 11 sind die
  Integrationspunkte: volle Build-/Lint-/Test-Kette, Bridge-Smoke, dann ein
  Commit pro Integrationspunkt (Build vor Commit bleibt Pflicht).
- **Bekannte Grenze.** Im bisherigen Setup liefen maximal zwei
  Codex-Sandboxen stabil parallel. Beim ersten Fan-out wird die reale
  Parallelität gemessen und die Lane-Zahl daran gesetzt; das Ziel bleiben 10.

## 3. Was von ChatCut öffentlich erkennbar ist

ChatCut hat nicht seine gesamte Agentenimplementierung offengelegt. Das
Produktions-Frontend verrät aber relativ viele **Integrationsnähte**:

- eine langlebige Agenten-Session mit geordneten Text-, Narrations-, Tool-,
  Ask-User-, Done- und Error-Ereignissen;
- Tool-Namen und gruppierte Tool-Aufrufe;
- serverseitige generische Read/Write/Edit-Arbeitsschritte;
- ein synchronisiertes deklaratives Dokument namens `timeline.md`;
- `script_file_sync` mit `plannedWindows` für eine Live-Vorschau;
- die Quellen `read_script`, `write`, `edit` und `apply_script`;
- asynchrone Jobs mit Fortschrittsabfrage;
- Timeline-Frame-Rendering und anschließende visuelle Prüfung;
- mutierende Antworten, die eine „Save version“-Aktion aktivieren.
- eine Socket-basierte Session mit Sequenz-Replay, Resume, Cancel und
  Ask-User-Antworten;
- `ToolSearch`, einen Skills-Katalog und zur Laufzeit geladene
  Capability-Familien;
- einen cloud-synchronisierten Projektzustand, den serverseitige Tools direkt
  verändern können, während der Browser die Änderungen nachzieht;
- ausführliche einklappbare „Thought“-Blöcke zusätzlich zu sicheren
  Nutzerantworten.

Nicht öffentlich sichtbar sind unter anderem:

- der vollständige System-Prompt und die internen Skills;
- die genauen Tool-Schemas und Argumente im normalen Nutzerbetrieb;
- der Parser und Compiler für `timeline.md`;
- die serverseitige Projekt- und Session-Speicherung;
- Retry-, Billing-, Sicherheits- und Autorisierungslogik;
- die tatsächliche Implementierung der Editor-Tools.

Die Schlussfolgerung lautet daher: ChatCut zeigt im ausgelieferten Client genug
vom Protokoll, um die Architektur zu erkennen, aber nicht genug, um das Backend
zu kopieren. Für MasterSelects werden nur die belegten Interaktionsmuster
übernommen.

### 3.1 Lehren aus dem beobachteten Produktionsdurchlauf

Ein vollständiger realer Durchlauf mit Transcript-Remix, vertikalem TikTok-Cut,
vier parallelen Motion-Graphic-Jobs, Placement und Frame-Prüfung zeigte sowohl
die Stärke als auch die Grenzen dieses Modells:

- der Agent konnte breite Werkzeuge wie `inspect_asset`, `read_script`,
  `manage_timelines`, `edit_item`, `find_transcript`, `ToolSearch`,
  `submit_motion_graphic`, `track_progress`, `view_timeline_frames` und
  `smooth_audio` in einem fortlaufenden Turn kombinieren;
- die erste Interpretation erfüllte die gewünschte Einzelwort-Montage nicht
  und musste durch einen weiteren Benutzerturn korrigiert werden;
- während der Entwurfsphase wurden `write`, `edit` und `apply_script` mehrfach
  gegen den realen Projektzustand ausgeführt;
- ein Placement-Batch schlug teilweise fehl; der Agent las den Zustand erneut
  und platzierte die fehlenden Ergebnisse nachträglich;
- die Planung wechselte zwischen drei und vier Motion Graphics und zwischen
  „Canvas füllen“ und einem tatsächlich letterboxed platzierten Video;
- vier einzelne Prüfframes belegten nicht den vollständigen Animationsverlauf;
  ein noch nicht sichtbarer Reveal wurde aus dem erwarteten Timing abgeleitet
  und trotzdem als erfolgreich bezeichnet;
- eine erkannte Layoutwarnung blieb offen, während die finale Antwort bereits
  vollständigen Erfolg meldete;
- „Save version“ blieb eine nachgelagerte manuelle Aktion statt Bestandteil
  desselben gebundenen Turns.

MasterSelects übernimmt deshalb die sichtbare Arbeitsweise und breite
Capability-Orchestrierung, nicht jedoch die fortlaufenden realen
Zwischenmutationen oder die schwache Selbstbestätigung. Entwurf und Jobs bleiben
staged, der Projekt-Commit atomar und die finale Erfolgsbehauptung an vorher
festgelegte Verifikationsclaims gebunden.

## 4. Zielmodell: ein geordneter Chat-Block-Stream

### 4.1 Kanonischer Nachrichtenvertrag

Die heutige parallele Speicherung aus `text`, `activityEvents`, `toolCalls`,
`decisionId` und `kernelReport` wird langfristig durch eine geordnete
Blockliste ersetzt:

```ts
type ChatBlock =
  | {
      type: 'text';
      blockId: string;
      text: string;
      status: 'streaming' | 'complete';
    }
  | {
      type: 'narration';
      blockId: string;
      phase: 'inspecting' | 'planning' | 'acting' | 'verifying';
      text: string;
      status: 'streaming' | 'complete';
    }
  | {
      type: 'tool';
      blockId: string;
      callId: string;
      name: string;
      label: string;
      status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'retrying'
        | 'success'
        | 'failed'
        | 'canceled'
        | 'interrupted';
      attempt?: number;
      groupId?: string;
      parentCallId?: string;
      startedAt?: number;
      completedAt?: number;
      argumentRef?: string;
      resultRef?: string;
      safeSummary?: string;
      errorCode?: string;
      error?: string;
    }
  | {
      type: 'progress';
      blockId: string;
      label: string;
      jobId?: string;
      groupId?: string;
      status?: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled';
      current?: number;
      total?: number;
    }
  | {
      type: 'decision';
      blockId: string;
      decisionId: string;
    }
  | {
      type: 'proposal';
      blockId: string;
      proposalId: string;
    }
  | {
      type: 'approval';
      blockId: string;
      approvalId: string;
    }
  | {
      type: 'evidence';
      blockId: string;
      evidenceId: string;
    }
  | {
      type: 'change-set';
      blockId: string;
      changeSetId: string;
    }
  | {
      type: 'verification-summary';
      blockId: string;
      verificationId: string;
      status: 'passed' | 'passed-with-warnings' | 'failed';
      unresolvedClaimIds: string[];
    };
```

Tool-Argumente, Resultate und binäre Evidence werden nicht in den sichtbaren
Block eingebettet. Der Block trägt autorisierte Referenzen sowie eine kleine,
dauerhaft speicherbare und redigierte Zusammenfassung. Für jede Referenz sind
Scope, Aufbewahrungsdauer und Verhalten nach Ablauf definiert, damit ein
Reload nicht zu leeren oder irreführenden Tool-Blöcken führt. Dadurch kann der
normale Chatverlauf sicher gespeichert und gerendert werden.

### 4.2 Kernel-Ereignisse

Der Kernel sendet ausschließlich idempotente Blockoperationen:

```ts
type ChatBlockPatch =
  | { blockType: 'text' | 'narration'; status: 'streaming' | 'complete' }
  | {
      blockType: 'tool';
      status: Extract<ChatBlock, { type: 'tool' }>['status'];
      attempt?: number;
      completedAt?: number;
      safeSummary?: string;
      errorCode?: string;
      error?: string;
    }
  | {
      blockType: 'progress';
      status?: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled';
      current?: number;
      total?: number;
    }
  | {
      blockType: 'verification-summary';
      status: 'passed' | 'passed-with-warnings' | 'failed';
      unresolvedClaimIds: string[];
    };

type ChatBlockEvent =
  | { kind: 'block-open'; block: ChatBlock }
  | { kind: 'block-delta'; blockId: string; offset: number; delta: string }
  | { kind: 'block-update'; blockId: string; patch: ChatBlockPatch }
  | { kind: 'block-complete'; blockId: string }
  | { kind: 'block-failed'; blockId: string; error: string };
```

Freie Objekt-Patches sind verboten. Parser lehnen unbekannte Felder und einen
nicht zum Blocktyp passenden Patch ab. Kanonische Events bleiben ungruppiert;
die Zusammenfassung aufeinanderfolgender gleicher Tool-Aufrufe ist nur eine
UI-Projektion und verändert das Replay-Journal nicht.

`block-delta.offset` bezeichnet die erwartete Zeichenposition vor Anwendung
des Deltas. Ein Replay desselben Events bleibt dadurch wirkungslos, während
eine Lücke oder abweichende Position einen gezielten Replay statt doppelten
Textes auslöst.

Jedes Event ist an `eventId`, `sessionId`, `turnId` und eine monotone Sequenz
gebunden. Derselbe Reducer verarbeitet Live-Events, Reconnect-Replays und
Reload-Resume. Provider-Deltas, Narration, Laufzeitstatus und finale Antwort
werden nicht länger über getrennte State-Pfade zusammengeführt.

### 4.3 Darstellung

Tool-Blöcke zeigen:

- blinkenden Punkt beziehungsweise Spinner während der Ausführung;
- einen lesbaren Titel statt des rohen Tool-Namens;
- vergangene Laufzeit und Abschlussdauer;
- Fehler direkt am zugehörigen Block;
- gruppierte aufeinanderfolgende identische abgeschlossene Calls;
- Argumente und Resultate ausschließlich in einem Dev-Details-Modus.

Der Work Log bleibt als kompakte alternative Ansicht möglich, ist aber nur
noch eine Projektion derselben Block-Daten und keine zweite Datenquelle.

Rohes Chain-of-Thought wird nicht angezeigt oder gespeichert. `narration`
enthält ausschließlich kurze, sichere, modellverfasste Arbeitsupdates.

## 5. Providerneutrale Cross-Turn-Historie im Kernel

Die heutige Umwandlung des Verlaufs in einen sehr großen String wird im
Hosted-/Fast-V2-Pfad entfernt.

Der Kernel hält pro `conversationRef`:

- ein providerneutrales kanonisches Conversation Journal;
- verlustarme OpenAI- und Claude-Projektionen mit nativen IDs, Text-,
  `tool_use`- und `tool_result`-Blöcken als Adapterzustand;
- Decision- und Approval-Ergebnisse;
- kompakte Evidence- und Projekt-Referenzen;
- serverseitige, providerbewusste Compaction;
- die jeweils verwendeten Prompt-, Skill- und Capability-Versionen.

Der Browser sendet bei einem Folgeturn nur den neuen Benutzerinhalt, den
`conversationRef`, einen frischen kompakten Projekt-Snapshot und explizite
Referenzen. Die sichtbaren `ChatBlock[]` sind das Nutzerjournal; die aktive
native Provider-Projektion ist der Arbeitsinput des Kernel-Agenten. Beide
werden nicht mehr ineinander serialisiert.

Das providerneutrale Journal bleibt die kanonische Wahrheit. Ein Modell- oder
Providerwechsel erzeugt daraus eine neue Projektion, statt den bisherigen
Verlauf als anbieterspezifischen String zu rekonstruieren. Projekt-, Tool- und
Evidence-Referenzen tragen Revision, Fingerprint und Scope; veraltete
Referenzen werden als `stale` markiert und niemals still gegen einen neueren
Projektzustand aufgelöst.

Datenschutz bleibt fail-closed: Transcript- und Szenentexte dürfen nur mit der
bereits vorgesehenen ausdrücklichen Freigabe an einen externen Provider
übermittelt werden. Der Kernel speichert keine unbeschränkten Tool-Resultate,
Data URLs oder Rohprompts im normalen Chat-Audit.

Aufbewahrung, Benutzerlöschung, Projektlöschung und Ablauf providerseitiger
Conversation-IDs erhalten explizite Policies. Ein abgelaufener nativer
Providerzustand darf über das kanonische Journal neu projiziert werden, ohne
abgelaufene Asset- oder Evidence-Berechtigungen wiederzubeleben.

## 6. Skills, Playbooks und Capability Discovery

### 6.1 Servereigene Capability Registry

Der Kernel registriert versionierte Familien, beispielsweise:

- `project-read`;
- `transcript-edit`;
- `timeline-edit`;
- `motion-graphics`;
- `audio-finishing`;
- `asset-generation`;
- `export`;
- `visual-verification`.

Pro Turn erhält das Modell eine kleine Basismenge von typischerweise 15 bis 30
Werkzeugen. Maßgeblich sind jedoch ein hartes Schema-Byte- und Promptbudget,
nicht eine starre Toolanzahl. Ein begrenztes Kernel-Werkzeug wie
`search_capabilities` kann zusätzliche registrierte Familien finden.

Das ist keine freie Plugin- oder Code-Ladefunktion:

- nur serverseitig registrierte und signierte Bundles;
- ein unveränderlicher `capabilityCatalogDigest` und eine feste
  Katalog-Schema-Version pro Agenten-Turn;
- ein `activeCapabilitySetDigest`, der sich nur durch ein auditiertes
  Kernel-Ereignis monoton auf eine erlaubte Teilmenge des gepinnten Katalogs
  erweitern kann;
- jede Operation trägt `capabilityCatalogDigest`, `capabilitySetId` und den
  zugehörigen `activeCapabilitySetDigest`;
- Browser-Requests können keine zusätzlichen Tools oder Schemas bestimmen;
- mutierende Capabilities müssen auf einen öffentlichen Operation Contract
  abgebildet sein.

`search_capabilities` liefert nur Descriptoren aus dem gepinnten Katalog. Eine
separate Kernel-Aktivierung prüft Schema-Budget, Turn-Modus, Benutzerrechte und
Risiko und schreibt anschließend ein replaybares `capability-set-changed`-
Ereignis. Der Browser kann weder suchen noch aktivieren noch den Katalogdigest
beeinflussen.

Skills und Playbooks leben ebenfalls im Kernel. Der Browser liefert keine
großen Tool- und Workflow-Prompts mehr an den Provider.

### 6.2 Capability-Erweiterung innerhalb Fast V2

Neue Familien werden schrittweise als eigenständige Bundles freigegeben:

1. `fast-v2-remove-ranges-*` bleibt der bestehende Referenzpfad;
2. `fast-v2-chat-blocks-*` ergänzt nur Event- und UI-Semantik;
3. `fast-v2-transcript-edit-*` ergänzt Read, Find, Preview und Commit;
4. `fast-v2-visual-verification-*` ergänzt Evidence-Rendering;
5. `fast-v2-async-media-*` ergänzt generation- und exportbezogene Jobs.

Ein Bundle wird nur aktiviert, wenn Edge, privater Kernel und Browser-Executor
dieselbe Contract-Version bestätigen.

## 7. Deklarativer Transcript-Edit-Plan

### 7.1 Kanonisches Format

MasterSelects verwendet intern kein frei interpretierbares Markdown, sondern
einen typisierten Plan mit stabilen Wortidentitäten:

```ts
interface TranscriptEditPlanV1 {
  schemaVersion: 1;
  documentId: string;
  base: {
    timelineRevision: number;
    stateFingerprint: string;
    transcriptFingerprint: string;
  };
  target: {
    compositionId: string;
    timelineId?: string;
  };
  segments: Array<{
    segmentId: string;
    sourceClipId: string;
    wordIds: string[];
    handleBeforeSeconds?: number;
    handleAfterSeconds?: number;
    repeat?: number;
    gapAfterSeconds?: number;
  }>;
  options: {
    preserveLinkedAudio: boolean;
    ripple: boolean;
    targetDuration?: {
      seconds: number;
      toleranceSeconds: number;
      mode: 'hard' | 'soft';
    };
    allowLongerPhrases: boolean;
    allowRepeats: boolean;
    allowInsertedSilence: boolean;
    joinPolicy: {
      crossfadeSeconds: number;
      minimumSegmentSeconds: number;
      preserveRoomTone: boolean;
    };
  };
}
```

Eine `timeline.md`-ähnliche Ansicht kann als menschenlesbare Projektion
angeboten werden. Die kanonische Wahrheit bleiben jedoch Word-IDs,
Fingerprints und typisierte Optionen; Markdown-Durchstreichungen sind kein
Ausführungsvertrag.

Jede Word-ID ist an Transcript-Revision, Quellzeitbereich und Timing-Konfidenz
gebunden. Mehrere gleiche Wörter bleiben durch unterschiedliche IDs
unterscheidbar. Der Compiler meldet zu kurze Schnipsel, unsichere Wortgrenzen,
fehlende Audio-Handles und unvereinbare Linked-Audio-Anforderungen, statt
solche Übergänge still zu erzeugen.

Die Zieldauer ist eine explizite Constraint. Wenn sie unter den erlaubten
Regeln nicht erreichbar ist, liefert die Preview einen Machbarkeitsbericht mit
minimaler und maximaler Dauer, Defizit, betroffenen Regeln und möglichen
Relaxationen. Der Kernel darf nicht selbständig von Einzelwörtern auf längere
Phrasen oder Wiederholungen wechseln, wenn der Benutzer diese Strategie nicht
freigegeben hat.

### 7.2 Kernel-Tools

1. `read_edit_script`
   - erstellt oder liest das Kernel-eigene Edit-Dokument;
   - bindet es an Transcript- und Projektfingerprint.

2. `find_transcript`
   - sucht mehrere Wörter und Phrasen parallel;
   - liefert stabile Word-IDs, Zeitbereiche und Mehrdeutigkeiten.

3. `patch_edit_script`
   - ändert Auswahl, Reihenfolge, Wiederholungen und Pausen;
   - erzeugt noch keine Projektmutation.

4. `preview_edit_script`
   - kompiliert und simuliert den Plan;
   - liefert Dauer, Planned Windows, Wortauswahl, Schnittanzahl, Warnungen,
     erwarteten Diff, simulierten Fingerprint, Machbarkeitsbericht,
     Verifikationsclaims und ein gebundenes Preview-Token.

5. `apply_edit_script`
   - akzeptiert ausschließlich ein gültiges Preview-Token;
   - bricht bei Drift oder abgelaufenem Approval ab;
   - führt genau einen atomaren History-Batch aus.

Ist das Transcript noch nicht bereit, wird seine Erzeugung als prerequisite
Job mit Fortschritt und Resume behandelt. Der Kernel wartet auf das
Transcript-Ready-Ereignis und setzt denselben Turn fort; er fragt den Benutzer
nicht wiederholt nach Informationen, die nur wegen eines laufenden Jobs fehlen.

### 7.3 Öffentliche Editor-Operationen

Der öffentliche Fast-V2-Vertrag erhält sinngemäß:

```ts
'timeline.transcript-assembly.preview.v1'
'timeline.transcript-assembly.commit.v1'
```

Der lokale Executor kann darunter bestehende Split-, Move-, Delete-, Ripple-
und Linked-Audio-Primitiven verwenden. Er veröffentlicht aber keine
Zwischenzustände. Preview bleibt nichtdestruktiv; Commit erzeugt genau eine
Timeline-Revision und einen History-Eintrag.

Damit entfallen während des Entwurfs:

- wiederholte reale Splits;
- wechselnde Clip-IDs;
- erneutes Einlesen nach jedem Split;
- halbfertige Timeline-Zustände;
- mehrere Undo-Schritte für einen Remix.

### 7.4 Live-Preview

Der Kernel besitzt Plan und Preview-Token. Der lokale Executor validiert den
Plan gegen den aktuellen Zustand und liefert autoritative `plannedWindows`,
Dauer und simulierten Fingerprint zurück. React zeichnet nur das daraus
abgeleitete Overlay. Preview-State ist flüchtig und kein Projektinhalt.

## 8. Asynchrone Jobs und visuelle Verifikation

### 8.1 Job-Orchestrierung

Motion Graphics, Mediengenerierung, Analyse, Audio-Finishing und Exporte laufen
als Kernel-Jobs:

```ts
type KernelJobState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled';
```

Der Kernel kann:

- mehrere unabhängige Jobs parallel starten;
- deren Fortschritt als `progress`-Blöcke streamen;
- Laufzeit, Kosten und Fehler pro Job verfolgen;
- fertige Ergebnisse zunächst als staged Assets über autorisierte
  Asset-Referenzen bereitstellen;
- lokale Importe und Placements über öffentliche Operation-Pläne anfordern;
- aufeinanderfolgende gleiche Jobs in der UI gruppieren.

Das Modell muss nicht selbst in kurzen Abständen blind pollen. Der Kernel
wartet auf Jobereignisse und setzt denselben Agenten-Turn danach fort.

Jeder Job besitzt einen semantischen Idempotency-Key aus Capability-Version,
normalisierten Eingaben, Projekt-Scope und beabsichtigter Verwendung. Retry,
Reconnect und Reload dürfen denselben externen Job nicht erneut starten. Eine
neue bewusste Generierungsvariante erhält dagegen eine neue Identität.

### 8.2 Staged Assets, Kosten und Adoption

Asynchrone Jobs mutieren das Projekt nicht direkt. Erfolgreiche Ergebnisse
landen in einem Kernel-eigenen Staging-Bereich mit:

- `stagedAssetId`, Eigentümer, Projekt-Scope und Content-Digest;
- Job-, Capability-, Provider- und Kostenreferenz;
- Erzeugungszeit, Ablaufzeit und Cleanup-Status;
- optionalem Preview und technischen Medienmetadaten;
- genau einer kontrollierten Adoption in einen öffentlichen Operation-Plan.

Erst der finale lokale Commit importiert beziehungsweise adoptiert staged
Assets zusammen mit ihren Placements. Abbruch, abgelaufene Freigabe oder ein
fehlgeschlagener Turn hinterlassen keinen halbfertigen Projektzustand. Die
Kosten eines bereits ausgeführten externen Jobs bleiben trotzdem im separaten
Job-/Billing-Ledger nachvollziehbar. Nicht adoptierte Assets werden nach einer
definierten Frist gelöscht oder dem Benutzer ausdrücklich zur späteren
Verwendung angeboten.

### 8.3 Claim-basierte Verifikationsphase

Vor Prepare beziehungsweise spätestens vor Commit erzeugt der Kernel ein
versioniertes Claim Set aus Benutzerauftrag, Proposal, Edit-Plan und
Capability-Contracts:

```ts
interface VerificationClaimBaseV1 {
  claimId: string;
  severity: 'required' | 'warning';
  evidencePolicyId: string;
}

type VerificationExpectationV1 =
  | { kind: 'state-diff'; expectedDiffDigest: string }
  | { kind: 'duration'; minimumSeconds: number; maximumSeconds: number }
  | {
      kind: 'canvas-layout';
      width: number;
      height: number;
      fitPolicy: 'crop' | 'letterbox' | 'either';
    }
  | { kind: 'text-visible'; text: string; atFrame: number }
  | {
      kind: 'temporal-animation';
      enterFrames: [number, number];
      holdFrames: [number, number];
      exitFrames: [number, number];
    }
  | { kind: 'audio-transition'; atSeconds: number; policyId: string }
  | { kind: 'caption-state'; enabled: boolean }
  | {
      kind: 'asset-placement';
      stagedAssetId: string;
      trackId: string;
      startFrame: number;
      endFrame: number;
    };

type VerificationClaimV1 = VerificationClaimBaseV1 & VerificationExpectationV1;
```

Claims beschreiben konkrete überprüfbare Zusagen, beispielsweise Zieldauer,
9:16-Canvas, zulässiges Cropping oder Letterboxing, Text zu einem Zeitpunkt,
Enter-/Hold-/Exit-Phasen einer Animation, Caption-Status, Audioübergänge und
vollständige Asset-Placements. Sie werden vor der Mutation festgeschrieben und
dürfen nicht nachträglich an das beobachtete Ergebnis angepasst werden.

Nach relevanten Mutationen führt der Kernel automatisch eine Verifikation aus:

1. Projektzustand, Revision und Fingerprint erneut lesen;
2. erwarteten gegen tatsächlichen Diff vergleichen;
3. alle Claims gegen deterministische State- und Medienmetriken prüfen;
4. relevante Timeline-Zeitpunkte und Zeitfenster bestimmen;
5. statische Frames, Frame-Sequenzen und Audio-Evidence rendern;
6. Evidence als kurzlebige, autorisierte Referenzen bereitstellen;
7. bei partiellem Fehler nur die fehlerhafte Planungskomponente neu berechnen,
   ohne einen partiellen Projektzustand zu veröffentlichen;
8. erst danach den Turn als `passed`, `passed-with-warnings` oder `failed`
   abschließen.

Der bestehende öffentliche Frame-Grid-Pfad ist hierfür die Ausgangsbasis.
Evidence-Blöcke tragen mindestens Frame-Zeiten, Projektfingerprint,
Erzeugungszeit und Verifikationsstatus.

Ein einzelner Frame darf keine Bewegung und kein Audio beweisen. Temporale
Claims benötigen mindestens eine gebundene Folge über Enter, Hold und Exit;
Audio-Claims benötigen strukturierte Übergangs- oder Pegelmetriken. Wenn ein
required Claim nicht belegt ist, darf die finale Antwort keinen vollständigen
Erfolg behaupten. Offene Warnungen erscheinen sowohl im
`verification-summary`-Block als auch in der Nutzerantwort.

Automatische Reparatur besitzt ein begrenztes Iterations-, Zeit- und
Kostenbudget. Nach dessen Ausschöpfung endet der Turn ehrlich mit verbleibenden
Claims statt mit einer selbstbestätigten Erfolgsmeldung. Für risikoreiche oder
subjektive Prüfungen kann ein separates Verifier-Profil verwendet werden, das
nicht denselben veränderbaren Planungszustand wie der ausführende Agent besitzt.

## 9. Decisions, Proposals und Approvals

Beliebige HTML-Widgets werden nicht übernommen. Der Kernel erzeugt nur
schema-validierte, kontrollierte Interaktionsobjekte.

### 9.1 Decision

- feste Optionen, optionale Mehrfachauswahl und ausdrücklich erlaubter
  Freitext;
- an Revision und Projektfingerprint gebunden, sofern die Entscheidung vom
  aktuellen Projektzustand abhängt;
- wird bei zwischenzeitlicher Änderung `stale`;
- Ergebnis wird als native Conversation-Nachricht weitergegeben.

### 9.2 Proposal

Ein Proposal enthält:

- verständliche Zusammenfassung;
- erwarteten Timeline-Diff;
- Preview- und Evidence-Referenzen;
- Kostenobergrenze;
- Risikostufe und betroffene Entitäten;
- Operation-Plan-Digest;
- Revision, Fingerprint und Ablaufzeitpunkt.

### 9.3 Approval

Eine Freigabe ist gebunden an:

- `proposalId` und Operation-Plan-Digest;
- Projektfingerprint und Revision;
- maximale Kosten;
- freigegebenen Ausführungsmodus;
- Ablaufzeitpunkt.

Destruktive Änderungen und externe Ausgaben können dadurch nicht durch eine
allgemeine frühere Zustimmung autorisiert werden.

Der aktuelle Benutzerauftrag kann zugleich eine eng begrenzte
Ausführungsautorisierung sein. Nicht jeder normale Schnitt benötigt deshalb
eine zusätzliche Bestätigung. Eine serverseitige Risikomatrix entscheidet
zwischen:

- sofortiger Ausführung innerhalb bereits freigegebener Operationen und
  Kostenlimits;
- Decision bei kreativer Mehrdeutigkeit;
- Proposal plus Approval bei destruktiven Änderungen, hohem Drift-Risiko,
  externen Kosten oder einer ausdrücklich gewünschten Vorschau.

Die Autorisierung enthält erlaubte Capability-Familien, Risikoklasse,
Kostenlimit, Projekt-Scope und Ablaufzeit. Der Kernel darf sie nicht aus einer
allgemeinen Zustimmung zu einem anderen Turn ableiten.

## 10. ChangeSets, Undo und Versionen

Jeder mutierende Agenten-Turn erzeugt genau ein ChangeSet:

```ts
interface KernelChangeSetV1 {
  changeSetId: string;
  turnId: string;
  historyBatchId: string;
  baseFingerprint: string;
  committedFingerprint: string;
  affectedEntities: string[];
  summary: string;
}
```

„Mutierend“ meint hier eine veröffentlichte Projektmutation. Externe Jobs können
bereits Kosten oder staged Assets erzeugt haben, ohne dass ein ChangeSet
entsteht. Deshalb werden drei Identitäten getrennt:

- `turnId` für Agentenlauf, Resume, Abbruch und finale Nutzerantwort;
- `jobLedgerId` für externe Arbeit, Kosten und staged Assets;
- `changeSetId` für genau eine atomar veröffentlichte Projektänderung.

Ein read-only, abgebrochener oder vor Commit fehlgeschlagener Turn besitzt ein
TurnOutcome und gegebenenfalls ein Job-Ledger, aber kein ChangeSet. Ein
erfolgreicher mutierender Turn besitzt höchstens ein ChangeSet. Reparaturen vor
Commit bleiben Teil desselben Turns und veröffentlichen keine zusätzlichen
History-Schritte.

Die finale Antwort erhält einen `change-set`-Block. Die UI zeigt abhängig von
der aktuellen Projektlinie:

- **Änderungen rückgängig machen**, wenn das ChangeSet noch der History-Kopf
  ist;
- **Version wiederherstellen**, wenn spätere kompatible Änderungen existieren;
- **Wiederherstellung prüfen**, wenn das Projekt inzwischen divergiert ist.

Eine alte Version wird nie blind über neuere Arbeit geschrieben. Bei Drift
erzeugt der Kernel zunächst einen Restore-Diff als Proposal. Die eigentliche
Wiederherstellung ist wieder ein neuer, atomarer und undo-fähiger ChangeSet.

### 10.1 Turn-Lifecycle und Unterbrechung

Fast V2 führt einen expliziten Turn-Lifecycle:

```ts
type KernelTurnState =
  | 'starting'
  | 'running'
  | 'waiting-for-prerequisite'
  | 'waiting-for-decision'
  | 'waiting-for-approval'
  | 'preparing'
  | 'committing'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'canceled';
```

Cancel ist in jedem nichtterminalen Zustand idempotent. Während `committing`
wird entweder der vollständig abgeschlossene Commit übernommen oder die lokale
Transaktion zurückgerollt; ein unklarer Zwischenzustand führt vor jeder
Fortsetzung zu Revision-, Fingerprint- und ChangeSet-Reconciliation. Resume
setzt niemals blind einen alten Operation-Plan gegen einen neueren
Projektzustand fort.

### 10.2 Sicherheit und unvertraute Projektinhalte

Transcripte, Dateinamen, Medienmetadaten, importierte Dokumente, Tool-Resultate
und generierte Assets sind unvertraute Daten. Sie können Fakten und
Projektinhalt liefern, aber keine Kernel-Instruktionen, Capability-Aktivierung,
Freigabe oder Autorisierung erzeugen.

Alle Provider-Eingaben tragen Herkunft und Trust-Klasse. Der Kernel trennt
System-/Skill-Instruktionen strukturell von Projektinhalt, begrenzt eingebettete
Texte und markiert Tool-Resultate als Daten. Asset- und Evidence-Referenzen sind
projekt- und benutzergebunden; Cross-Project-Zugriff, SSRF, beliebige Dateipfade
und die Wiederverwendung abgelaufener Referenzen werden fail-closed abgelehnt.

## 11. Arbeitspakete und Reihenfolge

Jedes Paket wird nach Abschnitt 2.6 in Lane-Items mit disjunkter
Datei-Ownership zerlegt; innerhalb eines Pakets bauen bis zu 10 Codex-Lanes
parallel, die Paketreihenfolge bleibt die Integrationsreihenfolge. Die Gates
sind Definition-of-Done-Checks am Integrationspunkt, keine
Freischaltbedingungen.

### P0 – Contract- und Fast-V2-Fundament

- bestätigen, dass alle neuen Browserendpunkte ausschließlich unter
  `/api/kernel/hosted-agent/v2/*` liegen;
- `ChatBlockV1`, `ChatBlockEventV1`, `CapabilityCatalogV1`,
  `ActiveCapabilitySetV1`, staged Asset-, VerificationClaim-, TurnOutcome-,
  Evidence- und ChangeSet-Verträge definieren;
- bestehende Fast-V2-Event-, Replay- und Reload-Invarianten beibehalten;
- Katalogdigest und aktiven Capability-Set-Digest getrennt serverseitig pinnen;
- Contract-Digest- und Cross-Version-Tests ergänzen.

**Gate:** Edge, privater Kernel und Browser lehnen jede nicht übereinstimmende
Version fail-closed ab; kein neuer Agentenpfad benötigt K2-Tool-Batches oder
eine parallele Protokollgeneration.

### P1 – Geordneter Block-Stream und Inline-Tool-UI

- `FlashBoardChatMessage` additiv um `blocks` erweitern;
- einen gemeinsamen idempotenten Block-Reducer implementieren;
- Provider-Deltas, Narration, Runtime- und Tool-Ereignisse dort einspeisen;
- Inline-Tool-Komponente mit Status, Laufzeit, Fehler und Gruppierung bauen;
- Dev-Details separat autorisieren;
- alte Chats einmalig per Projektcodec-Migration in Blocks überführen
  (keine dauerhafte Legacy-Projektion).

**Gate:** Live-Ausführung, Event-Replay und Reload ergeben bytegleich dieselbe
Blockreihenfolge.

### P2 – Transcript-Edit-Script als dünnen Fast-V2-Vertikalschnitt liefern

- stabile Word-IDs, Timing-Konfidenz und Transcript-Fingerprint festlegen;
- Edit-Dokument-Store und enges Transcript-Capability-Bundle implementieren;
- Machbarkeits-, Preview- und Commit-Operation Contracts ergänzen;
- Audio-Handle-, Crossfade-, Repeat-, Phrase- und Silence-Regeln festlegen;
- lokalen Simulator und atomaren Executor bauen;
- Timeline-Preview-Overlay anschließen;
- Transcript-Prerequisite-Job und Resume vertikal testen;
- Drift-, Linked-Audio-, Ripple- und Prompt-Injection-Tests ergänzen.

**Gate:** Beliebig viele Previews verändern das Projekt nicht; eine unmögliche
Zieldauer erzeugt einen ehrlichen Machbarkeitsbericht; ein Apply erzeugt genau
eine Revision und genau einen Undo-Schritt.

### P3 – Providerneutrale Kernel-Historie

- kanonischen Conversation Store pro `conversationRef` einführen;
- verlustarme native OpenAI- und Claude-Projektionen erhalten;
- Modell-/Providerwechsel und Neu-Projektion implementieren;
- serverseitige Compaction, Redaction, Retention und Löschung implementieren;
- stale Projekt-, Tool-, Asset- und Evidence-Referenzen erkennen;
- Browser-Flattening im Fast-V2-Pfad entfernen;
- vorhandene Chats über einen begrenzten Legacy-Import weiterführen.

**Gate:** Ein Tool-Ergebnis aus Turn N ist in Turn N+1 referenzierbar, ohne
einen 400.000-Zeichen-Prompt zu erzeugen; ein Providerwechsel erhält die
kanonische Semantik und belebt keine abgelaufene Berechtigung wieder.

### P4 – Capability Registry und Discovery verbreitern

- Registry und serverseitige Task-Klassifikation implementieren;
- kleine Standard-Bundles definieren;
- `search_capabilities` als allowlist-basiertes Discovery-Werkzeug ergänzen;
- Aktivierung als eigenen autorisierten Kernel-Schritt implementieren;
- Katalog- und Active-Set-Wechsel im Event-Journal und Audit festhalten;
- Tool-Schema-, Prompt-Token- und aktive Capability-Budgets messen.

**Gate:** Der Browser kann weder ein Tool hinzufügen noch den Katalog oder das
aktive Capability Set erweitern; jeder Set-Wechsel ist replaybar und bleibt
innerhalb des gepinnten Katalog- und Schema-Budgets.

### P5 – Async Jobs und Evidence

- Kernel-Jobmodell und parallele Gruppen ergänzen;
- Fortschrittsblöcke mit Jobereignissen verbinden;
- semantische Job-Idempotency-Keys und staged Asset Store implementieren;
- Cleanup, Kosten-Ledger und atomare Asset-Adoption definieren;
- opaque Asset-/Evidence-Referenzen mit Scope und Ablauf verwenden;
- Claim-Compiler aus Benutzerauftrag, Proposal und Operationsplan bauen;
- State-, Frame-Sequenz-, Layout- und Audio-Verifikation automatisieren;
- partielle Planungsfehler gezielt reparieren, ohne partiellen Projektzustand
  zu veröffentlichen.

**Gate:** Abbruch, Replay oder verlorenes Acknowledgement startet weder Job noch
Placement doppelt; ein einzelner Frame kann keinen temporalen oder Audio-Claim
bestehen; nicht adoptierte staged Assets werden nachvollziehbar bereinigt.

### P6 – Decision, Proposal, Approval und ChangeSet

- Storyboard-Decision-Verträge generalisieren;
- Proposal- und Approval-Blöcke ergänzen;
- Risikomatrix und auf den Benutzerauftrag begrenzte Autorisierung ergänzen;
- Freigaben an Digest, Kosten, Revision und Ablauf binden;
- TurnOutcome, Job-Ledger und ChangeSet getrennt persistieren;
- History-Batch und ChangeSet dauerhaft verknüpfen;
- Undo-/Restore-Buttons und Drift-Flow implementieren.

**Gate:** Keine alte Freigabe kann einen geänderten Plan ausführen; Restore
überschreibt keine divergierte Arbeit ohne neuen bestätigten Diff; normale
vorautorisierte Schnitte erzeugen keine unnötige zweite Bestätigungsrunde.

### P7 – Cutover und Rückbau

- Fast V2 in Produktion auf 100 % schalten, sobald Blocks, Kernel-Historie und
  Transcript-Edit funktionieren (Fähigkeitsüberholung gegenüber K2 im Chat);
- ein einzelner Kill-Switch bleibt; Canary-, Kohorten- und
  Paket-Flag-Mechanik entfällt (siehe 2.5);
- K2 unmittelbar nach dem Cutover vollständig entfernen: Edge-Route,
  Kernel-Service, Client-Pfad und das 400.000-Zeichen-History-Flattening;
- Telemetrie schlank mit IDs, Status, Fehlercodes, Sequenzen, Zeiten und
  Kosten;
- alten getrennten Chat-State nach der Projektcodec-Migration entfernen.

**Gate:** Fast V2 ist der einzige Chat-Pfad; Reload/Replay, Billing, Abbruch,
Drift und Security bestehen die vorhandenen Contract- und Invariantentests.

## 12. Abnahmeszenario

Der vollständige vertikale Test bildet den beobachteten ChatCut-Workflow nach,
schließt aber dessen erkannte Lücken:

1. Der Benutzer verlangt einen Einzelwort-Remix von ungefähr 30 Sekunden.
2. Das Transcript ist zunächst noch nicht bereit. Ein prerequisite Job zeigt
   Fortschritt und setzt denselben Turn nach `transcript-ready` fort.
3. Fast V2 pinnt einen Capability-Katalog und aktiviert nur Transcript- und
   Timeline-Capabilities aus diesem Katalog.
4. `find_transcript` sucht benötigte Wörter und Phrasen parallel.
5. Der Kernel erstellt und patcht einen Edit-Plan mit Audio-Join-Regeln.
6. Die erste Preview meldet beispielsweise 12 Sekunden; das Projekt bleibt
   unverändert.
7. Der Machbarkeitsbericht meldet, dass 30 Sekunden unter reinen
   Einzelwort-Regeln nicht erreichbar sind, und bietet klar benannte
   Relaxationen an.
8. Nur wenn erforderlich, entscheidet der Benutzer zwischen längeren Phrasen,
   Wiederholungen oder einem kürzeren Ergebnis.
9. Die zweite Preview meldet ungefähr 29 Sekunden und zeigt Planned Windows,
   erwarteten Diff und das vorab festgeschriebene Claim Set.
10. Eine nach Risikomatrix erforderliche Freigabe ist an Proposal, Digest,
    Kosten, Revision und Ablauf gebunden; ein bereits ausreichend
    autorisierender Benutzerauftrag benötigt keine redundante Bestätigung.
11. Vier Motion-Graphic-Jobs laufen parallel mit sichtbarem Fortschritt und
    erzeugen nur staged Assets.
12. Ein absichtlich verlorenes Job-Acknowledgement startet keinen Job doppelt.
13. Placement und Transcript-Assembly werden simuliert. Ein absichtlich
    fehlerhaftes Placement wird neu geplant, ohne partiellen Projektzustand zu
    veröffentlichen.
14. Ein Commit adoptiert die staged Assets und erzeugt genau einen atomaren
    Timeline- und History-Schritt.
15. State-Diff, Zieldauer, 9:16-Layout, Crop-/Letterbox-Regel, Caption-Status,
    Asset-Placements und Audioübergänge werden deterministisch geprüft.
16. Animationsclaims prüfen gebundene Frame-Sequenzen über Enter, Hold und Exit;
    vier beliebige Einzelbilder reichen nicht als Beweis.
17. Eine absichtlich offene Layoutwarnung erzeugt
    `passed-with-warnings` und erscheint in der finalen Antwort; ein fehlender
    required Claim verhindert die Erfolgsmeldung.
18. Die finale Antwort enthält TurnOutcome, Resultat, Evidence,
    Verification-Summary, ChangeSet und sichere Restore-Aktion.

Das Szenario muss zusätzlich Event-Duplikate, SSE-Reconnect, Reload,
verlorenes Result-Acknowledgement, Benutzerabbruch, Fingerprint-Drift und
konkurrierende Timeline-Änderungen überstehen. Es testet außerdem Abbruch nach
bereits bezahlter Generierung aber vor Commit, Kernel-Neustart während eines
prerequisite Jobs, Providerwechsel zwischen zwei Turns, abgelaufene Referenzen
und Prompt-Injection in Transcript beziehungsweise Medienmetadaten.

## 13. Voraussichtliche Code-Anker

### Öffentlicher Client und Editor-Executor

- `src/services/kernelClient/hostedAgent/contracts.ts`
- `src/services/kernelClient/hostedAgent/fastV2StartContract.ts`
- `src/services/kernelClient/hostedAgent/fastV2FetchTransport.ts`
- `src/services/kernelClient/hostedAgent/fastV2K2Adapter.ts`
- `src/services/kernelClient/wp1Spike/publicOperationContracts.ts`
- `src/services/kernelClient/wp1Spike/operationRoundTrip.ts`
- `src/services/kernelClient/wp1Spike/agentTransactionAdapter.ts`
- `src/services/flashboard/FlashBoardHostedAgentTransport.ts`
- `src/stores/flashboardStore/types.ts`
- `src/services/project/flashBoardChatProjectCodec.ts`
- `src/components/panels/flashboard/useFlashBoardChatController.ts`
- `src/components/panels/flashboard/FlashBoardChatOutput.tsx`

Neue Module sollten nach Verantwortlichkeit getrennt werden, beispielsweise:

- `src/services/flashboard/chatBlocks/*`
- `src/services/kernelClient/capabilities/*`
- `src/services/kernelClient/conversationJournal/*`
- `src/services/kernelClient/transcriptEditPlan/*`
- `src/services/kernelClient/stagedAssets/*`
- `src/services/kernelClient/verificationClaims/*`
- `src/services/kernelClient/turnLifecycle/*`
- `src/components/panels/flashboard/chatBlocks/*`

### Edge und privater Kernel

- `functions/lib/hostedAgent/route.ts`
- serverseitiger Conversation Store;
- serverseitiges Event-Journal;
- Capability Registry, gepinnter Katalog und Active-Set-Store;
- providerneutrales Journal und native Provider-Projektionen;
- Transcript-Edit-Dokument und Compiler;
- Job-Orchestrator, staged Asset Store und Cleanup;
- Claim-Compiler und Verifier;
- Proposal-, Approval-, TurnOutcome-, Job-Ledger- und ChangeSet-Store.

Die semantische Kernel-Implementierung liegt teilweise außerhalb dieses
öffentlichen Repositories. Öffentliche Contracts und kontrollierte Fixtures
müssen deshalb jede private Annahme testbar und versioniert machen.

## 14. Nicht-Ziele

- kein beliebiges Bash-, Read-, Write- oder Edit-Werkzeug im Browser;
- kein frei ladbarer Plugin-Code durch das Modell;
- kein Persistieren oder Anzeigen von Roh-Chain-of-Thought;
- keine Übernahme der ausführlichen ChatCut-„Thought“-Blöcke als Rohprotokoll;
- keine beliebigen modellgenerierten HTML-Widgets;
- keine Timeline-Mutation während der Edit-Script-Entwurfsphase;
- keine direkte Projektmutation durch asynchrone Jobs oder staged Assets;
- kein Beweis von Bewegung oder Audio durch einen einzelnen statischen Frame;
- keine nachträgliche Anpassung von Verifikationsclaims an das Ergebnis;
- keine Kernel-Instruktionen aus Transcript, Dateinamen, Medienmetadaten oder
  Tool-Resultaten;
- kein blinder Snapshot-Restore über neuere Projektarbeit;
- keine Aufweichung der Fast-V2-Fingerprints, Settlements oder
  Capability-Pins zugunsten schnellerer Implementierung;
- kein paralleles V3- oder neues K2-Agentenprotokoll für die beschriebenen
  Fähigkeiten;
- kein Anspruch, ChatCuts privaten Compiler oder Backend-Code nachzubauen.

## 15. Definition of Done

Der Plan ist vollständig umgesetzt, wenn:

- alle neuen Agentenfähigkeiten über `/api/kernel/hosted-agent/v2/*`,
  versionierte
  Fast-V2-Events und öffentliche Operation Contracts laufen;
- alle sichtbaren Chatbestandteile aus einem geordneten, replaybaren
  Kernel-Block-Stream stammen;
- Fast V2 ein providerneutrales kanonisches Cross-Turn-Journal und verlustarme
  native Provider-Projektionen besitzt;
- Capability-Katalog, Discovery, Aktivierung und Skills vollständig
  serverseitig kontrolliert und getrennt gedigested sind;
- Transcript-Remixe ohne Zwischenmutationen entworfen und atomar angewendet
  werden;
- nicht erfüllbare Edit-Constraints einen ehrlichen Machbarkeitsbericht statt
  einer stillen Strategieänderung erzeugen;
- parallele Jobs und deren Fortschritt nach Reload korrekt fortgesetzt werden;
- Jobs semantisch idempotent sind und Ergebnisse bis zum Commit staged bleiben;
- jede Mutation gegen vorher festgeschriebene State-, Layout-, Temporal- und
  Audio-Claims verifiziert wird;
- fehlende required Claims einen Erfolg verhindern und offene Warnungen in UI
  und Nutzerantwort erscheinen;
- Entscheidungen und Freigaben schema-, revisions-, digest- und
  kostengebunden sind;
- jeder mutierende Turn genau ein ChangeSet und eine sichere
  Undo-/Restore-Aktion erzeugt;
- TurnOutcome, Job-Ledger und ChangeSet getrennt reconciled und auditiert
  werden;
- kein Browserpfad Agentenplanung oder freien Tool-Dispatch besitzt;
- unvertraute Projektinhalte keine Instruktions- oder Autoritätsgrenze
  überschreiten können;
- Abbruch, Replay, Resume, Providerwechsel, Billing, Cleanup und Drift durch
  Contract- und Invariantentests nachgewiesen sind und K2 entfernt ist.
