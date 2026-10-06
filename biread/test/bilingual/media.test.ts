import { createBilingualSurface } from "../../src/bilingual/reader/pdfIntegration";
import { BilingualView } from "../../src/bilingual/ui/bilingualView";
import { CompareMode } from "../../src/bilingual/reader/compareMode";
import { AnnotationControls } from "../../src/bilingual/ui/annotationControls";
import { applyTranslations } from "../../src/bilingual/alignment/segmentAlignment";
import { setPref } from "../../src/utils/prefs";
import { pdfIntegration } from "../../src/bilingual/reader/pdfIntegration";
import { extractDocument } from "../../src/bilingual/parser/pdfTextExtractor";
import { readingOrder } from "../../src/bilingual/parser/readingOrder";
const mediaDescribe = Zotero.Prefs.get("bilingual.test.mediaFixture", true)
  ? describe
  : describe.skip;
mediaDescribe("Healthcare figures and text tables", function () {
  this.timeout(120000);
  it("keeps one photo and translates the complete seven-row table with selectable cells", async function () {
    (globalThis as any)._globalThis = Zotero.getMainWindow();
    const path = String(Zotero.Prefs.get("bilingual.test.mediaFixture", true));
    const attachment = await Zotero.Attachments.importFromFile({ file: path });
    const reader: any = await Zotero.Reader.open(attachment.id);
    try {
      const i = await pdfIntegration(reader);
      const doc = await extractDocument(
        i.pdf,
        i.identity,
        i.fingerprint,
        () => {},
        () => false,
      );
      await IOUtils.writeJSON(path + ".blocks.json", doc.blocks);
      const cells = doc.blocks.filter((b) => b.pageIndex === 3 && b.table);
      assert.lengthOf(cells, 13, "merged header plus six two-column rows");
      assert.equal(cells.find((b) => b.table!.row === 0)!.table!.colSpan, 2);
      assert.include(
        cells.find((b) => b.table!.row === 0)!.source,
        "Healthcare Built Environment",
      );
      assert.isTrue(cells.some((b) => b.source === "Room privacy"));
      assert.isTrue(cells.some((b) => b.source.includes("Avoid disruptions")));
      assert.isFalse(
        doc.blocks
          .find((b) => b.id === cells[0].table!.captionID)!
          .source.includes("Telemedicine and Healthcare"),
        "table header separated from caption",
      );
      assert.lengthOf(
        doc.blocks.filter(
          (b) =>
            b.pageIndex === 9 &&
            b.kind === "caption" &&
            /^Figure 2/.test(b.source),
        ),
        1,
        "overlapping duplicate caption removed",
      );
      const figures = await i.pdf.getFigures(9, doc.blocks, () => false);
      assert.lengthOf(
        figures,
        1,
        "one figure preview for one source placement",
      );
      assert.lengthOf(
        await i.pdf.getFigures(3, doc.blocks, () => false),
        0,
        "text table does not also render a clipped image",
      );
      for (const b of doc.blocks)
        applyTranslations(
          b,
          b.segments.map((segment) => ({
            id: segment.id,
            translation: b.table
              ? "中文单元格完整内容，保留原表的各项条件与注释。".repeat(4)
              : "中文正文。",
          })),
        );
      setPref("bilingual.readingMode", "immersive");
      setPref("bilingual.language", "translation");
      const frame = await createBilingualSurface(i);
      const ui = new BilingualView(
        frame.contentDocument!,
        () => {},
        () => {},
      );
      const annotations = new AnnotationControls(ui, i, () => doc.blocks);
      await annotations.bridge.start();
      const compare = new CompareMode(i, frame, ui, () => doc.blocks);
      try {
        ui.furniture = doc.furniture || [];
        const furniture = ui.furniture.find((p) => p.pageIndex === 3)!;
        assert.include(
          furniture.glyphs.map((g) => g.text).join(""),
          "Sustainability",
        );
        assert.isAbove(
          furniture.rules.length,
          0,
          "original margin rule retained",
        );
        assert.isFalse(
          doc.blocks.some(
            (b) => b.pageIndex === 3 && /^Sustainability/.test(b.source),
          ),
          "running header is not translated as body",
        );
        ui.showBlocks(doc.blocks);
        const rawImages = await i.pdf.getImages(9, () => false);
        assert.isAbove(rawImages.images.length, 0);
        ui.showImage(rawImages.images[0], doc.blocks);
        assert.equal(
          ui.root.querySelector(".bi-figure img")!.getAttribute("src"),
          rawImages.images[0].src,
          "original embedded image is retained unchanged",
        );
        ui.showImage(figures[0], doc.blocks);
        ui.showImage({ ...figures[0], id: "duplicate-preview" }, doc.blocks);
        ui.root.dataset.readingMode = "compare";
        compare.set(true);
        await Zotero.Promise.delay(600);
        const table = ui.root.querySelector(
          '.bi-structured-table[data-page-index="3"]',
        ) as HTMLElement;
        assert.isOk(table);
        const paper = table.closest(".bi-paper") as HTMLElement;
        const pageBox = furniture.box;
        const paperScale =
          paper.getBoundingClientRect().width / (pageBox[2] - pageBox[0]);
        assert.closeTo(
          paper.getBoundingClientRect().height,
          (pageBox[3] - pageBox[1]) * paperScale,
          1,
          "original page aspect ratio retained",
        );
        assert.isAbove(paper.querySelectorAll(".bi-page-furniture").length, 0);
        assert.isAbove(paper.querySelectorAll(".bi-page-rule").length, 0);
        assert.closeTo(
          table.getBoundingClientRect().top - paper.getBoundingClientRect().top,
          (pageBox[3] - cells[0].table!.rect[3]) * paperScale,
          1,
          "table keeps original PDF position",
        );
        assert.isAtMost(
          table.getBoundingClientRect().height,
          (cells[0].table!.rect[3] - cells[0].table!.rect[1]) * paperScale + 1,
          "long Chinese fits original table bounds",
        );
        assert.lengthOf(table.querySelectorAll("tr"), 7);
        assert.lengthOf(table.querySelectorAll("td,th"), 13);
        assert.equal(table.querySelector("th")!.colSpan, 2);
        assert.lengthOf(
          ui.root.querySelectorAll('.bi-paper[data-page-index="9"] > img'),
          1,
        );
        const rows = Array.from(table.querySelectorAll("tr")) as HTMLElement[];
        for (let n = 1; n < rows.length; n++)
          assert.isAtLeast(
            rows[n].getBoundingClientRect().top,
            rows[n - 1].getBoundingClientRect().bottom - 1,
            "all rows remain visible without overlap",
          );
        const heading = doc.blocks.find(
          (b) => b.pageIndex === 3 && /^2.2.1./.test(b.source),
        )!;
        const after = ui.root.querySelector(
          '[data-block-id="' + heading.id + '"]',
        ) as HTMLElement;
        assert.isAtLeast(
          after.getBoundingClientRect().top,
          table.getBoundingClientRect().bottom - 1,
          "next section follows complete table",
        );
        const target = cells.find((b) => b.source === "Room privacy")!;
        ui.scrollTo(target.id);
        await Zotero.Promise.delay(800);
        const cell = ui.root.querySelector(
          '[data-block-id="' + target.id + '"] .bi-translation',
        )!;
        const range = ui.doc.createRange();
        range.selectNodeContents(cell);
        const selection = ui.doc.defaultView!.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        const selected = ui.selection();
        assert.isOk(selected, "translated table cell is selectable");
        assert.equal(selected!.blockID, target.id);
        const key = await annotations.bridge.create(
          target,
          "translation",
          0,
          target.translation!.length,
          "#ffd400",
        );
        const item = Zotero.Items.getByLibraryAndKey(attachment.libraryID, key);
        assert.include((item as Zotero.Item).annotationText, "Room privacy");
        compare.set(false);
        ui.root.dataset.readingMode = "immersive";
        assert.lengthOf(
          ui.root.querySelectorAll(".bi-page-furniture"),
          0,
          "immersive mode hides page furniture",
        );
        assert.isOk(
          table.closest(".bi-section"),
          "structured table survives mode switching",
        );
      } finally {
        compare.dispose();
        annotations.dispose();
        ui.dispose();
        frame.remove();
      }
      for (const page of [3, 9]) {
        const data = await i.pdf.getPageData({ pageIndex: page });
        const graphics = await i.pdf.getGraphics(page);
        const figures = await i.pdf.getFigures(page, doc.blocks, () => false);
        const images = await i.pdf.getImages(page, () => false);
        await IOUtils.writeJSON(path + ".p" + page + ".json", {
          glyphs: readingOrder(data.chars),
          graphics,
          blocks: doc.blocks.filter((b) => b.pageIndex === page),
          figures: figures.map(({ src, ...f }: any) => f),
          images: images.images.map(({ src, ...f }: any) => f),
        });
      }
    } catch (error) {
      await IOUtils.writeUTF8(
        path + ".error.txt",
        String(error) + "\n" + (error as Error).stack,
      );
      throw error;
    } finally {
      reader.close();
      await attachment.eraseTx();
    }
  });
});
