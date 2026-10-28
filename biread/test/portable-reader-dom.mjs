import { build } from "esbuild";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const built = await build({
  entryPoints: ["src/bilingual/ui/portableReader.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { portableReader } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const blocks = Array.from({ length: 16 }, (_, i) => ({
  id: String(i),
  kind: i === 0 ? "abstract" : i === 1 ? "heading" : "paragraph",
  source:
    i === 1 ? "1. Introduction" : `Evidence ${i}: 3.5 mg under condition A.`,
  translation: `第 ${i} 段，在条件 A 下为 3.5 mg。`,
  pageIndex: 0,
  pageLabel: "1",
  anchors: [],
  segments: [],
}));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.route("https://biread.test/", (r) =>
    r.fulfill({ contentType: "text/html", body: portableReader(blocks, []) }),
  );
  await page.goto("https://biread.test/");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "显示英文" }).click();
  assert.equal(await page.locator(".source").first().getAttribute("open"), "");
  assert.equal(await page.locator(".translation").first().isVisible(), false);
  await page.getByRole("button", { name: "显示中文" }).click();
  await page.getByRole("button", { name: "增大字号" }).click();
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
    "22px",
  );
  await page.getByText("章节目录", { exact: true }).click();
  await page.getByRole("link", { name: "1. Introduction" }).click();
  assert.equal(await page.evaluate(() => location.hash), "#b1");
  await page.evaluate(() => scrollTo(0, 800));
  await page.waitForTimeout(400);
  assert.ok(
    await page.evaluate(
      () => Number(localStorage.getItem("biread:" + document.title)) > 0,
    ),
  );
  console.log(
    "PASS: 390px layout, bilingual toggle, font size, outline, saved progress",
  );
} finally {
  await browser.close();
}
