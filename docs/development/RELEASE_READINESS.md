# Local beta release readiness

This file tracks local release preparation only. Do not treat these notes as authorization to commit, tag, publish a GitHub Release, change repository visibility, or upload an artifact. None of those actions has been taken.

## Baseline and identity decision

- Starting Git HEAD: `9577862` (`Initial source for BiRead`), branch `main` tracking `origin/main` at `https://github.com/WWeiyiWang/BiRead.git`.
- Product: **BiRead — Bilingual PDF Reader for Zotero**, target `0.1.0-beta`.
- Previous observed add-on ID: `zoteropdftranslate@euclpts.com` (upstream identity).
- New BiRead add-on ID: `biread@wweiyiwang.github.io`.
- Previous preference namespace: `extensions.zotero.ZoteroPDFTranslate.*`.
- New BiRead preference namespace: `extensions.zotero.BiRead.*`.
- BiRead runtime object: `Zotero.BiRead`; chrome/custom resource namespace: `biread`.
- Bilingual local cache directory: `biread-bilingual-v1/`.

The ID, preference prefix, runtime instance name, and resource namespace were changed at the package configuration source. BiRead does not migrate, read, clear, or delete upstream preferences or credentials. Users must re-enter provider credentials in BiRead. This is the first public beta, so no migration from the pre-release BiRead test build is included.

Identity-related changes are in `biread/package.json`, `biread/addon/manifest.json`, `biread/zotero-plugin.config.ts`, `biread/src/hooks.ts`, `biread/typings/global.d.ts`, `biread/src/bilingual/cache/documentCache.ts`, `biread/src/extras/customElements.ts`, `biread/src/elements/panel.ts`, `biread/src/modules/tabpanel.ts`, `biread/addon/chrome/content/standalone.xhtml`, `biread/addon/chrome/content/styles/panel.css`, `biread/addon/chrome/content/styles/standalone.css`, `biread/addon/chrome/content/styles/mathTextbox.css`, `biread/test/install/package.test.ts`, `biread/test/gptApiFormat.test.ts`, `biread/test/bilingual/live.test.ts`, `biread/test/bilingual/reader.test.ts`, and `biread/test/bilingual/scheduling.test.ts`. The `addon/prefs.js` and `addon/bootstrap.js` templates are populated from the new config during build. Tests now bind the runtime instance as `Zotero.BiRead`; the installer test checks the new ID and confirms an already-installed upstream entry remains installed. Build-generated files are not source of truth. Historical upstream update manifests remain archived under `docs/development/upstream-update-manifests/` and are not used in the package.

## Coexistence assessment

**Installed as separate entries: expected to be supported by the new IDs; must be confirmed in Test B.** Installing BiRead should no longer be interpreted as an update to the upstream add-on.

**Enabled at the same time: UNSAFE / NOT RECOMMENDED for this beta.** Source review found overlapping PDF text-selection popup and annotation-header handlers. This can duplicate popup UI or annotation controls. BiRead now namespaces its custom elements, resource IDs, menus, and item-pane ID, so those obvious collisions are reduced. It still registers overlapping reader hooks and observers, and no manual simultaneous-activation test has been run. BiRead does not detect, disable, uninstall, or modify the upstream extension. Keep upstream installed but disabled while BiRead is active. No large coexistence rewrite was attempted.

## Update channel

BiRead no longer points at the upstream update infrastructure. Zotero's required non-empty manifest field points to the BiRead repository landing page, not an active update manifest. Background auto-updates are explicitly disabled during startup. Beta upgrades are manual until the BiRead-owned feed and release path are configured and verified. The build may generate a BiRead update metadata file for inspection, but no active feed is claimed or published.

## License and attribution

The upstream package declares `AGPL-3.0-or-later`; the upstream license and copyright/attribution notices remain in the repository and packaged XPI. BiRead is described as an independent fork, not an official upstream update or endorsed product. BiRead-specific copyright ownership and bundled dependency/font notices still need legal review.

**MANUAL LICENSE REVIEW REQUIRED**

## Validation status

The previous XPI hash and validation results do not apply to the new identity build.

- Source typecheck: passed.
- Test typecheck: passed.
- Prettier check: passed.
- ESLint: passed with zero errors and one pre-existing warning at `src/modules/tabpanel.ts:22` about an undocumented `@ts-ignore`.
- Offline bilingual tests: 30 passed, 0 failed; no translation provider was called.
- Production build: passed using the installed scaffold API through `build-local.mjs`; no network access used.
- XPI audit: 69 entries; required manifest/bootstrap/preferences/bundle/LICENSE present; no `.env`, secret-pattern match, upstream extension ID/preferences, personal path, source map, PDF, SQLite, logs, `node_modules`, or Git metadata. Manifest identity: `BiRead — Bilingual PDF Reader for Zotero`, description `Bilingual PDF Reader for Zotero`, version `0.1.0-beta`, ID `biread@wweiyiwang.github.io`, update URL on the BiRead repository.
- Candidate: `dist/release/BiRead-0.1.0-beta.xpi`; SHA-256 `5612ffef7e20353c7bc3bbef7771381448f03d42cfcc9affdc0e99c698d986b0`. Generated BiRead updater metadata SHA-512 matches the XPI, but it is not an active/published feed.
- Zotero install and identity/coexistence tests: pending; follow `MANUAL_INSTALL_TEST.md` with a disposable profile. The previously observed install result is for the old upstream-ID package and does not validate the new identity.

No paid translation API should be called during this validation. Do not include real credentials, personal paths, private PDFs, test fixtures, `node_modules`, or Git metadata in the XPI.

## Public beta blockers

- Run the manual fresh-install and identity independence checks to prove Zotero lists both plugins separately.
- Run the manual settings/credential-isolation checks and verify the source popup and bilingual reader with upstream disabled.
- Maintain the warning that simultaneous activation is not recommended until a dedicated coexistence test and fix are complete.
- Complete legal review of new contribution ownership and third-party notices.
- Configure and verify a BiRead-owned release/update process before enabling background auto-updates. Publishing remains a separate user decision.
