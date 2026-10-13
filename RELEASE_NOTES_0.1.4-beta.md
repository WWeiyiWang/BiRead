# BiRead 0.1.4-beta

## 中文
- 修复部分中英文标注对应范围过大、扩展到后续多句的问题。
- 本地模型对齐增加跨句与分散匹配检查；完整译文分段不再直接扩展成多句原文。
- 保留手动绑定／重新关联。自动匹配仍可能存在词组边界偏差。

安装：下载 XPI，在 Zotero 插件管理中从文件安装，然后完全退出并重启 Zotero。已有错误标注需要手动重新关联或删除后重新标注，本次不会自动改写旧标注。

验证：52 项测试通过；使用截图文字实际运行本地模型检查。用户安装测试后确认可用。仍为测试版，不保证所有论文的词组对齐准确。

## English
- Fix oversized bilingual annotation matches that could extend into subsequent sentences.
- Check cross-sentence and sparse local-model matches; selecting a complete translated segment no longer automatically maps to multiple source sentences.
- Manual binding and rebinding remain available. Automatic phrase boundaries can still be imperfect.

Install the XPI through Zotero's add-on manager, then fully quit and restart Zotero. Rebind existing incorrect annotations manually, or delete and recreate them; this update does not rewrite existing annotations.

Validation: 52 tests passed, with a real local-model check using the reported text. The user confirmed the installed build works. This remains a beta; alignment accuracy is not guaranteed for every paper.
