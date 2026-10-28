# Guide and iPhone foundation — 0.1.28-beta.1

Implemented desktop entry points: **论文导读**, **导出手机阅读文件**.

The guide extracts existing abstract/conclusion blocks, labels them as excerpts, and navigates to the source PDF. It deliberately does not claim to generate or fact-check conclusions. No text is sent to an additional AI service.

Export first requests all document pages' formula/figure previews, reuses in-flight work, and serializes a self-contained HTML snapshot. Original formula images remain inline. Equations with unavailable images show a missing-content notice rather than corrupt extracted glyphs. Caption-owned figures stay with captions. When a complete table image is available its individual cell blocks are omitted. Unrendered regions and unfinished translations are marked. Translation completion is not awaited automatically.

The mobile reader provides source disclosure, chapter hierarchy, author/reference labels, language and font controls, progress, and best-effort position restoration. It excludes publication furniture and all remote resources. Plain document content is HTML escaped; embedded images are restricted to base64 PNG/JPEG/WebP. It does not include API keys, credentials, or annotation databases. Exporting is a deliberate transfer of document content, not automatic cloud upload.

iPhone starter: `mobile/ios`, SwiftUI + WKWebView, Files importer, persistent local library, delete, offline network blocking. The Windows host cannot compile iOS binaries. Xcode compilation, signing, simulator/device testing, app icon, and TestFlight remain required. No phone PDF translation, accounts, cloud sync, or annotation sync is implemented yet.

Validation: TypeScript main project passes; 153 existing tests pass; three export tests pass (markup injection, inline math and degraded formulas, source links and outline); Edge browser test at 390×844 passes bilingual toggle, font size, no horizontal overflow, outline navigation and stored progress. Native WebKit behavior has not been verified.

Design inspiration: https://github.com/ai-azhou/pdf-to-interactive-web (MIT), particularly source traceability and progressive disclosure. This implementation is original; no upstream code or skill text is bundled. The upstream skill is not installed. Future AI summaries must carry source-backed claims, preserve units and conditions, and label interpretation distinctly.

Not included in this milestone: BabelDOC integration or a new PDF layout engine, generalized mathematical semantic reconstruction, interactive scientific simulations, AI-generated fact ledger. These require separate implementation and validation; this release does not claim to solve all PDF parsing failures.
