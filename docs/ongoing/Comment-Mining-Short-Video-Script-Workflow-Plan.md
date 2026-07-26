# Comment-Mining-Workflow für dual-wirksame Kurzvideo-Skripte

Status: **Entwurf zur Review**  
Stand: 26. Juli 2026  
Entscheidungsrichtung: **Bestehende MasterSelects- und Drittanbieter-Funktionen
wiederverwenden; keinen eigenen Scraper oder neuen Skriptgenerator bauen.**

## 1. Ziel

Ein wiederholbarer Workflow soll aus einem realen, anonymisierten Kommentar
oder einem eindeutig gekennzeichneten Beispielkommentar ein drehfertiges Skript
für TikTok, Reels und LinkedIn erzeugen.

Das Ergebnis muss:

- den Kommentar als Hook-Grundlage verwenden;
- Azubis und Teenager auf Augenhöhe validieren;
- Fachkräften ab 30 eine konkrete Leadership-Maxime geben;
- das Zielobjekt nur passiv als Hintergrund oder Metapher verwenden;
- eine in einem Satz teilbare Kernprämisse besitzen;
- als Tabelle mit `Sequenz-Phase`, `Zeit (Sekunden)`,
  `Visuell (Bild/Schnitt/Overlay-Text)` und `Audio (Gesprochener Text)`
  vorliegen;
- ohne weiteren redaktionellen Umbau aufgenommen werden können.

## 2. Leitentscheidung: konfigurieren statt neu bauen

### Sofort nutzbarer Kern

MasterSelects besitzt bereits die benötigte Modell- und Prompt-Infrastruktur:

- FlashBoard Chat enthält unter anderem Claude Fable 5 und GPT 5.6 Sol.
- System-Prompts lassen sich projektbezogen speichern, laden und kopieren.
- Der Prompt Book hält Chatverläufe und Prompts für die Wiederverwendung fest.
- Der Kontextversand lässt sich pro gespeichertem System-Prompt abschalten.

Der erste produktive Stand benötigt daher **keine Quellcodeänderung**:

1. Den finalen Content-Strategie-Prompt als System-Prompt-Preset speichern.
2. Pro Skript nur ein kompaktes Briefing und den Kommentar eingeben.
3. Das Ergebnis im Prompt Book prüfen und kopieren.
4. Aufnahme und dynamische Untertitelung im bestehenden Editor durchführen.

### Externe Comment-Mining-Quelle

Echte Kommentare werden zunächst manuell oder per Export in das Briefing
übernommen. Für größere Mengen werden bestehende Dienste getestet:

| Kandidat | Erwarteter Nutzen | Vor Kauf zu verifizieren |
|---|---|---|
| [Adlicio](https://tryadlicio.com/) | Kundenformulierungen, Einwände, Hooks und Skripte innerhalb bestehender KI-Tools | Welche TikTok-/Instagram-Daten in Deutschland tatsächlich abrufbar sind; Exportformat; Nutzungsrechte |
| [Tik Analyzer](https://tikanalyzer.com/) | TikTok-Kommentare und Antworten analysieren; Themen und Skriptansätze ableiten | Zuverlässigkeit bei Login/Rate-Limits; Datenschutz; Exportqualität; Wartbarkeit der Desktopsoftware |
| [CommentScout](https://www.commentscout.ai/) | Schneller Ideenfeed aus realen TikTok-Kommentaren | Eignung für eigene Nischen und deutsche Kommentare; Nachvollziehbarkeit der Quellen |

Anbieterbeschreibungen sind noch kein technischer oder rechtlicher Nachweis.
Jeder Kandidat durchläuft deshalb einen kurzen Realtest mit öffentlichen,
nicht-sensiblen Daten. Bis ein Dienst den Test besteht, bleibt Copy/Paste der
verlässliche Fallback.

### Video-Fertigstellung

- [TikTok Symphony Creative Studio](https://ads.tiktok.com/help/article/about-symphony-creative-studio)
  kann optional TikTok-orientierte Storyboards, Skripte, Captions und Videos
  erzeugen.
- [CapCut](https://www.capcut.com/tools/desktop-ai-power) kann optional
  Script-to-Video und Auto-Captions übernehmen.
- Für MasterSelects ist keine dieser Plattformen Voraussetzung. Der Workflow
  muss auch vollständig mit FlashBoard, Prompt Book und dem bestehenden Editor
  funktionieren.

## 3. Verbindlicher Nutzerfluss

### Schritt A: Kommentarquelle wählen

Genau einer dieser Modi wird pro Skript angegeben:

1. `REAL_ANONYMIZED` — echter Kommentar, Name und identifizierende Details
   entfernt; bevorzugter Modus.
2. `PARAPHRASED` — reale Aussage sinngemäß verdichtet; Overlay trägt
   `sinngemäß`.
3. `COMPOSITE` — aus mehreren Beobachtungen zusammengesetzter Beispielkommentar;
   Overlay trägt `typischer Kommentar` oder `Beispiel`.

Ein KI-generierter oder zusammengesetzter Kommentar darf nie wie ein belegter
Originalkommentar dargestellt werden. Kommentare Minderjähriger werden nicht
mit Namen, Profilbild, Handle, Schule, Betrieb oder Standort reproduziert.

### Schritt B: Kurzbriefing eingeben

```text
Zielobjekt/Dienstleistung:
Branche:
Primäre Zielgruppe:
Kommentar-Modus: REAL_ANONYMIZED | PARAPHRASED | COMPOSITE
Kommentar:
Schmerzpunkt: konkret | AUTO
Gewünschte Länge: 20–45 Sekunden
Plattformpriorität: TikTok | Reels | LinkedIn | ausgewogen
Ton/Markenstimme:
No-Go-Begriffe:
```

Wenn `Schmerzpunkt: AUTO` gewählt ist, leitet das Modell genau einen konkreten
Schmerzpunkt aus dem Kommentar ab. Bei leerem Kommentar im Modus `COMPOSITE`
erzeugt es einen plausiblen Beispielkommentar und kennzeichnet ihn sichtbar als
solchen.

### Schritt C: Modelllauf

Für die Qualitätsprüfung werden zunächst beide vorhandenen Spitzenmodelle
verwendet:

- Claude Fable 5 für sprachliche Natürlichkeit, Augenhöhe und Dramaturgie.
- GPT 5.6 Sol mit hoher Reasoning-Stufe für Regelkonformität, Timing und
  strukturelle Kontrolle.

Nach dem Benchmark wird ein Standardmodell gewählt. Das zweite Modell bleibt
Reviewer für schwierige oder besonders sensible Skripte. Ein dauerhafter
Doppellauf ist nur sinnvoll, wenn sein Qualitätsgewinn die zusätzlichen Credits
rechtfertigt.

### Schritt D: Ausgabe

Die sichtbare Antwort enthält ausschließlich die verlangte Tabelle. Der
System-Prompt verlangt vor der Ausgabe eine stille Selbstprüfung gegen die
Akzeptanzkriterien aus Abschnitt 5.

Die Tabelle folgt zwingend diesem Ablauf:

1. Hook, Sekunde 0–3, mit eingeblendetem Kommentar und genau einer der vier
   Hook-Strategien;
2. radikale Validierung des konkreten Schmerzes;
3. strategische Einordnung und Handlungsmaxime aus Führungsperspektive;
4. Payoff mit Empowerment und Leadership-Statement.

Jede neue Informationseinheit erhält einen neuen visuellen Cut. Die Audio-Regie
lautet `ruhige stimmliche Autorität`; das Pacing lautet `Zero Dead Space`.
Dynamische, plattformnative Untertitel sind in den visuellen Anweisungen
verbindlich.

### Schritt E: menschliche Freigabe

Vor Aufnahme bestätigt eine Person:

- Kommentarquelle und Kennzeichnung sind korrekt.
- Der Text spricht nicht stellvertretend für eine konkrete minderjährige Person
  ohne deren Einwilligung.
- Der Hook enthält keine Produkt- oder Dienstleistungsnennung.
- Das Zielobjekt bleibt passiv.
- Validierung bedeutet nicht pauschale Tatsachenbehauptung über einen Betrieb
  oder eine Branche.
- Der Leadership-Teil enthält eine handlungsfähige Maxime statt Imagepflege.
- Das Skript ist in der angegebenen Zeit natürlich sprechbar.

## 4. System-Prompt-Vertrag

Der vorhandene Nutzertext wird als System-Prompt redaktionell gehärtet, aber
nicht in seiner Strategie verändert. Zusätzlich werden folgende maschinenprüfbare
Regeln aufgenommen:

- Wähle genau eine Hook-Strategie und nenne ihren Namen nicht im gesprochenen
  Text.
- Keine Produkt-, Marken- oder Dienstleistungsnennung zwischen Sekunde 0 und 3.
- Das Zielobjekt darf keine aktive Problemlösung durchführen und keinen
  Verkaufssatz erhalten.
- Schreibe nicht herablassend, verniedlichend oder in künstlicher Jugendsprache.
- Vermeide unbelegte Rechts-, Gesundheits- oder Sicherheitsbehauptungen.
- Die Kernprämisse muss in genau einem Satz innerhalb des Payoffs verständlich
  werden.
- Zeitsegmente müssen monoton, lückenlos und innerhalb der Zieldauer liegen.
- Kein Audiosegment darf nur wiederholen, was das Overlay bereits vollständig
  sagt.
- Gib nur die vierspaltige Markdown-Tabelle aus.

Der Prompt wird als Projekt-Preset mit einem eindeutigen Namen gespeichert,
zum Beispiel:

`Dual Audience – Comment Mining Short Script`

Für reine Skripterstellung wird `sendContext: false` verwendet, damit
Timeline- und Projektdaten nicht unnötig in den Modellkontext gelangen.

## 5. Abnahmekriterien

### Harte Gates pro Skript

- 100 %: vier geforderte Phasen in richtiger Reihenfolge.
- 100 %: Kommentar ist in Sekunde 0–3 sichtbar.
- 100 %: keine Produktnennung im Hook.
- 100 %: Zielobjekt nur passiv oder metaphorisch.
- 100 %: Quelle ist `REAL_ANONYMIZED`, `PARAPHRASED` oder `COMPOSITE` und
  entsprechend gekennzeichnet.
- 100 %: Ausgabe besitzt exakt die vier verlangten Spalten.
- 100 %: Zeitsegmente sind lückenlos, widerspruchsfrei und innerhalb der
  Zieldauer.
- 100 %: dynamische Untertitel, ruhige Autorität und Zero Dead Space sind als
  Regieanforderungen enthalten.

### Qualitative Mindestwerte

Jedes Kriterium wird von zwei Personen auf einer Skala von 1 bis 5 bewertet:

- Augenhöhe und psychologische Sicherheit für Azubis/Teenager: mindestens 4,0.
- Glaubwürdige Schutz- und Führungsfunktion für Fachkräfte: mindestens 4,0.
- Natürlich sprechbarer deutscher Text: mindestens 4,0.
- Teilbarkeit durch beide Zielgruppen: mindestens 4,0.
- Kernprämisse nach einmaligem Hören reproduzierbar: mindestens 80 % in einem
  kleinen Blindtest.

## 6. Validierungs-Benchmark

Vor jeder Produktintegration werden 20 Testskripte erzeugt:

- fünf Branchen mit jeweils unterschiedlichen Macht- und Ausbildungsdynamiken;
- alle vier Hook-Strategien mindestens viermal;
- mindestens fünf Eingaben ohne vorgegebenen Schmerzpunkt;
- mindestens fünf reale anonymisierte Kommentare;
- mindestens fünf paraphrasierte Kommentare;
- mindestens fünf Composite-Kommentare;
- kurze, lange, mehrdeutige und emotional eskalierte Kommentare.

Für jedes Skript werden festgehalten:

- Modell, Temperatur/Reasoning-Einstellung und Credits;
- Prompt-Version;
- Gate-Verstöße;
- qualitative Bewertung;
- benötigte manuelle Korrekturzeit;
- finale Freigabe oder Ablehnung.

Die Prompt-Version gilt als validiert, wenn:

- alle harten Gates in mindestens 19 von 20 Erstläufen erfüllt sind;
- kein Kommentar fälschlich als echt dargestellt wird;
- der qualitative Mittelwert jedes Modells dokumentiert ist;
- die mediane manuelle Korrekturzeit unter fünf Minuten liegt.

## 7. Gestufte Umsetzung

### P0 — Prompt-only Pilot, keine Codeänderung

Ziel: beweisen, dass der vorhandene Stack die Aufgabe zuverlässig erfüllt.

Arbeit:

1. System-Prompt finalisieren und als Projekt-Preset speichern.
2. Benchmark-Datensatz mit 20 Briefings anlegen.
3. Fable 5 und Sol 5.6 gegeneinander testen.
4. Ein Standardmodell und einen Review-Pfad bestimmen.
5. Zwei externe Comment-Mining-Dienste mit denselben fünf Suchthemen testen.

Stop-Bedingung: Wenn die harten Gates oder die Korrekturzeit verfehlt werden,
wird zuerst der Prompt verbessert. Es wird noch keine neue UI und kein
Connector gebaut.

### P1 — Minimaler MasterSelects-Preset, nur nach erfolgreichem P0

Ziel: den validierten Prompt ohne manuelles Einrichten verfügbar machen.

Voraussichtlicher Write Set:

- neuer, domänenspezifischer Promptkatalog unter
  `src/services/flashboard/`;
- kleiner Template-Einstieg in der FlashBoard-Chatoberfläche;
- fokussierte Unit-Tests für Auswahl, Briefing-Injektion und unveränderte
  Benutzertexte;
- `docs/Features/FlashBoard.md`.

Nicht in `FlashBoardChatPlaybooks.ts` ablegen: Die bestehende Datei injiziert
knappe Werkzeug- und Editierregeln anhand von Schlüsselwörtern. Ein
Content-Strategie-Template ist ein explizit gewähltes Nutzerartefakt und darf
nicht zufällig durch Wörter wie `Kommentar` oder `TikTok` aktiviert werden.

P1 enthält weiterhin keinen Scraper, keine neue Modellroute und keinen neuen
durablen Store.

### P2 — Strukturierte Briefing-Maske, nur bei nachgewiesenem Bedarf

Trigger:

- mindestens 50 erstellte Skripte;
- wiederkehrende Eingabefehler in mehr als 15 % der Läufe;
- Nutzer wünschen explizit Felder statt Freitext.

Die Maske erzeugt ausschließlich das gleiche textuelle Briefing aus Schritt B.
Sie besitzt keine eigene Generierungslogik. Damit bleiben Prompt, Modelltransport
und Prompt Book die einzigen fachlichen Quellen.

### P3 — Externer Comment-Connector, standardmäßig zurückgestellt

Ein Connector wird nur geplant, wenn:

- ein Anbieter eine dokumentierte und für den Einsatzzweck lizenzierte
  API oder einen stabilen Export besitzt;
- deutsche Kommentarqualität nachgewiesen ist;
- Datenschutz, Löschfristen und Auftragsverarbeitung geklärt sind;
- die manuelle Übernahme messbar zum Engpass geworden ist.

Der Connector wäre eine serverseitige Provider-Integration mit expliziter
Nutzeraktion. Keine Zugangsdaten oder Plattform-Sessions gelangen in Projektdatei
oder Client-Store. Ein eigener TikTok-/Instagram-Scraper bleibt außerhalb des
Scopes.

## 8. Tests bei einer späteren Codeänderung

Während P0 sind keine Repository-Tests erforderlich, weil kein Produktcode
geändert wird.

Für P1 oder später:

- Unit-Test: Template-Auswahl verändert gespeicherte Prompts nicht.
- Unit-Test: alle Briefing-Felder werden korrekt escaped und unverändert
  übertragen.
- Unit-Test: `sendContext: false` bleibt bei der Vorlage erhalten.
- UI-Test: Auswahl, Abbruch, Zurücksetzen und erneutes Öffnen.
- Regression: normaler FlashBoard-Chat und bestehende Edit-Playbooks bleiben
  unverändert.
- Fokussierter TypeScript-Build und relevante Vitest-Suite pro Work Packet.
- Vor einem normalen Commit/Push vollständige Repository-Gates gemäß
  `AGENTS.md`.

## 9. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Synthetischer Kommentar wirkt wie echte Aussage | verpflichtender Quellenmodus und sichtbare Kennzeichnung |
| Minderjährige werden identifizierbar | harte Anonymisierung und menschliche Freigabe |
| Modell verfällt in künstliche Jugendsprache | Systemregel gegen Slang-Imitation; Jugend-Review im Benchmark |
| Leadership-Botschaft wird Eigenwerbung | Zielobjekt passiv; konkrete Schutzhandlung statt Markenclaim |
| Scraper verstößt gegen Plattformregeln oder fällt aus | kein eigener Scraper; manueller Fallback; Anbieterprüfung |
| Drittanbieter verändert Preis oder Funktion | Anbieter als austauschbare Quelle, nicht als Kernarchitektur |
| Ein Modell erfüllt Format, aber nicht Haltung | getrennte harte Gates und qualitative Doppelbewertung |
| Doppellauf verbraucht unnötig Credits | nach Benchmark ein Standardmodell wählen |

## 10. Go/No-Go-Entscheidung

Nach P0 wird genau eine der folgenden Entscheidungen dokumentiert:

1. **Go ohne Produktänderung:** Gespeicherter Prompt plus manuelle
   Kommentarübernahme reicht aus.
2. **Go für P1:** Qualität ist gut, aber das manuelle Einrichten des Prompts ist
   der einzige relevante Reibungspunkt.
3. **Go für P2:** Wiederkehrende Briefingfehler rechtfertigen eine kleine Maske.
4. **Prüfung P3:** Nur der Datentransfer ist ein belegter Engpass und ein
   geeigneter Anbieter erfüllt API-, Datenschutz- und Qualitätsgates.
5. **No-Go:** Der Ansatz erzeugt trotz Prompt-Iteration keine glaubwürdige
   Augenhöhe oder birgt nicht beherrschbare Quellen-/Persönlichkeitsrisiken.

Der Default bleibt Entscheidung 1: **Workflow nutzen, nichts Neues bauen.**
