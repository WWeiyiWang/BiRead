# Desktop layout evaluation — 2026-10-25

Desktop work precedes the iPhone app. Required order: engine evaluation, inline math and whole figures, source links, original-layout bilingual PDF, then verifiable reading guides.

## Candidate and installation

Evaluate pdf2zh-next 2.9.0 / BabelDOC 0.6.2. BabelDOC recommends the pdf2zh-next public API instead of its own internal Python API. This is an experimental integration, not a verified replacement for the complete desktop pipeline.

- https://github.com/PDFMathTranslate-next/PDFMathTranslate-next
- https://github.com/funstory-ai/BabelDOC
- Guide inspiration: https://github.com/ai-azhou/pdf-to-interactive-web (no implementation copied).

On Windows, run `biread/scripts/setup-layout-engine.ps1` with uv available. It creates an isolated environment, pins bitstring 4.3.1 (5.0.0 breaks the installed parser), downloads the layout model, and writes `layout-engine.json`. Select that file in the experimental local layout setting, then restart Zotero. The disable control restores the built-in parser after restart. The installer downloads dependencies; the layout worker itself does not call any translation service.

## Implemented

- High-confidence visual regions constrain whole-figure and display-equation ownership. Caption anchors corroborate wrapped caption regions.
- Formula protection precedes paragraph merging. Reliable visual prose cannot subsequently be reclassified by font-only heading heuristics.
- PDF ligatures in italic prose remain prose rather than becoming formula images.
- Native HTTP(S) and internal PDF destinations are retained, with reference previews only when a target block can be identified. No reference is fabricated for ambiguous pages.
- Local worker uses UTF-8, cancellation, a time limit, and bounded output. Configuration changes invalidate the document cache.

## Evidence and limits

Local model evaluation: 13 pages across six papers (IEEE, Seed, Patel, HygroMetric, Structures, Networks). The complete model is not inferred to be universally reliable from this sample. Integrated parser checks have run on IEEE, Seed, Patel and HygroMetric; selected formula crops were visually inspected. Browser annotation tests use a simulated Zotero host, not an installed Zotero session.

Still required before enabling by default: cross-column caption continuation ownership, broader held-out corpus and content-retention measurements, real Zotero runtime validation, and comparison of generated Chinese PDFs (overflow, font sizes, formulas, whole figures, links and bookmarks).

The user explicitly authorized Google translation evaluation of Seed PDF pages 2, 3, 10 and 11. The attempted pdf2zh-next Google run failed during its `Hello` connection probe with HTTP 429 / Google's verification page. No translated PDF was generated. Its CLI nevertheless exited with code 0: integration must require an explicit successful result and validated output files, not just process exit status. Do not solve Google's challenge, retry indefinitely, switch providers, or expand the authorized page range implicitly. BiRead's existing Google service uses a different API adapter; compatibility has only been inspected, not validated in this evaluation.

The current original-layout view is DOM reconstruction. A validated original-layout bilingual PDF export has NOT been delivered. The current reading guide is extractive navigation, not the requested completed short guide plus key results and complete-figure entry points. Finish and validate PDF output before extending it. No release was published in this work.
