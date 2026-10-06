# BiRead v0.1.0-beta

**BiRead — Bilingual PDF Reader for Zotero｜Zotero 双语 PDF 阅读插件**

## 中文

这是 BiRead 的首个公开测试版，帮助你在 Zotero 内阅读英文论文、查看中文翻译并进行标注。插件仍在持续完善，欢迎试用和反馈问题。

### 主要功能

- **沉浸式阅读**：支持中英对照、仅中文、仅英文，并可调整字号和行距。
- **PDF 对照阅读**：原 PDF 与译文并排显示，尽量保留原文的页面结构和标题层级。
- **翻译与缓存**：支持逐步翻译、暂停与继续、本地缓存及论文术语表。
- **标注**：支持高亮和下划线，并关联到原 PDF 的 Zotero 批注。
- **图表显示**：保留可提取的原始图片，支持部分矢量图的局部预览，以及部分纯文字表格的结构重建与翻译。
- **摘要标题修复**：将 Abstract 与摘要正文分开，标题显示为“摘要”；重新打开论文时自动更新旧解析缓存。

### 安装与使用

1. 下载本次 Release 附件中的 `BiRead-0.1.0-beta.xpi`，无需下载源码压缩包。
2. 在 Zotero 中打开 **工具 → 插件 → 齿轮菜单 → 从文件安装插件…**，选择该文件，按提示重启。
3. 在 BiRead 的设置中选择翻译服务，并填写该服务所需的凭据。
4. 打开可选中文字的英文 PDF，点击阅读器工具栏中的 **BILINGUAL**。

BiRead 可独立使用，无需另装 zotero-pdf-translate（Translate for Zotero）。两者使用不同的插件身份，但本测试版**不建议同时启用**，以免出现重复的翻译弹窗或批注控件；使用 BiRead 时请停用上游插件。BiRead 不会自动停用或卸载其他插件。

BiRead 的设置和服务凭据独立保存，不会自动迁移或删除上游设置。此前使用过上游插件或早期开发版的用户，需要在 BiRead 中重新配置。**本版采用手动更新，自动更新尚未启用。**

### 已知限制

- 这是测试版，复杂 PDF 的阅读顺序、标题、图片和表格识别仍可能出错，排版不保证与原 PDF 完全一致。
- 不支持没有可选文字的扫描 PDF，不包含 OCR。
- 中文选词标注目前对应到原文的完整句段，尚未实现可靠的逐词对齐。
- 图片内容不翻译；复杂图表可能需要返回原 PDF 查看。
- 暂不支持手机阅读和导出译文 PDF。
- 翻译速度、质量、限额和费用取决于所选服务。翻译文字会发送给该服务；BiRead 不提供自有翻译服务器。

### 反馈与致谢

欢迎通过 [BiRead Issues](https://github.com/WWeiyiWang/BiRead/issues) 反馈问题，请注明 Zotero/BiRead 版本、操作系统、翻译服务和复现步骤。分享日志或截图前，请移除 API 密钥、令牌、私人论文内容和个人路径。

BiRead 是基于 [windingwind/zotero-pdf-translate 2.4.8](https://github.com/windingwind/zotero-pdf-translate) 的独立分支，保留所需的上游翻译功能，并加入双语 PDF 阅读工作流。上游 AGPL 许可证和版权声明均予保留。BiRead 不是上游项目的官方更新，也不代表上游维护者背书。

---

## English

This is BiRead’s first public beta, bringing English–Chinese PDF reading and annotations into Zotero. The plugin is still being improved, and bug reports are welcome.

### Highlights

- **Immersive reading:** bilingual, Chinese-only, and English-only views with adjustable font size and line spacing.
- **PDF comparison:** the original PDF beside translated text, preserving page structure and heading hierarchy where extraction allows.
- **Translation and caching:** progressive translation, pause/resume, local caching, and a per-document glossary.
- **Annotations:** highlights and underlines linked to Zotero annotations in the source PDF.
- **Figures and tables:** original extractable images, local previews for some vector figures, and reconstruction and translation of some text-based tables.
- **Abstract heading fix:** separates the Abstract label from its prose and translates the heading as “摘要”. Older extraction caches are rebuilt when reopening a document.

### Installation and use

1. Download `BiRead-0.1.0-beta.xpi` from this release’s assets. You do not need the source-code archive.
2. In Zotero, open **Tools → Plugins → gear menu → Install Plugin From File…**, select the file, and restart if prompted.
3. Choose a translation provider in BiRead’s settings and enter any credentials it requires.
4. Open an English PDF with selectable text and click **BILINGUAL** in the reader toolbar.

BiRead works standalone; zotero-pdf-translate (Translate for Zotero) is not required. The two have separate add-on identities, but **simultaneous activation is not recommended** in this beta because translation popups or annotation controls may be duplicated. Disable the upstream plugin while using BiRead. BiRead does not automatically disable or uninstall other plugins.

BiRead stores its settings and provider credentials separately and does not migrate or delete upstream settings. Users of the upstream plugin or earlier development builds need to configure BiRead again. **Updates are manual in this beta; automatic updates are not enabled.**

### Known limitations

- This is beta software. Reading order, headings, figures, and tables may be misidentified in complex PDFs, and layout fidelity is not guaranteed.
- Scanned PDFs without selectable text are unsupported; no OCR is included.
- A Chinese word selection currently maps to its complete source sentence segment. Reliable word-level alignment is not implemented.
- Image contents are not translated. Complex figures or tables may need to be viewed in the original PDF.
- Mobile reading and translated-PDF export are not implemented.
- Translation speed, quality, limits, and costs depend on the selected provider. Text is sent to that provider; BiRead does not operate a translation server.

### Feedback and credits

Please report reproducible problems at [BiRead Issues](https://github.com/WWeiyiWang/BiRead/issues), including your Zotero/BiRead versions, operating system, provider, and reproduction steps. Remove API keys, tokens, private PDF text, and personal paths before sharing logs or screenshots.

BiRead is an independent fork based on [zotero-pdf-translate by windingwind](https://github.com/windingwind/zotero-pdf-translate), version 2.4.8. It retains the upstream translation functionality it needs and adds a bilingual PDF reading workflow. Upstream AGPL license and copyright notices are retained. BiRead is not an official upstream update and does not imply endorsement by the upstream maintainer.
