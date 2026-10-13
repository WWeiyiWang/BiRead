# BiRead

**BiRead — Bilingual PDF Reader for Zotero**

BiRead adds bilingual reading to Zotero’s built-in PDF reader. It extracts selectable PDF text, organizes it into reading blocks, and translates those blocks with a translation provider configured in Zotero. You can read the original and translation side by side or use an immersive view, and create Zotero annotations from selected text.

> **Beta:** BiRead is experimental. Expect bugs, layout differences, and breaking changes. Test it with a backup of your Zotero data before relying on it.

## Features

- Immersive reading with bilingual, translation-only, and source-only views; adjustable font size and line spacing.
- PDF comparison view that keeps the original PDF beside selectable translated text and preserves page furniture and layout positions as far as the extracted PDF structure allows.
- Progressive translation, pause/resume, local translation caching, and a per-document glossary.
- Embedded images and local previews for some vector figures; image contents are not translated.
- Reconstruction and translation of some text-based tables; complex or poorly structured tables may remain previews or need checking in the source PDF.
- Zotero highlight and underline annotations linked to the source PDF. Local assisted phrase matching using identical text, glossary entries and previously confirmed pairs, with direct annotation creation and manual bidirectional correction. Unmatched Chinese highlights remain local to BiRead.

PDF structure recognition is heuristic. Scanned PDFs without selectable text are not OCRed. Mobile reading is not implemented.

## Requirements

- Zotero 7.9.9–10.9.9 is declared in the add-on manifest. The development validation history reports testing on Zotero 9.0.6; compatibility across the whole declared range has not been verified.
- A sentence-translation provider configured in Zotero’s Translate settings. Some providers work without an API key; others require credentials or a local service. Availability and pricing are controlled by the provider.
- Windows, macOS, and Linux support have not been independently release-tested. Use the manual checklist before relying on BiRead.

## 本地模型中文教程

想启用离线中英文词组自动对齐？请看 [一键安装本地模型（Windows）](docs/LOCAL_MODEL_ZH.md)。普通翻译不需要安装这个模型；已配置的用户无需重复安装。

## Installation

1. Download the BiRead `.xpi` file attached to the [latest GitHub Release](https://github.com/WWeiyiWang/BiRead/releases).
2. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…**.
3. Select the downloaded `.xpi` and restart Zotero if it asks you to.

**Independent identity:** BiRead uses its own Zotero add-on ID and preference namespace. Installing it creates a separate Plugins entry and does not migrate or delete settings or credentials from Translate for Zotero. Provider credentials must be entered again in BiRead.

## Relationship to zotero-pdf-translate

BiRead is an independent fork based on [zotero-pdf-translate by windingwind](https://github.com/windingwind/zotero-pdf-translate), version 2.4.8. It retains the translation functionality it uses and adds bilingual PDF reading. BiRead is not an official update of, or endorsed by, the upstream project. Users do not need to install zotero-pdf-translate separately to use BiRead.

Both plugins can be installed as separate entries, but simultaneous activation is **not recommended** for this beta. They register overlapping PDF selection-popup and annotation-header handlers, which can cause duplicate translation UI. BiRead namespaces its own UI elements, menus, and preferences, but the shared reader hooks still need a dedicated coexistence test. Disable the upstream plugin while BiRead is enabled; BiRead does not disable or uninstall it automatically. See [the install test and compatibility notes](docs/development/MANUAL_INSTALL_TEST.md).

## Quick start

1. In Zotero’s Translate settings, choose and configure a sentence-translation provider.
2. Open a text-based PDF in Zotero’s built-in reader.
3. Click **BILINGUAL** in the reader toolbar. Use the reading mode selector to switch between immersive reading and PDF comparison.
4. In immersive reading, choose bilingual, Chinese-only, or English-only display and adjust the reading settings.
5. Select text and use the highlight or underline controls to create a standard Zotero annotation on the source PDF. Unmatched Chinese selections are saved locally. Open a mark and choose **绑定 / 重新关联词组** to select and confirm both phrases in the same bilingual paragraph.

Annotation comments save automatically as you type; closing the editor waits for pending saves. The right-click menu contains Highlight, Underline and Comment. Correct a match afterward with the phrase-binding controls.

The [Chinese user guide](biread/BILINGUAL.md) has more details. To install the XPI locally, use the checklist in [MANUAL_INSTALL_TEST.md](docs/development/MANUAL_INSTALL_TEST.md).

## Translation providers and privacy

BiRead uses provider integrations inherited from Translate for Zotero. Translation requests send extracted text to the provider you select; academic-mode requests may also include the academic translation instruction and glossary terms. Annotation matching runs locally without additional provider requests. Optional offline ONNX alignment can be installed with the one-click installer on Windows x64 (about 194 MB from Python.org, PyPI and Hugging Face). Downloads are checksum-verified and the runtime is checked before activation. Manual configuration remains available on other systems. BiRead does not operate a translation server. Provider terms, retention, privacy, and billing apply to your requests.

The add-on stores extracted document text, translations, glossary data, and mapping data in the local Zotero data directory under `biread-bilingual-v1/`. Provider credentials are stored through BiRead’s separate local preference namespace; this code does not add a separate encryption layer. Image previews are generated locally from the opened PDF and are not sent for translation. Existing upstream credentials are not read or changed.

## Known limitations

- PDF reading order, headings, page furniture, figures, and table structure are inferred heuristically and can be wrong on complex layouts.
- Scanned pages without selectable text are unsupported; no OCR is performed.
- Figure previews are limited to extractable images and some caption-associated vector regions. Diagram text stays in the original language.
- Text tables are reconstructed only when rows and columns can be identified reliably.
- Phrase matching uses local known pairs and optionally an offline contextual alignment model. Check the resulting highlights; omissions, paraphrases and repeated words may still require manual binding. Local Chinese annotations and phrase mappings do not sync through Zotero; changing a translation invalidates its old text offsets. See [local model setup](biread/BILINGUAL.md) for runtime requirements.
- Provider speed, quality, availability, rate limits, and API costs are outside BiRead’s control.
- Mobile support and translated-PDF export are not implemented.

## Development

From the `biread/` directory, with Node.js 22 or newer:

```sh
npm ci
npm run typecheck
npm run lint:check
npm run test:bilingual
npm run build
```

`npm test` runs Zotero-based integration tests and may need a Zotero binary and test fixtures. Do not run live-provider tests with private PDFs or real paid credentials. Release automation and background updates are disabled pending a verified BiRead update feed. Install beta updates manually from the BiRead repository.

## Contributing

Bug reports, feature requests, and pull requests are welcome through [GitHub Issues](https://github.com/WWeiyiWang/BiRead/issues). Include the Zotero and BiRead versions, operating system, provider name, reproduction steps, expected behavior, and actual behavior. Remove keys, tokens, private PDF text, and personal paths from logs before sharing them.

## Credits

BiRead is an independent fork based on [zotero-pdf-translate by windingwind](https://github.com/windingwind/zotero-pdf-translate), version 2.4.8. It retains upstream translation functionality under a separate add-on identity and preferences. Upstream copyright and license notices are retained; no endorsement by the upstream maintainer is implied.

## License

The upstream package metadata declares **AGPL-3.0-or-later** and its AGPL license text is retained. See [LICENSE](LICENSE). The appropriate copyright notice for BiRead-specific contributions has not been legally reviewed; do not infer authorship from the package metadata.
