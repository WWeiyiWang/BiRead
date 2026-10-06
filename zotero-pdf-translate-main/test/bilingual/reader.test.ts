import {
  graphicsRects,
  figureRegion,
} from "../../src/bilingual/parser/figureRegions";
import { pdfIntegration } from "../../src/bilingual/reader/pdfIntegration";
import { extractDocument } from "../../src/bilingual/parser/pdfTextExtractor";
import { sourceRects } from "../../src/bilingual/annotations/annotationMapping";
import {
  translationContext,
  effectiveContext,
  providerFailure,
  translateBlock,
} from "../../src/bilingual/translation/providers";
import {
  segmentText,
  applyTranslations,
} from "../../src/bilingual/alignment/segmentAlignment";
import { setPref, getPref } from "../../src/utils/prefs";

const bilingualDescribe = Zotero.Prefs.get("bilingual.test.fixture", true)
  ? describe
  : describe.skip;
bilingualDescribe("Bilingual Zotero reader integration", function () {
  this.timeout(180000);
  it("reads a full PDF, caches translation and shares canonical annotations", async function () {
    let stage = "startup";
    try {
      const running = (Zotero as any).PDFTranslate;
      assert.isOk(running, "plugin loaded");
      const fixture = Zotero.Prefs.get(
        "bilingual.test.fixture",
        true,
      ) as string;
      assert.isOk(fixture, "test fixture configured");
      stage = "import attachment";
      const attachment = await Zotero.Attachments.importFromFile({
        file: fixture,
      });
      let reader: any = await Zotero.Reader.open(attachment.id);
      await reader._initPromise;
      stage = "PDF integration";
      const integration = await pdfIntegration(reader);
      stage = "extract document";
      const document = await extractDocument(
        integration.pdf,
        integration.identity,
        integration.fingerprint,
        () => {},
        () => false,
      );
      stage =
        "check document " +
        integration.pdf.numPages +
        " pages, " +
        document.blocks.length +
        " blocks";
      assert.isAtLeast(integration.pdf.numPages, 15);
      assert.isAtMost(integration.pdf.numPages, 30);
      assert.isAbove(document.blocks.length, 50);
      assert.isFalse(
        document.blocks.some((b) => /^arxiv:/i.test(b.source)),
        "side running stamp removed",
      );
      assert.isFalse(
        document.blocks.some(
          (b) =>
            /^\d+$/.test(b.source) &&
            b.anchors.every((a) => a.rect[3] < b.pageHeight * 0.055),
        ),
        "footer page numbers removed",
      );
      await IOUtils.writeJSON(
        fixture + ".layout.json",
        document.blocks.map((b) => ({
          source: b.source.slice(0, 180),
          kind: b.kind,
          level: b.headingLevel,
          size: b.fontSize,
          bold: b.bold,
          page: b.pageIndex,
        })),
      );
      assert.isOk(
        document.blocks.find((b) => b.kind === "title"),
        "title inferred from original font",
      );
      assert.isOk(
        document.blocks.find((b) => b.headingLevel === 1),
        "section hierarchy inferred",
      );
      assert.isOk(
        document.blocks.find((b) => b.headingLevel === 2),
        "subsection hierarchy inferred",
      );
      const block = document.blocks.find(
        (b) => b.kind === "paragraph" && b.source.length > 150,
      )!;
      assert.isOk(block);
      stage = "figure preview";
      const figureCaption = document.blocks.find(
        (b) => b.kind === "caption" && /^Figure/i.test(b.source),
      )!;
      assert.isOk(figureCaption, "figure caption exists");
      const previews = await integration.pdf.getFigures(
        figureCaption.pageIndex,
        document.blocks,
        () => false,
      );
      assert.isAbove(previews.length, 0, "vector figure preview extracted");
      assert.isAbove(previews[0].width, 100);
      assert.isBelow(
        previews[0].height,
        figureCaption.pageHeight * 1.8,
        "only figure region rendered",
      );
      const binary = Zotero.getMainWindow().atob(previews[0].src.split(",")[1]);
      await IOUtils.write(
        fixture + ".figure.png",
        Uint8Array.from(binary, (c: string) => c.charCodeAt(0)),
      );
      await IOUtils.writeJSON(
        fixture + ".figures.json",
        previews.map((p: any) => ({
          rect: p.rect,
          width: p.width,
          height: p.height,
          caption: p.captionID,
        })),
      );
      const key = (Zotero as any).DataObjectUtilities.generateKey();
      stage = "create initial annotation";
      await Zotero.Annotations.saveFromJSON(attachment, {
        key,
        id: key,
        libraryID: attachment.libraryID,
        readOnly: false,
        dateModified: new Date().toISOString(),
        type: "highlight",
        text: block.source.slice(0, 50),
        comment: "Existing canonical comment",
        color: "#ff6666",
        pageLabel: block.pageLabel,
        sortIndex: "00000|000000|00000",
        position: {
          pageIndex: block.pageIndex,
          rects: sourceRects(block, 0, 50),
        },
      } as any);
      const service = running.data.translate.services.getServiceById("google");
      const originalTranslate = service.translate;
      const originalDelay = running.data.translate.batchTaskDelay;
      let calls = 0;
      service.translate = async (data: any) => {
        calls++;
        data.result =
          "这是一段用于验证句段对应关系的测试译文。" +
          (data.raw.match(/⟦ZPT_KEEP_\d+⟧/g) || []).join("");
      };
      running.data.translate.batchTaskDelay = 0;
      setPref("translateSource", "google");
      setPref("bilingual.academic", true);
      setPref("bilingual.readingMode", "immersive");
      setPref("bilingual.language", "both");
      const wait = async (
        predicate: () => boolean,
        label: string,
        timeout = 150000,
      ) => {
        stage = label;
        await IOUtils.writeJSON(fixture + ".progress.json", { stage });
        const start = Date.now();
        while (!predicate()) {
          const statusText =
            reader._internalReader?._primaryView?._iframeWindow?.document
              .querySelector("#zpt-bilingual-frame")
              ?.contentDocument?.querySelector("[role=status]")?.textContent ||
            "";
          if (/^(TypeError|Error|ReferenceError)/.test(statusText))
            throw new Error(statusText);
          if (Date.now() - start > timeout) {
            const d =
              reader._internalReader?._primaryView?._iframeWindow?.document.querySelector(
                "#zpt-bilingual-frame",
              )?.contentDocument;
            if (d)
              await IOUtils.writeUTF8(
                fixture + ".ui.error.txt",
                d.body.innerHTML,
              );
            throw new Error(
              "Timeout: " +
                label +
                " / " +
                integration.win.document
                  .querySelector("#zpt-bilingual-frame")
                  ?.contentDocument?.querySelector('[role="status"]')
                  ?.textContent,
            );
          }
          await Zotero.Promise.delay(50);
        }
      };
      try {
        const toolbar = Array.from(
          reader._iframeWindow.document.querySelectorAll("button"),
        ).find((b: any) => b.textContent === "BILINGUAL") as HTMLButtonElement;
        assert.isOk(toolbar, "native toolbar button present");
        stage = "click bilingual";
        toolbar.click();
        await wait(
          () =>
            !!integration.win.document
              .querySelector("#zpt-bilingual-frame")
              ?.contentDocument?.querySelector("#zpt-bilingual"),
          "bilingual frame ready",
        );
        const doc = integration.win.document.querySelector(
          "#zpt-bilingual-frame",
        ).contentDocument;
        await wait(() => !!doc.querySelector(".bi-source"), "source appears");
        assert.equal(
          doc.querySelectorAll(".bi-row").length,
          document.blocks.length,
        );
        assert.notInclude(
          doc.querySelector('#zpt-bilingual [role="status"]').textContent,
          "READY",
          "original appears before full translation",
        );
        await wait(
          () =>
            doc
              .querySelector('#zpt-bilingual [role="status"]')
              ?.textContent?.startsWith("READY"),
          "full translation",
        );
        assert.include(
          doc.querySelector('[role="status"]').textContent,
          "普通翻译",
        );
        assert.isAbove(doc.querySelectorAll('[role="heading"]').length, 4);
        assert.isAbove(doc.querySelectorAll(".bi-section").length, 3);
        assert.isAbove(doc.querySelector(".bi-outline").options.length, 3);
        assert.isAbove(calls, 0);
        const firstCalls = calls;
        const row = doc.querySelector('[data-block-id="' + block.id + '"]');
        assert.isOk(
          row.querySelector('.bi-translation mark[data-keys="' + key + '"]'),
          "original highlight maps to Chinese",
        );
        assert.include(
          row.querySelector(".bi-translation mark").getAttribute("style"),
          "255, 102, 102",
        );
        const chinese = row.querySelector(".bi-translation");
        const walker = doc.createTreeWalker(chinese, 4);
        const node = walker.nextNode();
        const range = doc.createRange();
        range.setStart(node, 1);
        range.setEnd(node, Math.min(4, node.textContent.length));
        const selection = doc.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const cells = row.querySelector(".bi-columns").children;
        assert.equal(cells[0].getAttribute("data-side"), "source");
        assert.equal(cells[1].getAttribute("data-side"), "translation");
        const ratio =
          cells[0].getBoundingClientRect().width /
          row.querySelector(".bi-columns").getBoundingClientRect().width;
        assert.closeTo(
          ratio,
          0.42,
          0.02,
          "English 42 / Chinese 58 aligned row layout",
        );
        const highlightButton = (
          Array.from(doc.querySelectorAll("button")) as HTMLButtonElement[]
        ).find((b) => b.textContent === "Highlight selection")!;
        highlightButton.dispatchEvent(
          new doc.defaultView.MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
          }),
        );
        assert.isFalse(
          selection.isCollapsed,
          "PDF mouse capture cannot clear bilingual selection",
        );
        const count = attachment.getAnnotations().length;
        (Array.from(doc.querySelectorAll("button")) as HTMLButtonElement[])
          .find((b: any) => b.textContent === "Highlight selection")
          ?.click();
        await wait(
          () => attachment.getAnnotations().length === count + 1,
          "Chinese creates one annotation",
          10000,
        );
        const created = attachment
          .getAnnotations()
          .find((a: any) => a.key !== key)!;
        assert.equal(created.parentID, attachment.id);
        assert.equal(created.annotationType, "highlight");
        assert.isAbove(JSON.parse(created.annotationPosition).rects.length, 0);
        assert.include(block.source, created.annotationText);
        created.annotationComment = "Updated canonical comment";
        created.annotationColor = "#2ea8e5";
        await created.saveTx();
        await wait(
          () => !!row.querySelector('mark[title*="Updated canonical comment"]'),
          "comment change reflected",
          10000,
        );
        const updated = row.querySelector(
          'mark[title*="Updated canonical comment"]',
        );
        assert.include(updated.getAttribute("style"), "46, 168, 229");
        updated.click();
        await wait(
          () =>
            reader._internalReader._state.selectedAnnotationIDs.includes(
              created.key,
            ),
          "focus same canonical annotation",
          10000,
        );
        await created.eraseTx();
        await wait(
          () => !doc.querySelector('mark[data-keys~="' + created.key + '"]'),
          "delete removes linked highlight",
          10000,
        );
        (Array.from(doc.querySelectorAll("button")) as HTMLButtonElement[])
          .find((b: any) => b.textContent === "Retry / Resume")
          ?.click();
        await Zotero.Promise.delay(1500);
        assert.equal(
          calls,
          firstCalls,
          "cache avoids provider calls on resume",
        );
        (Array.from(doc.querySelectorAll("button")) as HTMLButtonElement[])
          .find((b: any) => b.textContent === "PDF")
          ?.click();
        assert.isTrue(doc.querySelector("#zpt-bilingual").hidden);
        stage = "click bilingual";
        toolbar.click();
        await Zotero.Promise.delay(200);
        assert.isFalse(doc.querySelector("#zpt-bilingual").hidden);
        assert.equal(calls, firstCalls, "mode reopening uses existing cache");
        assert.equal(doc.querySelectorAll("#zpt-bilingual canvas").length, 0);
        const figureRow = doc.querySelector(
          `[data-block-id="${figureCaption.id}"]`,
        );
        figureRow.scrollIntoView();
        await wait(
          () => figureRow.querySelector(".bi-figure img")?.naturalWidth > 100,
          "figure is visible beside its caption",
          30000,
        );
        assert.isAbove(
          figureRow.querySelector(".bi-figure img").naturalWidth,
          100,
        );
        stage = "reading settings and native PDF comparison";
        const change = (label: string, value: string) => {
          const select = doc.querySelector(
            'select[aria-label="' + label + '"]',
          );
          assert.isOk(select, label);
          select.value = value;
          select.dispatchEvent(new doc.defaultView.Event("change"));
        };
        change("显示语言", "translation");
        assert.equal(
          doc.defaultView.getComputedStyle(row.querySelector(".bi-source"))
            .display,
          "none",
        );
        change("字号", "22");
        assert.equal(
          doc.defaultView.getComputedStyle(doc.querySelector(".bi-list"))
            .fontSize,
          "22px",
        );
        change("显示语言", "source");
        assert.equal(
          doc.defaultView.getComputedStyle(row.querySelector(".bi-translation"))
            .display,
          "none",
        );
        change("显示语言", "both");
        change("字号", "15");
        change("阅读模式", "compare");
        await wait(
          () =>
            doc.querySelectorAll(".bi-paper").length ===
            integration.pdf.numPages,
          "translated pages laid out",
          10000,
        );
        const nativeContainer =
          integration.win.document.getElementById("viewerContainer");
        const nativeRect = nativeContainer.getBoundingClientRect();
        const frameRect = integration.win.document
          .getElementById("zpt-bilingual-frame")
          .getBoundingClientRect();
        assert.isAtMost(
          nativeRect.right,
          frameRect.left + 2,
          "PDF and translation do not overlap",
        );
        assert.isAbove(nativeRect.width, 200, "native PDF remains visible");
        assert.equal(
          row.closest(".bi-paper").dataset.pageIndex,
          String(block.pageIndex),
        );
        assert.equal(
          doc.defaultView.getComputedStyle(chinese).display,
          "block",
        );
        assert.isAbove(
          doc.querySelectorAll(".bi-paper > img").length,
          0,
          "figures retained at page coordinates",
        );
        const paper = row.closest(".bi-paper");
        const rects = (
          Array.from(
            paper.querySelectorAll(":scope > .bi-row, :scope > img"),
          ) as HTMLElement[]
        )
          .filter((e) => e.getClientRects().length)
          .map((e) => e.getBoundingClientRect());
        for (let a = 0; a < rects.length; a++)
          for (let b = a + 1; b < rects.length; b++) {
            const x =
              Math.min(rects[a].right, rects[b].right) -
              Math.max(rects[a].left, rects[b].left);
            const y =
              Math.min(rects[a].bottom, rects[b].bottom) -
              Math.max(rects[a].top, rects[b].top);
            assert.isFalse(
              x > 5 && y > 2,
              "translated blocks must not overlap",
            );
          }
        await Zotero.Promise.delay(800);
        integration.win.PDFViewerApplication.pdfViewer.currentPageNumber = 4;
        const fourthID = document.blocks.find((b) => b.pageIndex === 3)!.id;
        await wait(
          () =>
            Math.abs(
              doc
                .querySelector('[data-block-id="' + fourthID + '"]')
                .getBoundingClientRect().top -
                doc.querySelector(".bi-list").getBoundingClientRect().top,
            ) < 5,
          "native PDF page synchronizes translated page",
          10000,
        );
        await Zotero.Promise.delay(800);
        const sixthID = document.blocks.find((b) => b.pageIndex === 5)!.id;
        doc.querySelector('[data-block-id="' + sixthID + '"]').scrollIntoView();
        await wait(
          () =>
            integration.win.PDFViewerApplication.pdfViewer.currentPageNumber ===
            6,
          "translated page synchronizes native PDF",
          10000,
        );
        row.scrollIntoView();
        await Zotero.Promise.delay(500);
        const comparisonRange = doc.createRange();
        comparisonRange.selectNodeContents(
          row.querySelector(".bi-translation"),
        );
        const currentSelection = doc.defaultView.getSelection();
        currentSelection.removeAllRanges();
        currentSelection.addRange(comparisonRange);
        assert.isFalse(
          currentSelection.isCollapsed,
          "comparison text remains selectable",
        );
        change("译文缩放", "1.25");
        await Zotero.Promise.delay(350);
        assert.isFalse(
          doc.defaultView.getSelection().isCollapsed,
          "page relayout preserves selection",
        );
        const beforeUnderline = attachment.getAnnotations().length;
        (Array.from(doc.querySelectorAll("button")) as HTMLButtonElement[])
          .find((b) => b.textContent === "Underline selection")!
          .click();
        await wait(
          () => attachment.getAnnotations().length > beforeUnderline,
          "comparison selection creates annotation",
          10000,
        );
        assert.isTrue(
          attachment
            .getAnnotations()
            .some((a: any) => a.annotationType === "underline"),
        );
        change("译文缩放", "1");
        change("阅读模式", "immersive");
        assert.equal(doc.querySelectorAll(".bi-paper").length, 0);
        assert.isOk(
          row.closest(".bi-section"),
          "original section order restored",
        );
        assert.notEqual(nativeContainer.style.right, "50%");
        assert.equal(calls, firstCalls, "reading settings never retranslate");
        reader.close();
        await Zotero.Promise.delay(200);
        reader = await Zotero.Reader.open(attachment.id);
        await reader._initPromise;
        const reopened = await pdfIntegration(reader);
        (
          Array.from(
            reader._iframeWindow.document.querySelectorAll("button"),
          ) as HTMLButtonElement[]
        )
          .find((b) => b.textContent === "BILINGUAL")!
          .click();
        await wait(
          () =>
            reopened.win.document
              .querySelector("#zpt-bilingual-frame")
              ?.contentDocument.querySelector("#zpt-bilingual [role=status]")
              ?.textContent?.startsWith("READY"),
          "reopen durable cache",
          20000,
        );
        assert.equal(
          calls,
          firstCalls,
          "closing and reopening reader uses durable translations",
        );
      } finally {
        service.translate = originalTranslate;
        running.data.translate.batchTaskDelay = originalDelay;
        reader.close();
        await attachment.eraseTx();
      }
    } catch (error) {
      const message =
        stage + ": " + String(error) + "\n" + (error as any)?.stack;
      await Zotero.File.putContentsAsync(
        (Zotero.Prefs.get("bilingual.test.fixture", true) as string) +
          ".error.txt",
        message,
      );
      throw new Error(message);
    }
  });
});

bilingualDescribe("Academic provider contract", function () {
  it("preserves segment IDs and protected citations without modifying shared prompts", async function () {
    const running = (Zotero as any).PDFTranslate;
    (globalThis as any).addon = running;
    const service =
      running.data.translate.services.getServiceById("customgpt3");
    const previous = service.translate;
    setPref("translateSource", "customgpt3");
    setPref("customGPT3.model", "contract-model");
    setPref("customGPT3.endPoint", "http://127.0.0.1:23190");
    setPref("customGPT3.prompt", "Existing selection prompt: ${sourceText}");
    const b: any = {
      id: "contract",
      source: "Embodiment matters (Smith, 2024). Another claim.",
      segments: segmentText(
        "Embodiment matters (Smith, 2024). Another claim.",
        "contract",
      ),
    };
    let requests = 0;
    service.translate = async (task: any) => {
      requests++;
      assert.include(task.bilingualInstruction, "Do not summarise");
      assert.include(task.bilingualInstruction, "具身性");
      const units = JSON.parse(task.raw);
      assert.deepEqual(
        units.map((u: any) => u.id),
        b.segments.map((s: any) => s.id),
      );
      task.result = JSON.stringify(
        units
          .map((u: any) => ({
            id: u.id,
            translation:
              "测试译文。" + (u.text.match(/⟦ZPT_KEEP_\d+⟧/g) || []).join(""),
          }))
          .reverse(),
      );
    };
    try {
      const context = translationContext({ embodiment: "具身性" }, "academic");
      const response = await translateBlock(b, context, 0);
      applyTranslations(b, response);
      assert.include(b.translation, "(Smith, 2024)");
      assert.equal(requests, 1);
      assert.equal(
        getPref("customGPT3.prompt"),
        "Existing selection prompt: ${sourceText}",
      );
      service.translate = async (task: any) => {
        task.result = JSON.stringify(
          b.segments.map((s: any) => ({ id: s.id, translation: "缺失引文" })),
        );
      };
      let failed = false;
      try {
        await translateBlock(b, context, 0);
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "corrupted citations cannot enter cache");
    } finally {
      service.translate = previous;
    }
  });
});

bilingualDescribe("Ordinary provider in academic mode", function () {
  it("translates Google text with academic enabled and keeps citations locally", async function () {
    const running = (Zotero as any).PDFTranslate;
    (globalThis as any).addon = running;
    setPref("translateSource", "google");
    const service = running.data.translate.services.getServiceById("google");
    const previous = service.translate;
    const source = "Prior work (Smith, 2024) [12] supports this claim.";
    const b: any = {
      id: "mt-contract",
      source,
      segments: segmentText(source, "mt-contract"),
    };
    let calls = 0;
    service.translate = async (task: any) => {
      calls++;
      assert.notInclude(task.raw, "ZPT_KEEP");
      assert.notInclude(task.raw, "Smith");
      task.result = "测试翻译";
    };
    try {
      const context = effectiveContext(
        translationContext({ work: "研究" }, "academic"),
      );
      assert.equal(context.mode, "standard");
      assert.deepEqual(context.glossary, { work: "研究" });
      applyTranslations(b, await translateBlock(b, context, 0));
      assert.include(b.translation, "研究");
      assert.include(b.translation, "(Smith, 2024)");
      assert.include(b.translation, "[12]");
      assert.isAbove(calls, 0);
      service.translate = async () => {
        throw new Error("HTTP 429 secret-not-for-display");
      };
      let message = "";
      try {
        await translateBlock(b, context, 0);
      } catch (error) {
        message = String(error);
      }
      assert.include(message, "限流");
      assert.notInclude(message, "secret-not-for-display");
      assert.include(
        providerFailure("401 key=private", "google").message,
        "认证",
      );
    } finally {
      service.translate = previous;
    }
  });
});
