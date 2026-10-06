import {
  translateBlock,
  translationContext,
  effectiveContext,
} from "../../src/bilingual/translation/providers";
import {
  segmentText,
  applyTranslations,
} from "../../src/bilingual/alignment/segmentAlignment";
import { setPref } from "../../src/utils/prefs";
const liveDescribe = Zotero.Prefs.get("bilingual.test.live", true)
  ? describe
  : describe.skip;
liveDescribe("Opt-in public Google connectivity", function () {
  this.timeout(200000);
  for (const provider of ["google", "googleapi"]) {
    it(
      provider + " returns Chinese through the actual Zotero provider",
      async function () {
        (globalThis as any).addon = (Zotero as any).PDFTranslate;
        setPref("translateSource", provider);
        const source = "This is a translation test.";
        const b: any = {
          id: "public-live-probe",
          source,
          segments: segmentText(source, "public-live-probe"),
        };
        applyTranslations(
          b,
          await translateBlock(
            b,
            effectiveContext(translationContext({}, "academic")),
            0,
          ),
        );
        assert.match(b.translation, /[\u4e00-\u9fff]/);
      },
    );
  }
});
