const installDescribe = Zotero.Prefs.get("bilingual.test.xpi", true) ? describe : describe.skip;
installDescribe("Packaged XPI installation", function () {
  this.timeout(30000);
  it("accepts and permanently installs the delivered XPI", async function () {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const path = Zotero.Prefs.get("bilingual.test.xpi", true) as string;
    const messages: string[] = [];
    const listener = { observe(message: any) { messages.push(message.message || String(message)); } };
    Services.console.registerListener(listener);
    try {
      const temporary = await AddonManager.getAddonByID("zoteropdftranslate@euclpts.com");
      if (temporary?.temporarilyInstalled) await temporary.uninstall();
      const install = await AddonManager.getInstallForFile(Zotero.File.pathToFile(path));
      const diagnostics = { version: Zotero.version, error: install.error, state: install.state, addon: install.addon && { id: install.addon.id, version: install.addon.version, isCompatible: install.addon.isCompatible, appDisabled: install.addon.appDisabled }, messages };
      await Zotero.File.putContentsAsync(path + ".diagnostic.json", JSON.stringify(diagnostics, null, 2));
      assert.equal(install.error, 0, JSON.stringify(diagnostics));
      assert.isTrue(install.addon!.isCompatible);
      await new Promise<void>((resolve, reject) => {
        install.addListener({
          onInstallEnded: () => resolve(),
          onInstallFailed: () => reject(new Error("Install failed: " + install.error)),
        });
        void install.install();
      });
      const installed = await AddonManager.getAddonByID("zoteropdftranslate@euclpts.com");
      assert.isOk(installed);
      assert.isFalse(installed!.temporarilyInstalled);
      assert.isTrue(installed!.isActive);
      await Zotero.Promise.delay(1000);
      assert.isOk((Zotero as any).PDFTranslate, "packaged plugin startup completed");
      assert.equal(installed!.applyBackgroundUpdates, AddonManager.AUTOUPDATE_DISABLE);
    } finally { Services.console.unregisterListener(listener); }
  });
});