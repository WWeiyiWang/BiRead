# 本地词组对齐：中文安装教程（Windows）

适用于 BiRead **0.1.1-beta**。目前本地模型需要首次单独安装一次，XPI 安装包没有自带模型。下面的命令会自动生成配置文件，**不用手写路径或 JSON**。已经配置成功的用户升级插件后通常不用重做。

## 我一定要装吗？

- **阅读和翻译论文：不需要。**照常配置翻译服务即可。
- **高亮、划线、批注和手动绑定：不需要模型也能用。**
- **想让插件根据上下文自动寻找另一侧的对应词组：建议安装。**模型仍可能错配，发现错误可以手动修改，不保证每个词都对应准确。

模型用于“寻找已有中英文之间的关系”，不负责整篇论文翻译。模型文件约 **150 MB**；加上 Python 和运行依赖还要额外空间，建议预留 **1 GB**。首次安装需要联网，之后词组对齐在本机运行，无需模型 API 密钥，也不产生对齐 API 费用。正文翻译仍遵循你选择的翻译服务的联网、收费规则。

目前实际验证环境为 **Windows x64、Python 3.12、Zotero 10.0.6**。本教程不承诺 macOS、Linux、Windows ARM 或其他版本的兼容性。

## 1. 安装 Python（已有 3.12 可跳过）

到 [Python 官方 Windows 下载页](https://www.python.org/downloads/windows/) 下载并安装 **Python 3.12 的 Windows installer (64-bit)**。不是 embeddable package，也不是 32-bit 版本。安装时保留 Python Launcher（`py`）。

在开始菜单打开 **PowerShell**，输入：

```powershell
py -3.12 --version
```

看到 `Python 3.12.x` 后继续。若提示找不到 `py`，重新打开 PowerShell，或检查 Python Launcher 是否安装。

## 2. 安装运行依赖

将下面整段复制到 PowerShell 执行。无需管理员权限；文件放在当前用户目录下的 `BiRead-local-model`，不会修改系统 Python 的依赖。

```powershell
$ErrorActionPreference = 'Stop'
$biReadRoot = Join-Path $env:USERPROFILE 'BiRead-local-model'
New-Item -ItemType Directory -Force $biReadRoot | Out-Null
py -3.12 -m venv (Join-Path $biReadRoot 'runtime')
if ($LASTEXITCODE -ne 0) { throw '创建 Python 环境失败，请先确认第 1 步成功。' }
$biReadPython = Join-Path $biReadRoot 'runtime\Scripts\python.exe'
& $biReadPython -m pip install onnxruntime==1.31.0 tokenizers==0.23.3 numpy==2.5.4
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请保留报错，不要继续下一步。' }
```

等待安装完成，再在**同一个 PowerShell 窗口**执行下一步。

## 3. 下载模型并自动生成配置

下载来源：[cstr/awesome-align-onnx-int8](https://huggingface.co/cstr/awesome-align-onnx-int8/tree/e803a2f501474044099b539160aaca461976ecd0)。以下使用固定版本并校验文件，不需要 Hugging Face 账号。

```powershell
$biReadModel = Join-Path $biReadRoot 'model'
New-Item -ItemType Directory -Force $biReadModel | Out-Null
$biReadUrl = 'https://huggingface.co/cstr/awesome-align-onnx-int8/resolve/e803a2f501474044099b539160aaca461976ecd0'
$biReadFiles = @{
  'model.onnx' = 'beb17c2e9520155f7da7bb94a1fb8e74f5e528acdbd8f4415854c99a3d84f429'
  'tokenizer.json' = 'bf1b59b7b11c95f194f51708d918eea378e09d05f84c0e1656dc5180e8117088'
}
foreach ($biReadName in $biReadFiles.Keys) {
  $biReadFile = Join-Path $biReadModel $biReadName
  Invoke-WebRequest -UseBasicParsing -Uri "$biReadUrl/$biReadName" -OutFile $biReadFile
  if ((Get-FileHash $biReadFile -Algorithm SHA256).Hash.ToLower() -ne $biReadFiles[$biReadName]) {
    throw "文件校验失败：$biReadName，请重新下载。"
  }
}
$biReadDeps = Join-Path $biReadRoot 'runtime\Lib\site-packages'
$biReadConfig = Join-Path $biReadRoot 'local-model.json'
$biReadJson = @{ python=$biReadPython; model=$biReadModel; deps=$biReadDeps } | ConvertTo-Json
[IO.File]::WriteAllText($biReadConfig, $biReadJson, (New-Object Text.UTF8Encoding($false)))
& $biReadPython -I -c "import sys; from pathlib import Path; import onnxruntime as o; from tokenizers import Tokenizer; p=Path(sys.argv[1]); Tokenizer.from_file(str(p/'tokenizer.json')); o.InferenceSession(str(p/'model.onnx'), providers=['CPUExecutionProvider']); print('Model load OK')" $biReadModel
if ($LASTEXITCODE -ne 0) { throw '模型加载失败，请保留报错，不要在 Zotero 中启用。' }
Write-Host "配置完成，请在 Zotero 中选择：$biReadConfig"
```

看到 **Model load OK** 和配置文件路径，说明模型与分词器可以加载。这个检查不等于每个词组都能准确匹配；还需要下面的实际选词验证。

如果无法访问 Hugging Face，下载步骤会报错。需要先解决网络访问问题再重试；只安装 XPI 不会自动补齐模型。不要把下载失败后的空文件当模型使用。

## 4. 在 Zotero 中启用

1. 安装 [BiRead 0.1.1-beta](https://github.com/WWeiyiWang/BiRead/releases/tag/v0.1.1-beta) 的 XPI，打开一篇可选择文本的 PDF，点击 **BILINGUAL**。
2. 点击 **显示设置**，找到 **本地对齐模型**。
3. 选择刚生成的 `local-model.json`。文件在你的用户文件夹 → `BiRead-local-model` 中。
4. 页面提示“已启用本地模型”后，在已有译文的段落中选中一个中文词，右键 → **高亮**，检查英文是否对应。再试一次从英文选词。首次处理一段时可能稍等几秒。
5. 关闭论文再打开，检查已保存的高亮与批注是否保留。

不用每次打开 PowerShell，也不用手动启动后台服务；插件会按需调用本地 Python。

## 对应不对怎么办？

点击已有高亮 → **绑定 / 重新关联词组** → 选中同一段另一侧的正确词组 → 使用选区 → **确认绑定**。也可输入本段中唯一出现的对应文字；重复词请用鼠标选择精确位置。旧标注也可以这样修正。批注输入后自动保存。

长段落超过模型长度限制、意译、省略或重复词，都可能导致无法匹配；插件会保留单侧标注，不代表标注丢失。

## 常见问题

- **提示配置路径无效：**不要只复制别人的 JSON。配置记录的是你这台电脑的绝对路径；移动文件夹或换电脑后需要重新生成配置并选择它。
- **提示模型进程退出 / DLL 加载失败：**确认使用 64 位 Python 3.12、依赖安装完整；保留报错并到 [Issues](https://github.com/WWeiyiWang/BiRead/issues) 反馈，不要上传私人论文或密钥。
- **模型加载成功但没有对应高亮：**先确认两侧文本已经翻译完成，换短一些的段落试试；启用提示只表示配置路径存在，不能保证词组匹配质量。
- **能否同步到另一台电脑？**模型配置需要分别设置；当前词组映射和本机译文标注不会通过 Zotero 同步。
- **是否完全离线？**词组对齐离线运行。Google 等正文翻译服务仍会把文本发送给所选服务。

以上步骤按当前插件的配置格式和已使用的模型、依赖版本整理；现有本地运行环境已实测，尚未在全新 Windows 系统上完整验证安装流程。
