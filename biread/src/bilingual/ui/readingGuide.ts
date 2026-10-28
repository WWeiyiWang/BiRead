import type { Block } from "../types";
import {
  guideSections,
  type PaperGuide,
  type GuideKind,
} from "../translation/paperGuide";
import type { PDFImage } from "../parser/pdfImages";
/** In the renderer, preview means a crop of the complete figure region, not a subpanel. */
export function guideFigureImages(
  images: PDFImage[],
  block: Block,
): PDFImage[] {
  const matching = images.filter((image) => image.captionID === block.id);
  const complete = matching.filter((image) => image.preview);
  return complete.length ? complete : matching;
}
export interface GuideOptions {
  generate: (
    progress: (done: number, total: number) => void,
    cancelled: () => boolean,
  ) => Promise<PaperGuide>;
  figure: (block: Block) => Promise<PDFImage[]>;
  cached?: PaperGuide;
  save: (guide: PaperGuide) => void;
}

/** Extractive navigation only: never invent claims or strip numeric conditions. */
export function guideBlocks(blocks: Block[]): Block[] {
  const abstracts = blocks.filter((b) => b.kind === "abstract");
  const conclusion = blocks.findIndex(
    (b) =>
      b.kind === "heading" && /conclusion|concluding|总结|结论/i.test(b.source),
  );
  const ending: Block[] = [];
  if (conclusion >= 0) {
    for (const b of blocks.slice(conclusion + 1)) {
      if (b.kind === "heading" || b.kind === "reference") break;
      if (b.kind === "paragraph") ending.push(b);
      if (ending.length === 2) break;
    }
  }
  return [...abstracts.slice(0, 2), ...ending];
}

export function createReadingGuide(
  doc: Document,
  blocks: Block[],
  locate: (block: Block) => void,
  options?: GuideOptions,
): HTMLElement {
  const panel = doc.createElement("details");
  panel.className = "bi-reading-guide";
  panel.style.cssText =
    "padding:12px 20px;border-bottom:1px solid #8884;max-height:45vh;overflow:auto";
  const heading = doc.createElement("summary");
  heading.textContent = "论文导读 · 逐条核对";
  panel.append(heading);
  const note = doc.createElement("p");
  note.textContent =
    "以下摘自摘要和结论，不是 AI 总结。数字、单位与适用条件请结合原文核对。";
  panel.append(note);
  const excerpts = guideBlocks(blocks);
  if (!excerpts.length) {
    const empty = doc.createElement("p");
    empty.textContent = "未找到可靠的摘要或结论，请使用章节导航阅读全文。";
    panel.append(empty);
  }
  for (const block of excerpts) {
    const item = doc.createElement("details");
    const label = doc.createElement("summary");
    label.textContent = `${block.kind === "abstract" ? "摘要" : "结论摘录"} · p. ${block.pageLabel}`;
    const text = doc.createElement("p");
    text.textContent = (block.translation || block.source).replace(
      /\$BIREAD_MATH_[^$]+\$/g,
      "〔公式请见原文〕",
    );
    const button = doc.createElement("button");
    button.textContent = "核对原文";
    button.onclick = () => locate(block);
    item.append(label, text, button);
    panel.append(item);
  }
  if (options) {
    // Opening the panel never transmits paper text. Generation is an explicit action.
    const controls = doc.createElement("div");
    const generate = doc.createElement("button");
    generate.textContent = "生成 AI 导读";
    const cancel = doc.createElement("button");
    cancel.textContent = "取消";
    cancel.hidden = true;
    const status = doc.createElement("p");
    status.setAttribute("role", "status");
    status.textContent =
      "点击生成后，将可解析的论文正文分批发送给当前配置的大模型。";
    controls.append(generate, cancel, status);
    heading.after(controls);
    const content = doc.createElement("div");
    panel.append(content);
    let cancelled = false;
    cancel.onclick = () => {
      cancelled = true;
      status.textContent = "已取消；当前请求可能仍在结束，不再发送后续内容。";
    };
    const render = (guide: PaperGuide) => {
      content.replaceChildren();
      note.textContent =
        "以下为 AI 导读。出处和数字已做文本匹配，但不代表结论已经人工核实；请逐条核对含义、单位和条件。";
      for (const section of Array.from(panel.children)) {
        if (section.tagName === "DETAILS") section.remove();
      }
      for (const [title, kinds] of [
        ["简短导读", ["question", "method", "finding"]],
        ["关键结果", ["result"]],
        ["局限与疑问", ["limitation", "interpretation", "questionForReader"]],
      ] as [string, GuideKind[]][]) {
        const section = doc.createElement("section");
        const h = doc.createElement("h3");
        h.textContent = title;
        section.append(h);
        for (const kind of kinds) {
          const label = doc.createElement("h4");
          label.textContent = guideSections[kind];
          section.append(label);
          const list = doc.createElement("ul");
          section.append(list);
          const matches = guide.claims.filter((c) => c.kind === kind);
          if (!matches.length) {
            const empty = doc.createElement("p");
            empty.textContent = "未提取到可核对的条目。";
            section.append(empty);
          }
          for (const [index, claim] of matches.entries()) {
            const item = doc.createElement("li");
            item.style.cssText = "margin:10px 0;line-height:1.65";
            const text = doc.createElement("p");
            text.textContent = claim.text;
            item.append(text);
            if (claim.conditions) {
              const conditions = doc.createElement("p");
              conditions.textContent = "适用条件：" + claim.conditions;
              item.append(conditions);
            }
            const sources = doc.createElement("details");
            const summary = doc.createElement("summary");
            summary.textContent = `逐条核对 · ${claim.evidence.length} 处原文`;
            sources.append(summary);
            for (const [i, e] of claim.evidence.entries()) {
              const block = blocks.find((b) => b.id === e.blockId);
              if (!block) continue;
              const quote = doc.createElement("blockquote");
              quote.textContent = e.quote;
              const jump = doc.createElement("button");
              jump.textContent = `出处 ${i + 1} · p. ${block.pageLabel}（PDF 第 ${block.pageIndex + 1} 页）`;
              jump.onclick = () => locate(block);
              sources.append(quote, jump);
            }
            item.append(sources);
            if (index >= 3) item.hidden = true;
            list.append(item);
          }
          if (matches.length > 3) {
            const more = doc.createElement("button");
            more.textContent = `展开其余 ${matches.length - 3} 条`;
            more.onclick = () => {
              for (const li of Array.from(list.children))
                (li as HTMLElement).hidden = false;
              more.remove();
            };
            section.append(more);
          }
        }
        content.append(section);
      }
      status.textContent = `已分析 ${guide.chunks} 批正文；${guide.rejected} 条未通过出处或数字检查，未展示。`;
      if (blocks.some((b) => b.kind === "original-page"))
        status.textContent +=
          "部分页面只保留原版，未纳入分析，导读可能不完整。";
    };
    if (options.cached) render(options.cached);
    generate.onclick = async () => {
      generate.disabled = true;
      cancel.hidden = false;
      cancelled = false;
      try {
        const guide = await options.generate(
          (done, total) => {
            if (!cancelled && panel.isConnected)
              status.textContent = `正在分析正文 ${done}/${total}…`;
          },
          () => cancelled || !panel.isConnected,
        );
        if (!cancelled && panel.isConnected) {
          options.save(guide);
          render(guide);
        }
      } catch (error) {
        if (!cancelled && panel.isConnected)
          status.textContent =
            error instanceof SyntaxError
              ? "AI 返回格式有误，请重试。"
              : String((error as Error).message || "生成失败，请重试。");
      } finally {
        generate.disabled = false;
        cancel.hidden = true;
      }
    };
    const figures = doc.createElement("section");
    const title = doc.createElement("h3");
    title.textContent = "完整图表入口";
    figures.append(title);
    const captions = blocks.filter((b) => b.kind === "caption");
    for (const b of captions) {
      const figure = doc.createElement("details");
      const label = doc.createElement("summary");
      label.textContent =
        (b.source.match(
          /^(?:(?:Extended Data|Supplementary)\s+)?(?:Fig(?:ure)?\.?|Table|图|表)\s*[A-Za-z]?\d+/i,
        )?.[0] || "图表") + ` · p. ${b.pageLabel}`;
      const source = doc.createElement("p");
      source.textContent = b.source;
      const translated = doc.createElement("p");
      translated.textContent =
        b.translation || "图注翻译尚未完成；展开时刷新。";
      const images = doc.createElement("div");
      const jump = doc.createElement("button");
      jump.textContent = "查看完整原图所在 PDF";
      jump.onclick = () => locate(b);
      let loading = false;
      figure.ontoggle = async () => {
        if (!figure.open) return;
        translated.textContent = b.translation || "图注翻译尚未完成。";
        if (loading || images.childElementCount) return;
        loading = true;
        images.textContent = "加载完整图表…";
        try {
          const found = await options.figure(b);
          images.textContent = "";
          for (const image of found) {
            if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(image.src))
              continue;
            const img = doc.createElement("img");
            img.src = image.src;
            img.alt = label.textContent || "完整图表";
            img.style.cssText = "max-width:100%;height:auto";
            images.append(img);
          }
          if (!images.childElementCount)
            images.textContent = "暂未取得可靠的完整图表，请打开原 PDF 查看。";
        } catch {
          images.textContent = "图表加载失败，可重新展开重试或打开原 PDF。";
        } finally {
          loading = false;
        }
      };
      figure.append(label, images, source, translated, jump);
      figures.append(figure);
    }
    if (!captions.length) {
      const empty = doc.createElement("p");
      empty.textContent = "未识别到图注，请到原 PDF 核对图表。";
      figures.append(empty);
    }
    panel.append(figures);
  }
  return panel;
}
