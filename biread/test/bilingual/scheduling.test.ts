import { translateProgressively } from "../../src/bilingual/translation/batching";
import { translationContext } from "../../src/bilingual/translation/providers";
import { segmentText } from "../../src/bilingual/alignment/segmentAlignment";
import { setPref } from "../../src/utils/prefs";
const run = Zotero.Prefs.get("bilingual.test.fixture", true)
  ? describe
  : describe.skip;
run("Bounded translation scheduling", function () {
  this.timeout(20000);
  it("prioritizes visible pages, bounds requests and restores cache without requests", async function () {
    const running = (Zotero as any).BiRead;
    (globalThis as any).addon = running;
    (globalThis as any)._globalThis = Zotero.getMainWindow();
    setPref("translateSource", "google");
    const service = running.data.translate.services.getServiceById("google"),
      original = service.translate;
    const delay = running.data.translate.batchTaskDelay;
    running.data.translate.batchTaskDelay = 0;
    let active = 0,
      peak = 0,
      calls = 0;
    const order: string[] = [];
    const blocks = Array.from({ length: 6 }, (_, n) => ({
      id: "queue-" + n,
      pageIndex: n,
      kind: "paragraph",
      source: "Sentence " + n + ".",
      segments: segmentText("Sentence " + n + ".", "queue-" + n),
    })) as any;
    const context = translationContext({}, "standard");
    const identity = "queue-test-" + Date.now();
    service.translate = async (task: any) => {
      order.push(task.id);
      calls++;
      peak = Math.max(peak, ++active);
      await Zotero.Promise.delay(35);
      active--;
      task.result = "测试译文。";
    };
    try {
      await translateProgressively(
        blocks,
        identity,
        context,
        0,
        () => {},
        () => false,
        () => {},
        { concurrency: 2, priority: () => 4 },
      );
      assert.equal(peak, 2);
      assert.include(order[0], "queue-4");
      assert.equal(calls, 6);
      assert.equal(active, 0);
      await translateProgressively(
        blocks,
        identity,
        context,
        0,
        () => {},
        () => false,
        () => {},
        { concurrency: 3 },
      );
      assert.equal(calls, 6, "cached blocks cause no remote requests");
      let failures = 0;
      service.translate = async () => {
        failures++;
        await Zotero.Promise.delay(20);
        throw new Error("429");
      };
      try {
        await translateProgressively(
          blocks,
          identity + "-failure",
          context,
          0,
          () => {},
          () => false,
          () => {},
          { concurrency: 2 },
        );
        assert.fail("must stop on provider error");
      } catch (error) {
        assert.include(String(error), "限流");
      }
      assert.isAtMost(failures, 2, "no new requests after failure");
    } finally {
      service.translate = original;
      running.data.translate.batchTaskDelay = delay;
    }
  });
});
