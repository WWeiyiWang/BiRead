# BiRead 0.1.1-beta

## 中文
- 右键菜单简化为高亮、划线、批注，保留选中文字。
- 增加可选的离线上下文词组对齐；支持中英文双向关联及旧标注手动重新绑定，也可输入本段中唯一出现的对应词组。
- 批注输入后自动保存，移除 Save comment；关闭面板或切换标注时等待保存完成。
- 保留精确词组关联，无法可靠匹配时保留单侧标注，避免扩大成整句。

安装：下载 BiRead-0.1.1-beta.xpi，在 Zotero 工具 → 插件 → 从文件安装插件中更新。自动更新尚未启用。

本地模型为可选功能，XPI 不包含模型、Python 或依赖，也不会自动下载。已有本地配置可继续使用；新用户请阅读仓库的 biread/BILINGUAL.md。未配置模型时使用本地已有词组及手动绑定。模型仍可能错配，不能保证逐词准确。映射和本机译文标注不会通过 Zotero 同步。

验证：Windows / Zotero 10.0.6 实际操作验证右键标注、双向词组关联与手动修正；批注输入后关闭、重新打开面板，内容保留。其他平台及全部声明版本未完成实测。本版本仍为测试版。

## English
- Simplified the context menu to Highlight, Underline and Comment while preserving the text selection.
- Added optional offline contextual phrase alignment, bidirectional phrase links, and manual rebinding for existing annotations. A unique phrase from the same paragraph can also be entered manually.
- Comments now save automatically as you type. Closing the editor or switching annotations waits for pending saves; the Save comment button is removed.
- Exact phrase links are retained. Unreliable matches remain one-sided instead of expanding to a whole sentence.

Install BiRead-0.1.1-beta.xpi through Zotero Tools → Plugins → Install Plugin From File. Automatic updates are not enabled.

The optional model, Python and dependencies are not bundled or downloaded by the XPI. Existing local configurations continue to work; see biread/BILINGUAL.md for setup. Without a model, local known pairs and manual binding remain available. Alignment can still be incorrect. Phrase mappings and local translated annotations do not sync through Zotero.

Manually checked on Windows / Zotero 10.0.6: context-menu annotations, bidirectional phrase links, manual correction, and typed comments retained after closing and reopening the editor. Other platforms and the full declared Zotero version range have not been tested. This remains a beta release.
