[Back to Documentation Index](./README.md)

# Story Workflow

Story turns a prompt and stored project sources into a reviewable production package before any video generation is started. It is available on the landing page and as the editor's dockable Story panel. The private kernel owns story and prompt planning; the public editor owns source retrieval, review state, image generation calls, and deterministic persistence. Existing `seedance*` source, store, route, and persistence names remain internal compatibility identifiers; Seedance 2.5 is shown only when it identifies the concrete video generator.

## Editor Story Panel

The Media Panel keeps the normal chat composer. Its prompt-path control contains only `Auto` and `Story`; selecting Story and pressing the shared Chat button starts the workflow with the current prompt and referenced video sources, or all project videos when none are referenced. The editor then activates a real dockable Story panel and displays the active run there.

Story contains direction selection, treatment and scene map, source review, master looks, keyframes, progress, errors, and final review. It does not mirror Media chat, create another input box, or render the landing-page background. One editor-level controller owns the run so docking, moving, or reopening Story preserves the same state. The controller's automatic resume is disabled on the factory-start layout because the landing page already owns its workflow there.

## Workflow

1. Store project documents and media-derived source context.
2. Choose one of five production directions.
3. Review the kernel-produced story as a scene production map.
4. Let the kernel decide whether a human source-reference review is needed.
5. When required, search Wikimedia Commons and deselect unsuitable factual references.
6. Otherwise skip Sources and start the four master looks directly.
7. Choose a master look, review keyframes, and copy the final generation packages.

The kernel can also choose a direct-edit route before those later stages. For
a short request such as a roughly 30-second cut using already selected project
footage, it may skip scene reviews, Commons research, and image-choice rounds.
After the user selects a direction, the orchestrator compiles and executes the
fresh edit plan directly against only the selected source files. Unselected
project media is visually muted and is excluded from timeline/source lookup.
This decision belongs to the private kernel; the public editor only exposes the
bounded source selection and executes the returned atomic edit operations.

Provider calls are not made by expanding or reading the production map. The map is a review surface for the already retained story and research state.

Concept directions only carry a duration when the user explicitly requested one. Otherwise the story planner derives the natural duration from the chosen direction, project sources, and pacing.

## Scene Production Map

Each scene is displayed as ordered production beats:

- the authoritative voiceover or dialogue is on the left;
- camera and visual direction is on the right at the same vertical level;
- practical footage, reconstruction, motion-graphic, and designed-visual tags describe the production route;
- matched Commons thumbnails appear directly below the relevant visual direction;
- empty or failed Commons searches remain visible instead of being reported as generic “no images” results;
- visual beats without a direct structured research requirement are labelled `No Commons search planned`.

The header reports scene count, visual-beat count, retained Commons images, visual beats without a direct search, and search gaps. This distinguishes production coverage from the raw number of downloaded images.

The editor only displays and executes structured requirements supplied with the story. It does not create provider-facing research plans from prose in the public client. Consequently, `Retry Commons search` repeats the saved requirements of the current run; it cannot add a newly noticed object such as a receipt unless that requirement is present in the story plan.

## Commons Research

Research runs sequentially across every bounded story requirement. Each requirement records:

- the original requested query;
- every simplified query variant attempted;
- success, empty-result, or failed-request status;
- retained result count and bounded error text.

The client removes generic Commons/media wording, tries focused fallback variants, filters obviously unrelated results, de-duplicates files by Commons page ID, and paces requests to reduce rate limiting. A 429 response is retried once using the bounded server-provided delay.

The local development server proxies `/api/media/*` to the Cloudflare Pages development API. Search, token refresh, and download routes use manual redirect handling because Cloudflare Workers do not implement `redirect: "error"` at the edge.

## Review And Import

The kernel treatment decides whether human source review is required. Internal project-frame verification does not by itself open Sources; when project material covers the plan, the editor advances directly to master-look generation. If review is required, search results are selected by default but remain reversible in the source-review grid. Continuing imports only selected Commons files into the media store. Import URLs are never accepted directly from the browser: the API signs a short-lived import token containing the trusted Commons original URL, title, and MIME type. Expired tokens can be refreshed by Commons page ID.

The API accepts licensed image media only, enforces a 40 MB limit, and returns attribution metadata with every result. Embedded import tokens and image payloads are redacted or omitted from durable bridge traces.

## Current Boundary

- A saved run can retry its existing Commons requirements without regenerating the story.
- The private orchestrator decides at the beginning whether the chosen request
  needs the review pipeline or qualifies for the direct selected-footage edit.
- Older runs without an explicit review decision use a conservative compatibility check based on external references and Commons routes.
- A saved run cannot synthesize additional provider-planned requirements from visual prose.
- A future private-kernel asset-planning stage can provide exhaustive per-beat Commons, filming, generation, graphic, and reconstruction routes; the public scene map already exposes missing direct searches and processes all requirements it receives.

## Relevant Code

- `src/marketing/SeedancePreproductionWizard.tsx`
- `src/marketing/SeedanceAssetChecklist.tsx`
- `src/marketing/useSeedancePreproductionController.ts`
- `src/components/story/SeedanceEditorWorkflowContext.tsx`
- `src/components/story/StoryPanel.tsx`
- `src/services/seedancePreproduction/commonsClient.ts`
- `src/services/seedancePreproduction/commonsSearchPlanning.ts`
- `functions/api/media/commons/`
