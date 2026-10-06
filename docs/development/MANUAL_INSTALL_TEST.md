# BiRead 0.1.0-beta manual installation checklist

Run these checks in a disposable Zotero profile or a backed-up library. The prior `zoteropdftranslate@euclpts.com` beta package was manually installed and its translation and bilingual reader were exercised. This new XPI changes the add-on identity and preference namespace, so the checks below are still required; prior installation results do not validate this package.

## Test A — Fresh BiRead install

- [ ] Record operating system, Zotero version, and XPI version.
- [ ] Back up the test Zotero profile and data directory.
- [ ] In the disposable profile, remove/disable the old pre-release BiRead test package if present. It used the upstream ID `zoteropdftranslate@euclpts.com`, so the old package and a genuine upstream installation cannot be distinguished by ID; do not remove an installation you intend to preserve.
- [ ] Install `BiRead-0.1.0-beta.xpi` from **Tools → Plugins → gear menu → Install Plugin From File…** and restart if prompted.
- [ ] Confirm Plugins shows **BiRead — Bilingual PDF Reader for Zotero** with ID `biread@wweiyiwang.github.io` in plugin details.
- [ ] Confirm the original selection/pop-up translation works.
- [ ] Confirm the bilingual reader opens and both immersive and PDF comparison modes work.

## Test B — Identity independence

- [ ] Install upstream Translate for Zotero and verify Zotero lists it separately from BiRead.
- [ ] Confirm installing BiRead does not replace, rename, upgrade, or remove the upstream plugin.
- [ ] Confirm both entries remain separately installed after restarting Zotero.

## Test C — Runtime coexistence

Separate installation is expected to work. Simultaneous activation is **not recommended** for this beta: both plugins register PDF text-selection popup and annotation-header handlers. Duplicate popup or annotation controls are plausible conflicts. BiRead namespaces its custom element tags and menus, but that does not isolate the shared reader events.

- [ ] Leave both installed, disable upstream Translate for Zotero, enable BiRead, and restart.
- [ ] Confirm BiRead’s translation popup and bilingual reader still work normally.
- [ ] Do not enable both for routine use. If you choose to test that configuration, use only a disposable profile and check selection popups, annotation headers, toolbar/menu entries, preferences, and reader stability; report the Zotero version and exact symptoms.

## Test D — Independent settings and credentials

- [ ] In BiRead, change a non-sensitive setting and confirm it does not change the upstream plugin’s corresponding setting.
- [ ] Restart Zotero and verify the BiRead setting persists.
- [ ] Confirm provider keys are blank in a fresh BiRead installation and re-enter only into BiRead if needed.
- [ ] Confirm upstream settings and credentials remain present after installing and using BiRead.

BiRead uses `extensions.zotero.BiRead.*`; it does not migrate, read, clear, or delete `extensions.zotero.ZoteroPDFTranslate.*`. Cache data is also separated under `biread-bilingual-v1/`.

## Test E — Upgrade safety

- [ ] Inspect the installed BiRead manifest and confirm its ID is `biread@wweiyiwang.github.io` and its update URL is BiRead-owned.
- [ ] Confirm automatic background updates are disabled for BiRead; beta updates are installed manually.
- [ ] Confirm the upstream plugin still receives only its own upstream updates and cannot replace BiRead.
- [ ] Confirm no BiRead update feed is advertised as active until a BiRead release feed is configured and verified.

## Reader regression checks

- [ ] Reopen a previously cached PDF with an inline Abstract label. Confirm Abstract/摘要 is a separate heading and the following text remains body text; verify source highlighting still targets the selected characters.
- [ ] Configure a provider and translate a few pages. Use a mock/local provider where possible; do not use a paid live provider unless you intend to incur its charges.
- [ ] Test pause/resume, cache reuse, glossary, section navigation, headings, images, vector previews, text tables, long/two-column PDFs, footnotes/references, and annotations.
- [ ] Test invalid credentials and a failed/disconnected provider without sharing private keys, PDF text, or personal paths.
- [ ] Confirm scanned PDFs without selectable text remain unsupported; no OCR is expected.

This is a manual checklist. The new candidate has not been tested in Zotero by this local preparation run.
