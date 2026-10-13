import { cacheRoot } from "../cache/documentCache";
import { setPref } from "../../utils/prefs";
import { runLocalModel } from "./localModel";
import { installAssets } from "./installAssets";

let installing: Promise<void> | undefined;

async function sha256(path: string) {
  const input = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
    Ci.nsIFileInputStream,
  );
  input.init(Zotero.File.pathToFile(path), 0x01, 0, 0);
  try {
    const hash = Cc["@mozilla.org/security/hash;1"].createInstance(
      Ci.nsICryptoHash,
    );
    hash.init(Ci.nsICryptoHash.SHA256!);
    hash.updateFromStream(input, 0xffffffff);
    return Array.from(hash.finish(false), (c) =>
      c.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
  } finally {
    input.close();
  }
}

async function unpack(path: string, destination: string) {
  const zip = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
    Ci.nsIZipReader,
  );
  zip.open(Zotero.File.pathToFile(path));
  try {
    const entries = zip.findEntries(null as any);
    let total = 0;
    while (entries.hasMore()) {
      const name = entries.getNext();
      const parts = name.replace(/\/$/, "").split("/");
      if (parts.some((p) => !p || p === "." || p === ".." || /[\\:]/.test(p)))
        throw new Error("压缩包路径无效");
      const entry = zip.getEntry(name);
      total += entry.realSize;
      if (total > 700 * 1024 * 1024) throw new Error("压缩包内容无效");
      const output = PathUtils.join(destination, ...parts);
      if (entry.isDirectory)
        await IOUtils.makeDirectory(output, { ignoreExisting: true });
      else {
        await IOUtils.makeDirectory(PathUtils.parent(output)!, {
          ignoreExisting: true,
        });
        await IOUtils.remove(output, { ignoreAbsent: true });
        zip.extract(name, Zotero.File.pathToFile(output));
      }
    }
  } finally {
    zip.close();
  }
}

// Shared across readers: never run competing installers or activate a partial install.
export function installLocalModel(
  status: (text: string) => void,
): Promise<void> {
  if (installing) {
    status("本地模型正在其他阅读窗口安装，请等待完成。");
    return installing;
  }
  installing = install(status).finally(() => {
    installing = undefined;
  });
  return installing;
}

async function install(status: (text: string) => void) {
  if (
    Services.appinfo.OS !== "WINNT" ||
    !Services.appinfo.XPCOMABI.startsWith("x86_64")
  )
    throw new Error(
      "一键安装目前支持 Windows 64 位（x64）；其他系统可使用手动配置。",
    );
  const root = PathUtils.join(cacheRoot(), "alignment-win-x64-v1");
  const downloads = PathUtils.join(root, "downloads");
  const configPath = PathUtils.join(root, "local-model.json");
  const configuration = {
    python: PathUtils.join(root, "python", "python.exe"),
    deps: PathUtils.join(root, "deps"),
    model: PathUtils.join(root, "model"),
  };
  const verify = async () => {
    const result = await runLocalModel(
      configuration,
      configPath,
      "The mushrooms grow in soil.",
      "蘑菇生长在土壤中。",
    );
    if (!result.links.length) throw new Error("模型运行未返回词组关系");
  };
  if (await IOUtils.exists(configPath)) {
    status("检查已安装的本地模型…");
    try {
      await verify();
      setPref("bilingual.localModel.config", configPath);
      status("本地模型已启用，无需重复下载。");
      return;
    } catch {
      /* Repair a failed installation using verified cached downloads. */
    }
  }
  await IOUtils.makeDirectory(downloads, { ignoreExisting: true });
  const { Downloads } = ChromeUtils.importESModule(
    "resource://gre/modules/Downloads.sys.mjs",
  ) as any;
  for (const [index, asset] of installAssets.entries()) {
    const path = PathUtils.join(downloads, `${index}.download`);
    status(`准备 ${index + 1}/${installAssets.length}：${asset.name}`);
    let valid =
      (await IOUtils.exists(path)) &&
      (await IOUtils.stat(path)).size === asset.bytes &&
      (await sha256(path)) === asset.sha256;
    if (!valid) {
      const part = path + ".part";
      const download = await Downloads.createDownload({
        source: asset.url,
        target: part,
      });
      download.onchange = () =>
        status(
          `下载 ${index + 1}/${installAssets.length}：${asset.name} · ${Math.min(100, Math.round((download.currentBytes / asset.bytes) * 100))}%`,
        );
      const timeout = Zotero.getMainWindow().setTimeout(
        () => void download.cancel(),
        10 * 60 * 1000,
      );
      try {
        await download.start();
        valid =
          (await IOUtils.stat(part)).size === asset.bytes &&
          (await sha256(part)) === asset.sha256;
        if (!valid) throw new Error(`${asset.name} 校验失败，请重试`);
        await IOUtils.move(part, path, { noOverwrite: false });
      } finally {
        Zotero.getMainWindow().clearTimeout(timeout);
        download.onchange = null;
        await download.finalize(true);
      }
    }
    status(`安装 ${index + 1}/${installAssets.length}：${asset.name}`);
    const target = PathUtils.join(root, ...asset.target.split("/"));
    if (asset.archive) await unpack(path, target);
    else {
      await IOUtils.makeDirectory(PathUtils.parent(target)!, {
        ignoreExisting: true,
      });
      await IOUtils.copy(path, target, { noOverwrite: false });
    }
  }
  await IOUtils.writeJSON(configPath, configuration, {
    tmpPath: configPath + ".tmp",
  });
  status("验证本地模型运行…");
  await verify();
  setPref("bilingual.localModel.config", configPath);
  status("本地模型安装完成并已启用。现在可选词高亮；错配时可手动重新关联。");
}
