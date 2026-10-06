# Historical bilingual validation notes

> This file records earlier development builds and retained regressions. It is historical evidence, not a claim that the current `0.1.0-beta` candidate passed every check listed below. Some intermediate word-alignment behavior was later reverted. See the current public README and `RELEASE_READINESS.md` for the present behavior and pending checks.

Environment: Windows, Zotero 9.0.6, Node.js 24.19.0. Latest checks performed on 2026-10-06 for 2.4.8-bilingual.10.

## Automated checks

- Delivered 2.4.8-bilingual.10 production XPI: permanent-install regression passed in an isolated Zotero 9.0.6 profile, including active state, startup and automatic-update policy.

- TypeScript source and test type checks; ESLint on the added feature and modified hooks/prompt module.
- 21 existing upstream provider/prompt/thinking-parameter regression tests passed.
- Correction on 2026-10-06: the first delivered XPI omitted Zotero's mandatory non-empty update_url and could not install. Version 2.4.8-bilingual.2 restores that field and disables automatic updates at startup. A new AddonManager regression test permanently installed the exact delivered XPI, verified compatibility, active state, plugin startup and automatic-update policy in an isolated Zotero 9.0.6 profile.
- Twenty-one Node core tests (all passed): repeated/alternating headers and footer page numbers, single-page and nonzero-origin margins, footnotes and their continuations, list boundaries and section paths, small diagram labels, real titles sharing text with running headers; image/form transforms and repeated placements; RGB/RGBA/monochrome decoding; caption-adjacent figure bounds excluding whole-page backgrounds; font-based title segmentation and three-level numbered hierarchy; local protected spans for ordinary MT; silent-provider timeout; native reading-order preservation; references/equations; strict segment ID reconciliation; repeated-text coordinate matching; cross-page and persisted reverse mappings; line rectangle merging; glossary validation; cache isolation; citation/formula protection.
- Zotero integration: plugin and toolbar loading; 16-page BERT PDF extraction (388 blocks, one merged paper title, 32 headings, 8 footnotes and 26 list items); English visible before translation completion; progressive translation; English-left 42% / Chinese-right 58% row geometry; durable cache reuse after reader close/reopen; no page canvas in bilingual content; original images and cropped figure previews appear as image elements beside captions.
- Zotero annotations: pre-existing source highlight mapped to Chinese; color preserved; Chinese selection creates exactly one canonical PDF annotation with real rects; canonical comment/color edits update linked marks; click focuses the same annotation; deletion removes linked marks; PDF/bilingual toggle.
- Academic provider contract: stable IDs, reordered response handling, per-request academic/glossary instruction, immutable citations, shared selection prompt unchanged, malformed citation response rejected.
- Academic enabled with Google: completed the full PDF in ordinary mode with an explicit capability notice; citations kept locally; provider error categorization hides raw credentials.
- Native input isolation: bilingual selection survives a mouse-down on its highlight button without the PDF reader clearing the range.

The deterministic integration suite uses mocked provider responses. Two opt-in live tests also passed: Google and Google API returned Chinese through the actual Zotero service adapters for the public sentence “This is a translation test.” No user PDF or credentials were sent. These probes do not assert academic translation quality, availability of other providers, or successful remote Zotero Sync. Annotation storage uses standard Zotero items; live cloud synchronization and other operating systems require separate validation.

The user explicitly authorized rendering only figure/chart regions as previews in this revision. The actual BERT vector figure crop was visually inspected: diagram labels, colors, arrows and both panels are preserved. No whole-page screenshots or OCR are part of the translation workflow. Layout is also checked through DOM geometry. Complex PDF semantic segmentation and exact cross-language word alignment remain the boundaries described in BILINGUAL.md.

## Image support in .4

Original embedded images are decoded through Zotero PDF.js (including repeated placements), without a second PDF engine. A generated two-image PDF verifies exact placement plus red/blue pixel colors. Caption-associated vectors use bounded local PDF rendering with annotations disabled. The BERT figure preview is placed in its caption row and decoded in the bilingual iframe; lazy loading observes paragraph rows as well as page markers, so directly jumping to a caption loads its figure. Images load independently of translation and are regenerated from the PDF after closing the session. Complex, captionless or cross-page vector figures remain a detection limitation.

Final .4 result: 15 core tests passed; 4 isolated Zotero integration/provider/image tests passed; the exact production .4 XPI passed permanent installation, active/startup and automatic-update-policy validation. TypeScript and ESLint passed.

## Body structure in .5

Twenty-one core tests, four native Zotero integration tests, and the exact production XPI permanent-install test passed. TypeScript and ESLint passed. The native test checks side arXiv stamp/footer-number removal, section containers and chapter navigation, together with existing image, annotation, translation and durable-cache behavior. Parser fingerprint version 3 refreshes source extraction while unchanged block IDs/text retain their translation cache keys. Margin filtering uses repetition, relative position and font size; numbered footnotes and wrapped continuations are protected. Irregular or unique running furniture remains a heuristic limitation.

## Table previews in .6

Twenty-three core tests and five isolated native Zotero integration tests passed. TypeScript and ESLint passed. The public Frontiers paper 10.3389/fcomp.2026.1746674 reproduces the reported page 12 failure. Its Table 1 now renders below its caption with the full header, borders and both data rows (visually inspected). All three caption-associated previews on this page are extracted. Table cell blocks remain selectable/translatable in a collapsed details section only after the preview successfully loads; the explanatory note remains outside. Preferred-side detection supports top-caption tables and bottom-caption figures, with opposite-side fallback and neighbouring-caption boundaries. No full-page preview or OCR is used.

The exact delivered .6 production XPI passed permanent installation, compatibility, active/startup and automatic-update-policy checks in isolated Zotero 9.0.6.

## Reading modes, terminology and scheduling in .7

24 core tests, 6 isolated Zotero integration tests, TypeScript and ESLint passed. The BERT test now verifies language visibility, reading font size, live native PDF/translated-page geometry with no overlap, translated block collision avoidance, caption images, bidirectional page synchronization, selectable Chinese text across page zoom, creation of canonical underline annotations in comparison mode, restoration of immersive sections, and zero extra provider calls from mode switches or durable-cache reopening. Frontiers page 12 table regression remains passing. A controlled provider verifies two simultaneous requests at most, current-page priority, cache reuse and dispatch stopping after failure. Google terminology tests retain citations and apply explicit glossary terms locally.

Cross-window observer options are cloned into the frame compartment. Already-extracted images decode eagerly; loading remains page-driven. Page relayout preserves existing text nodes and selection. Translated pages are selectable HTML reconstructed from source bounds; long translations expand pages, and figures retain source labels. This is not a new translated PDF, exact publication-layout reconstruction, or translation of diagram pixels. Native freehand drawing stays on the source PDF. Mobile functionality was discussed only and is not implemented.

The delivered .7 production XPI passed exact-file permanent installation, compatibility, active/startup and update-policy checks in isolated Zotero 9.0.6.

## Media and text tables in .8

26 core tests pass, including spatial media deduplication and complete rule-run bounds. New isolated native regression uses the public paper 10.3390/su15032697: page 10 has one Figure 2 preview after duplicate-caption/placement suppression; page 4 Table 1 reconstructs as a full-width header and six two-column rows (13 cells). The test checks all bottom-row text, separation of caption/header/next section, long Chinese cell content expanding without overlap, one rendered image even when a second preview is injected, table-cell selection mapped to canonical PDF annotation, and restoring the same table on mode switch. Table translation display is tested with deterministic Chinese responses, not a claim about provider translation quality.

BERT mode/annotation/cache and scheduler/provider regressions passed. The Frontiers page-12 numeric table continues using its bounded preview, with its explanatory note outside. Complex table geometry falls back to existing previews; reconstruction currently requires reliable horizontal boundaries and separable columns. Image pixels are not translated or edited.

Final .8 source checks: TypeScript and ESLint passed; seven isolated native regressions passed together. Closing views clears scroll timers, avoiding callbacks into destroyed frames. An additional healthcare test confirms the original embedded image data URL remains unchanged and is not filtered out when no caption ID is present; adding two overlapping preview representations still yields one displayed photo.

The exact delivered .8 production XPI passed permanent installation, compatibility, active/startup and automatic-update-policy checks in isolated Zotero 9.0.6.

## Fixed page layout in .9

TypeScript, ESLint and 26 core tests passed. Seven isolated Zotero integration tests passed together. The healthcare regression additionally verifies original page aspect ratio, retained untranslatable running header and margin rules, fixed table position, long Chinese fitting the original table bounds with all rows visible, selectable cell annotations, and furniture removal when returning to immersive mode. After adding page containers for pages without body blocks, the targeted healthcare integration passed again. The exact delivered production .9 XPI passed permanent installation, active/startup and automatic-update checks. Providers are mocked; geometry is verified through native DOM measurements, not a claim of pixel-identical typography.

Compare pages now keep original paper dimensions and object positions; translated text/table font sizes adapt within source bounds. The previous expanding-page behavior applies only to historical .7/.8 reports above. Extreme text length can reduce font size substantially; reading zoom and immersive mode remain available. Cached extraction version 6 stores removed margin glyphs and horizontal margin rules separately from translation blocks. Complex decorations, glyph colors, rotated text and embedded original font matching remain limitations. No OCR or whole-page raster background was added.

## Word range annotations in .10

26 core tests passed, including a regression selecting two Chinese characters from a translated sentence and mapping to one English word rather than the full sentence. TypeScript and ESLint passed. The exact delivered .10 production XPI passed permanent installation in isolated Zotero 9.0.6. Translation-to-source character ranges use positional approximation within stable sentence segments and expand to English word boundaries; reordered translations may yield the wrong word. Source-side selections retain exact PDF glyph coordinates.

## Reading controls and linked text in .11

TypeScript, ESLint and production build passed. Settings collapse state, split ratio keyboard/pointer controls, URL-link extraction and translation color spans are implemented. No Zotero integration tests were run for this version. Color inheritance depends on PDF.js exposing clickable link annotation rectangles; purely visual blue text without link annotations cannot reliably be distinguished through the text extraction API.

## Alignment and compare controls in .12

TypeScript, ESLint and production build passed. The approximate character-ratio mapping from .10/.11 was removed after it placed a Chinese selection over an unrelated English word in real use. Translation-side annotations again map to stable translated sentence segments so both languages highlight the same segment; this avoids false word claims but a one-word Chinese selection expands to its full source sentence. PDF hyperlink color mirroring was removed at the user's request. The mode switch now occupies its own compact row; the comparison divider captures pointer movement and saves the split once on release. No Zotero integration tests were run for .12.
