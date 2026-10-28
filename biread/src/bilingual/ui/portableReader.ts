import type { Block } from "../types";
import type { PDFImage } from "../parser/pdfImages";
import { guideBlocks } from "./readingGuide";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const safeImage = (s: string) =>
  /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(s);

/** No remote assets, external scripts, API keys, or executable document text. */
export function portableReader(blocks: Block[], images: PDFImage[]): string {
  const title = blocks.find((b) => b.kind === "title")?.source || "BiRead 论文";
  const imageHTML = (image: PDFImage, inline = false) =>
    safeImage(image.src)
      ? `<img class="${inline ? "math" : "figure"}" src="${image.src}" alt="${inline ? "原文公式" : "原文图表或公式"}">`
      : "<span>〔图片尚未就绪，请回桌面加载后重新导出〕</span>";
  const rich = (block: Block, text: string) => {
    let result = escape(text);
    for (const math of block.inlineMath || []) {
      const image = images.find((i) => i.captionID === math.id);
      result = result
        .split(escape(math.token))
        .join(
          image
            ? imageHTML(image, true)
            : "〔公式尚未就绪，请回桌面加载后重新导出〕",
        );
    }
    return result;
  };
  const guide = guideBlocks(blocks)
    .map(
      (b) =>
        `<li><a href="#b${blocks.indexOf(b)}">${b.kind === "abstract" ? "摘要" : "结论摘录"} · p. ${escape(b.pageLabel)}</a></li>`,
    )
    .join("");
  const outline = blocks
    .map((b, i) =>
      b.kind === "heading"
        ? `<li style="margin-left:${Math.min(5, Math.max(0, (b.headingLevel || 1) - 1))}em"><a href="#b${i}">${escape(b.source)}</a></li>`
        : "",
    )
    .join("");
  const rows = blocks
    .filter(
      (b) =>
        b.kind !== "publication-info" &&
        !(
          b.table &&
          images.some(
            (im) => im.captionID === b.table!.captionID && safeImage(im.src),
          )
        ),
    )
    .map((b) => {
      const visual = images.filter((im) => im.captionID === b.id);
      const originalOnly = b.kind === "equation" || b.kind === "original-page";
      const content = originalOnly
        ? visual.length
          ? ""
          : "<p>原文区域尚未加载，请回桌面加载后重新导出。</p>"
        : `<div class="translation">${rich(b, b.translation || "译文尚未完成")}</div><details class="source"><summary>核对英文原文 · p. ${escape(b.pageLabel)}</summary><p>${rich(b, b.source)}</p></details>`;
      const labels: Record<string, string> = {
        "author-info": "作者信息",
        reference: "Reference",
        caption: "图表说明",
        equation: "原文公式",
        heading: "章节",
        title: "标题",
        abstract: "摘要",
        footnote: "脚注",
        "original-page": "原版页面",
      };
      return `<article id="b${blocks.indexOf(b)}" data-kind="${escape(b.kind)}"><small>p. ${escape(b.pageLabel)} · ${labels[b.kind] || "正文"}</small>${visual.map((im) => imageHTML(im)).join("")}${content}</article>`;
    })
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="biread-reader" content="1"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>
  :root{color-scheme:light dark;font:18px/1.8 system-ui;background:Canvas;color:CanvasText}body{margin:auto;max-width:850px;padding:16px 20px 80px}header{border-bottom:1px solid #8885;padding-bottom:14px}h1{font-size:1.5rem;line-height:1.4}button,summary,a{touch-action:manipulation}button{min-height:44px;padding:8px 14px;margin:4px;border:1px solid #8888;border-radius:8px;background:Canvas;color:CanvasText}a{color:LinkText}article{padding:22px 0;border-bottom:1px solid #8884;scroll-margin-top:16px;overflow-wrap:anywhere}small{opacity:.65;display:block;margin-bottom:10px}details{margin:12px 0}summary{cursor:pointer;min-height:44px}.figure{display:block;max-width:100%;height:auto;margin:16px auto}.math{display:inline-block;max-width:100%;max-height:2.4em;width:auto;vertical-align:middle}.source p{opacity:.85}article[data-kind=heading] .translation,article[data-kind=title] .translation{font-weight:700;font-size:1.2em}article[data-kind=author-info],article[data-kind=reference]{font-size:.9em}body.original .source{display:block}body.original .translation{display:none}body.original .source>summary{display:none}progress{width:100%;height:5px}nav ul{padding-left:22px}@media print{header button,progress{display:none}}
  </style></head><body><header><small>BiRead · 离线阅读</small><h1>${escape(title)}</h1><p>桌面阅读快照。未加载的图片、未完成的译文会明确提示；不会自动同步后续修改。</p><button id="language">显示英文</button><button id="size">增大字号</button><button id="back">返回上一位置</button><progress id="progress" max="1" value="0" aria-label="阅读进度"></progress><details><summary>论文导读 · 可核对摘录</summary><p>摘要与结论原文摘录入口，不是 AI 总结。</p><ul>${guide || "<li>未找到可靠摘录</li>"}</ul></details><nav><details><summary>章节目录</summary><ul>${outline}</ul></details></nav></header>${rows}<script>
  const key='biread:'+document.title;let previous=0;const progress=document.getElementById('progress');
  document.getElementById('language').onclick=function(){const active=document.body.classList.toggle('original');document.querySelectorAll('.source').forEach(el=>el.open=active);this.textContent=active?'显示中文':'显示英文'};
  document.getElementById('size').onclick=function(){const large=document.documentElement.style.fontSize==='22px';document.documentElement.style.fontSize=large?'18px':'22px';this.textContent=large?'增大字号':'恢复字号'};
  document.querySelectorAll('a[href^="#b"]').forEach(a=>a.onclick=()=>{previous=scrollY});document.getElementById('back').onclick=()=>scrollTo(0,previous);
  let timer;addEventListener('scroll',()=>{const max=document.documentElement.scrollHeight-innerHeight;progress.value=max>0?scrollY/max:1;clearTimeout(timer);timer=setTimeout(()=>{try{localStorage.setItem(key,String(scrollY))}catch{}},300)},{passive:true});
  addEventListener('load',()=>{try{const saved=Number(localStorage.getItem(key));if(Number.isFinite(saved)&&saved>0)scrollTo(0,saved)}catch{}});
  </script></body></html>`;
}
