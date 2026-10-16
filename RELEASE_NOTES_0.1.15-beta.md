# BiRead 0.1.15-beta

## 中文

- 补齐原 PDF 标注到译文的本地模型对齐流程，保存对应关系，支持重开后恢复；需已配置本地模型。
- 改进公式和旋转表格的原样显示，减少公式碎片被当作正文翻译。
- 区分参考文献、作者与机构信息、图表说明；改进页眉页脚过滤及章节识别，避免将数值开头的正文误判为标题。
- 沉浸式阅读支持跨页正文衔接，采用白色界面与少量品牌色，修复阅读器 Logo 显示。
- Windows x64 首次使用标注时可自动安装本地模型；下载失败可手动重试。

安装：下载 BiRead-0.1.15-beta.xpi，在 Zotero 插件管理器中选择“从文件安装插件”，安装后完全退出并重启 Zotero。

验证：70 项回归检查通过，类型检查、格式检查和构建通过。公式与表格曾使用实际论文的提取和浏览器渲染验证；本次原 PDF 标注同步修复尚未完成 Zotero 窗口实测。自动结构识别与词组对应仍可能不准确，可手动重新绑定。插件自身自动更新尚未启用。

## English

- Resolve native PDF annotations against translated text using the configured local model, and persist the links across reopening.
- Preserve original equations and rotated tables, reducing stray formula fragments in translated prose.
- Distinguish references, author affiliations and captions; improve page-furniture filtering and avoid treating measurement-led prose as headings.
- Continue interrupted prose across pages in immersive reading, refresh the white interface with subtle brand accents, and fix the reader logo.
- Automatically install the local model on first annotation use on Windows x64, with manual retry available.

Install BiRead-0.1.15-beta.xpi through Zotero's add-on manager, then fully quit and restart Zotero.

Validation: 70 regression checks passed, along with type checks, formatting and build. Equation/table extraction and browser rendering were checked with a real paper. The latest native-PDF annotation synchronization fix has not yet been verified in the live Zotero window. Structure recognition and phrase alignment can still require manual correction. Built-in automatic updates remain disabled.
