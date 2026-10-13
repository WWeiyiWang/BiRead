# BiRead 0.1.2-beta

## 中文
本地词组对齐现在可以一键安装，不用手动安装 Python、复制命令或编辑 JSON。

**使用：**更新 XPI → BILINGUAL → 显示设置 → 一键安装本地模型，等待“安装完成并已启用”。[三步中文教程](https://github.com/WWeiyiWang/BiRead/blob/main/docs/LOCAL_MODEL_ZH.md)

- 支持 Windows x64；首次下载约 194 MB，建议预留 1 GB 空间。
- 自动下载独立 Python、推理依赖和模型，显示进度、校验 SHA-256、生成配置并运行验证。
- 失败可重试；已校验下载可复用，已有安装通过运行检查后无需重新下载。运行检查通过前不切换配置。
- 普通翻译不需要安装模型；模型运行本地，不需要对齐 API 密钥。正文翻译仍使用原先的服务。
- 保留手动配置、手动重新关联及批注自动保存。模型不保证所有词组准确匹配。

实测：Windows / Zotero 10.0.6 内点击一键安装成功、重复点击复用；英文 visitors → 中文“游客”、中文“颜色” → 英文 colors 标注成功。其他系统暂不支持自动安装。仍为 beta。

## English
One-click offline alignment setup is now available on Windows x64. No separate Python installation, terminal commands or JSON editing is required.

Update the XPI, open BILINGUAL → settings → 一键安装本地模型, and wait for the completion message. The first download is about 194 MB; allow 1 GB of disk space. Files come from Python.org, PyPI and Hugging Face, are SHA-256 verified, and the standalone runtime is tested before activating the configuration. Failed setup can be retried; verified downloads and working installations are reused.

Translation works without this optional model. Alignment runs locally; ordinary translation provider terms still apply. Manual configuration, phrase rebinding and autosaved comments remain available. Automatic phrase matching can still be wrong.

Manually verified on Windows / Zotero 10.0.6: first installation, reuse, and English-to-Chinese / Chinese-to-English annotation examples. Automatic installation on other platforms is not supported yet. Beta release.
