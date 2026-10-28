import { build } from "esbuild";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const built = await build({
  entryPoints: ["src/bilingual/ui/readingGuide.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Guide",
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<main></main>");
  await page.addScriptTag({ content: built.outputFiles[0].text });
  assert.equal(
    await page.evaluate(() =>
      Guide.guideFigureImages(
        [
          { id: "full", captionID: "fig", preview: true },
          { id: "part", captionID: "fig" },
        ],
        { id: "fig" },
      )
        .map((x) => x.id)
        .join(","),
    ),
    "full",
  );
  await page.evaluate(() => {
    const blocks = [
      {
        id: "a",
        kind: "abstract",
        source: "A measured force of 3.5 N.",
        pageIndex: 2,
        pageLabel: "465",
      },
      {
        id: "b",
        kind: "paragraph",
        source: "Under controlled conditions.",
        pageIndex: 3,
        pageLabel: "466",
      },
      {
        id: "fig",
        kind: "caption",
        source: "Figure 2. Full experiment.",
        translation: "图 2：完整实验。",
        pageIndex: 2,
        pageLabel: "465",
      },
    ];
    window.calls = 0;
    window.located = [];
    const panel = Guide.createReadingGuide(
      document,
      blocks,
      (b) => window.located.push(b.id),
      {
        save: () => {},
        generate: async () => {
          window.calls++;
          return {
            chunks: 1,
            rejected: 0,
            claims: [
              {
                kind: "result",
                text: "力为 3.5 N。",
                conditions: "受控条件",
                evidence: [
                  { blockId: "a", quote: blocks[0].source },
                  { blockId: "b", quote: blocks[1].source },
                ],
              },
            ],
          };
        },
        figure: async () => [
          {
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=",
          },
        ],
      },
    );
    panel.open = true;
    document.querySelector("main").append(panel);
  });
  assert.equal(await page.evaluate(() => window.calls), 0);
  await page.getByRole("button", { name: "生成 AI 导读" }).click();
  await page.getByText("逐条核对 · 2 处原文").click();
  await page.getByRole("button", { name: /出处 2/ }).click();
  assert.deepEqual(await page.evaluate(() => window.located), ["b"]);
  await page.getByText("Figure 2 · p. 465", { exact: true }).click();
  await page.locator("img").waitFor();
  assert.equal(
    await page.getByText("图 2：完整实验。", { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "AI 解释", exact: true })
      .isVisible(),
    true,
  );
  console.log(
    "PASS: explicit generation, multi-source jumps, five-part guide, full figure and translated caption",
  );
} finally {
  await browser.close();
}
