import { getPref } from "../../utils/prefs";
import { cacheRoot } from "../cache/documentCache";

type Span = [number, number];
type Reply = { version: number; links: [Span, Span][]; error?: string };
const cached = new Map<string, Reply>();

export function localModelConfigured() {
  return !!getPref("bilingual.localModel.config");
}

export async function localModelRange(
  source: string,
  translation: string,
  side: "source" | "translation",
  start: number,
  end: number,
): Promise<Span | undefined> {
  const configPath = String(getPref("bilingual.localModel.config") || "");
  if (!configPath) return;
  const configuration = (await IOUtils.readJSON(configPath)) as {
    python: string;
    model: string;
    deps: string;
  };
  if (
    ![configuration.python, configuration.model, configuration.deps].every(
      (v) => typeof v === "string" && PathUtils.isAbsolute(v),
    )
  )
    throw new Error("本地模型配置无效，请重新选择配置文件。");
  const key = JSON.stringify([configPath, source, translation]);
  let reply = cached.get(key);
  if (!reply) {
    await IOUtils.makeDirectory(cacheRoot(), { ignoreExisting: true });
    const worker = PathUtils.join(cacheRoot(), "alignment-worker-v1.py");
    const script = await Zotero.File.getContentsFromURLAsync(
      "chrome://biread/content/alignment-worker.py",
    );
    await IOUtils.writeUTF8(worker, String(script));
    const { Subprocess } = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as any;
    const process = await Subprocess.call({
      command: configuration.python,
      arguments: ["-I", worker, configPath],
      stderr: "pipe",
    });
    const timer = Zotero.getMainWindow().setTimeout(
      () => void process.kill(),
      20000,
    );
    try {
      const read = async (pipe: any) => {
        let text = "";
        for (;;) {
          const chunk = await pipe.readString();
          if (!chunk) break;
          text += chunk;
          if (text.length > 262144) throw new Error("模型输出过长");
        }
        return text;
      };
      const output = read(process.stdout);
      const errors = read(process.stderr);
      await process.stdin.write(JSON.stringify({ source, translation }));
      await process.stdin.close();
      const [text, , exit] = await Promise.all([
        output,
        errors,
        process.wait(),
      ]);
      reply = JSON.parse(text) as Reply;
      if (exit.exitCode !== 0 || reply.error)
        throw new Error(reply.error || "模型进程退出");
      if (reply.version !== 1 || !Array.isArray(reply.links))
        throw new Error("模型输出格式不正确");
      if (cached.size >= 40) cached.delete(cached.keys().next().value!);
      cached.set(key, reply);
    } finally {
      Zotero.getMainWindow().clearTimeout(timer);
      void process.kill();
    }
  }
  const texts = [source, translation];
  const origin = side === "source" ? 0 : 1;
  const destination = 1 - origin;
  const Segmenter = (Zotero.getMainWindow().Intl as any).Segmenter;
  if (!Segmenter) throw new Error("当前 Zotero 缺少词语分段支持。");
  const words = Array.from(
    new Segmenter(destination ? "zh" : "en", { granularity: "word" }).segment(
      texts[destination],
    ),
  ) as { index: number; segment: string; isWordLike: boolean }[];
  const spans: Span[] = [];
  for (const link of reply.links) {
    if (
      !link.every(
        (s, i) =>
          Array.isArray(s) &&
          s.length === 2 &&
          s.every(Number.isInteger) &&
          s[0] >= 0 &&
          s[1] > s[0] &&
          s[1] <= texts[i].length,
      )
    )
      continue;
    const from = link[origin],
      to = link[destination];
    if (from[0] >= end || from[1] <= start) continue;
    const expanded = words.filter(
      (w) =>
        w.isWordLike && w.index < to[1] && w.index + w.segment.length > to[0],
    );
    spans.push(
      ...expanded.map((w) => [w.index, w.index + w.segment.length] as Span),
    );
  }
  if (!spans.length) return;
  const result: Span = [
    Math.min(...spans.map((s) => s[0])),
    Math.max(...spans.map((s) => s[1])),
  ];
  // Do not bridge unrelated clauses into a sentence-sized highlight.
  if (/[;；。!?！？]/u.test(texts[destination].slice(...result))) return;
  return result;
}
