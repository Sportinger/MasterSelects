---
title: "Notebook"
---

Open **View → Editing → Notebook** or use a dock **+** button. An empty Notebook is immediately writable: typing creates the first note in one undo step. **New note** opens another blank writing surface. A title is optional; the first nonempty line names an untitled note in the note picker, Media panel and Story start screen. The active note is saved with the project.

The writing surface supports selection across paragraphs, Enter for a paragraph, Shift+Enter for a line break, paste, bold, italic, headings, lists and quotes. Search highlights actual text and provides previous/next navigation. The **Add** menu and a toolbar beside a text selection attach labels, scene ranges, comments and media links. A label changes no text or paragraph style; it can have a name and color, and labels may overlap. Scene ranges may cross paragraphs and have optional name, location, interior/exterior setting, time of day, labels and media. Click a scene in the annotation area to edit its properties, change its range, continue writing outside it or remove the scene mark while keeping the text. The **Focus** control hides supporting panels until **Exit focus** is selected.

Scene and label entries can be dragged from **Add** onto the current selection or another passage. The highlighted drop target is the range used by the drop. Media and annotations can also be dropped onto text. Keyboard and touch users can use selection and the Add controls. References whose passage was deleted remain repairable; a missing media target can be replaced or the reference removed.

The Notebook menu contains **Import**, **Rename note**, **Export text** and **Delete note**. Screenplays also offer PDF, Fountain and FDX export there. Files can be dropped onto the Notebook or Media panel for import. Imported PDFs appear in the **Notebook** strip of the Media panel; double-click one to open it. Project notes also appear among the Story start screen's project files.

**Write** shows editable project text. **Original** shows a preserved imported source, including the retained PDF pages for a newly imported PDF. For a screenplay written in the Notebook, the second view is **Production layout**. Older Story PDF imports retained extracted text but may not have the source pages; the panel marks those as **Extracted text only**. Re-import the PDF to make its original pages available.

The importer accepts PDF, TXT and other readable text files, Markdown, HTML, Fountain, FDX, DOCX, ODT and RTF. Formats with limited layout extraction are labelled in the panel. Scanned PDFs remain viewable in Original, but their text is not searchable without an OCR step. Files over 40 MB and extracted text over eight million characters are rejected rather than silently shortened.

Project saves write document revisions as separate versioned artifacts. Preserved binary originals, including PDF and supported office files, live in their own artifacts and are reused when only the editable text changes. Loading checks each artifact's digest before restoring the document and its original view.

Use **New screenplay** or turn on screenplay mode for the current note to access typed elements, Letter/A4 pages, page and scene locks, revisions, and PDF/Fountain/FDX export. Normal writing has no screenplay-specific Enter rules. Linked media opens in the Source monitor or timeline. Notebook changes participate in project save and undo/redo; consecutive typing is grouped into short undo steps.

In a screenplay, **Enter** at the end of a scene heading, character cue, parenthetical, transition, or page break creates the next appropriate element. **Enter** in an empty dialogue element changes it to action. **Ctrl/⌘+Enter** starts the next element from anywhere in a block; **Shift+Enter** inserts a line break within the current element.

Fountain import preserves scene headings and numbers, character cues (including forced `@` cues), parentheticals, dialogue, dual-dialogue cues, page breaks, and title/author/contact fields, including indented multiline fields, as screenplay structure. The **Original** view retains the Fountain source including its markup. Production pages place paired dialogue in parallel columns. Multi-page dialogue uses `(MORE)` and `(CONT'D)` on every continuation page, including locked page boundaries, in both the production view and PDF export.
FDX import and export preserve paired dialogue with a `DualDialogue` group and carry numbered scenes. Other Final Draft production metadata remains a best-effort import.

Select text and use **Annotate selected clip** to create a clip-scoped annotation linked back to the passage. **Drag passage to clip** does the same on the clip under the drop point; the timeline previews the target. The annotation covers the full clip, and undo removes both the annotation and document link together. Undo preserves the active document when it still exists in the restored snapshot.

Source-media and source-annotation links can be dragged from the document onto a compatible timeline track. A linked source interval becomes the inserted clip's in/out range; unbounded source links place the complete media. The timeline uses its usual drop preview and placement rules.

Locked screenplay pages use text-position anchors. Text inserted before a locked page can flow onto a suffixed page, while the locked page retains its number. Page locks follow edits in the anchored block, including changes to line wrapping.
