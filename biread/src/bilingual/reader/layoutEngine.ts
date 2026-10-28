import { getPref } from "../../utils/prefs";
import { cacheRoot } from "../cache/documentCache";
import type { LayoutRegion } from "../parser/modelLayout";

export async function analyzeWithLocalEngine(
  input: string,
  cancelled: () => boolean = () => false,
): Promise<LayoutRegion[][] | undefined> {
  const path = String(getPref("bilingual.layoutEngine.config") || "");
  if (!path) return;
  const config = (await IOUtils.readJSON(path)) as {
    python: string;
    model: string;
  };
  if (
    ![config.python, config.model].every(
      (v) => typeof v === "string" && PathUtils.isAbsolute(v),
    )
  )
    throw new Error("排版引擎配置无效");
  const worker = PathUtils.join(cacheRoot(), "layout-worker-v1.py");
  await IOUtils.makeDirectory(cacheRoot(), { ignoreExisting: true });
  await IOUtils.writeUTF8(
    worker,
    String(
      await Zotero.File.getContentsFromURLAsync(
        "chrome://biread/content/layout-worker.py",
      ),
    ),
  );
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as any;
  const process = await Subprocess.call({
    command: config.python,
    arguments: ["-I", worker],
    stderr: "pipe",
  });
  const timer = Zotero.getMainWindow().setTimeout(
    () => void process.kill(),
    10 * 60 * 1000,
  );
  const cancellation = Zotero.getMainWindow().setInterval(() => {
    if (cancelled()) void process.kill();
  }, 500);
  const read = async (pipe: any) => {
    let text = "";
    for (;;) {
      const chunk = await pipe.readString();
      if (!chunk) break;
      text += chunk;
      if (text.length > 20000000) {
        void process.kill();
        throw new Error("版面分析结果超出限制");
      }
    }
    return text;
  };
  try {
    const output = read(process.stdout),
      errors = read(process.stderr);
    await process.stdin.write(JSON.stringify({ input, model: config.model }));
    await process.stdin.close();
    const [text, , exit] = await Promise.all([output, errors, process.wait()]);
    if (cancelled()) throw new Error("Cancelled");
    if (exit.exitCode !== 0 || !text.trim())
      throw new Error("本地版面分析失败，请检查模型环境");
    const result = JSON.parse(text);
    if (
      exit.exitCode !== 0 ||
      result.error ||
      result.version !== 1 ||
      !Array.isArray(result.pages)
    )
      throw new Error("本地版面分析失败，请检查模型环境");
    return result.pages;
  } finally {
    Zotero.getMainWindow().clearTimeout(timer);
    Zotero.getMainWindow().clearInterval(cancellation);
    void process.kill();
  }
}
