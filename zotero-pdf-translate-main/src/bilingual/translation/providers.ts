import { requestDeadline } from "./requestDeadline";
import { getPref } from "../../utils/prefs";
import { TranslateTaskRunner, type TranslateTask } from "../../utils/task";
import type { Block, TranslationContext } from "../types";
import { academicPrompt } from "./academicPrompt";
import { relevantGlossary } from "../glossary/documentGlossary";

import { protectText, glossaryParts } from "./textProtection";
const prefixes: Record<string, string> = {
  chatgpt: "chatGPT",
  customgpt1: "customGPT1",
  customgpt2: "customGPT2",
  customgpt3: "customGPT3",
  azuregpt: "azureGPT",
  gemini: "gemini",
  claude: "claude",
};
export const supportsAcademic = (provider: string) => !!prefixes[provider];
export function effectiveContext(
  context: TranslationContext,
): TranslationContext {
  return supportsAcademic(context.provider)
    ? context
    : { ...context, mode: "standard" };
}
// Do not display raw provider errors: URLs and response bodies can contain credentials.
export function providerFailure(detail: string, provider: string) {
  let reason = "服务未返回译文，请检查网络、服务地址和密钥配置";
  if (/\b(?:401|403)\b|unauthori[sz]ed|invalid.*(?:key|token)/i.test(detail))
    reason = "认证失败或无权限，请检查密钥和模型权限";
  else if (/\b429\b|rate.?limit|quota|credit|balance/i.test(detail))
    reason = "请求限流或额度不足，请稍后重试或检查余额";
  else if (/\b404\b|model.*not.*found/i.test(detail))
    reason = "接口或模型不存在，请检查服务地址与模型名称";
  else if (/timeout|timed out/i.test(detail))
    reason = "请求超时，请检查网络或更换服务";
  else if (/network|NS_ERROR|connection|offline/i.test(detail))
    reason = "网络连接失败，请检查 Zotero 的网络或代理设置";
  else if (/\b50[0234]\b/i.test(detail))
    reason = "翻译服务器暂时不可用，请稍后重试";
  return new Error(provider + "：" + reason + "。已完成的译文会保留。");
}
export function translationContext(
  glossary: Record<string, string>,
  mode: TranslationContext["mode"],
): TranslationContext {
  const provider = String(getPref("translateSource") || "google");
  const prefix = prefixes[provider] || provider;
  return {
    provider,
    model: String(getPref(`${prefix}.model`) || ""),
    endpoint: String(getPref(`${prefix}.endPoint`) || ""),
    mode,
    glossary,
  };
}
export async function translateBlock(
  block: Block,
  context: TranslationContext,
  itemId: number,
  cancelled: () => boolean = () => false,
) {
  const service = addon.data.translate.services.getServiceById(
    context.provider,
  );
  if (!service || service.type !== "sentence" || context.provider === "pot")
    throw new Error(
      "Choose an in-app sentence translation provider in Translate settings.",
    );
  const runner = new TranslateTaskRunner(service.translate);
  const run = async (raw: string, instruction?: string) => {
    if (cancelled()) throw new Error("Paused");
    const task: TranslateTask = {
      id: `bilingual-${block.id}`,
      type: "custom",
      raw,
      result: "",
      audio: [],
      service: context.provider,
      candidateServices: [],
      itemId,
      langfrom: "en",
      langto: "zh-CN",
      status: "waiting",
      extraTasks: [],
      silent: true,
      bilingualInstruction: instruction,
    };
    const sameContext = () => {
      const now = translationContext(context.glossary, context.mode);
      return (
        now.provider === context.provider &&
        now.model === context.model &&
        now.endpoint === context.endpoint
      );
    };
    if (!sameContext())
      throw new Error("Provider settings changed. Use Retry / Resume.");
    await requestDeadline(runner.run(task), () =>
      providerFailure("timeout", context.provider),
    );
    if (!sameContext())
      throw new Error(
        "Provider settings changed during translation. Use Retry / Resume.",
      );
    if (task.status !== "success" || !task.result.trim())
      throw providerFailure(task.result, context.provider);
    return task.result;
  };
  const protectedSegments = new Map(
    block.segments.map((s) => [s.id, protectText(s.source)]),
  );
  if (prefixes[context.provider]) {
    const instruction = academicPrompt({
      ...context,
      glossary: relevantGlossary(block.source, context.glossary),
    });
    const raw = await run(
      JSON.stringify(
        block.segments.map((s) => ({
          id: s.id,
          text: protectedSegments.get(s.id)!.text,
        })),
      ),
      instruction,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        raw
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      );
    } catch {
      throw new Error(
        "大模型没有返回可用的译文格式，请重试或更换支持指令的大模型服务。",
      );
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (entry) =>
          !entry ||
          typeof entry.id !== "string" ||
          typeof entry.translation !== "string",
      )
    )
      throw new Error(
        "Provider did not return ID-preserving translation JSON. Retry or choose another LLM provider.",
      );
    return (parsed as { id: string; translation: string }[]).map((entry) => {
      const protectedText = protectedSegments.get(entry.id);
      if (!protectedText)
        throw new Error("Provider returned an unknown segment ID.");
      return {
        id: entry.id,
        translation: protectedText.restore(entry.translation),
      };
    });
  }
  // MT cannot follow JSON instructions. Keep protected spans locally instead
  // of asking an ordinary translator to preserve artificial tokens.
  const result = [];
  for (const segment of block.segments) {
    let translation = "";
    for (const part of protectedSegments
      .get(segment.id)!
      .parts.flatMap((part) =>
        part.protected ? [part] : glossaryParts(part.text, context.glossary),
      )) {
      if (part.protected || !/[a-zA-Z]/.test(part.text))
        translation += part.text;
      else {
        const leading = part.text.match(/^\s*/)?.[0] || "";
        const trailing = part.text.match(/\s*$/)?.[0] || "";
        translation +=
          leading + (await run(part.text.trim())).trim() + trailing;
      }
    }
    result.push({ id: segment.id, translation });
  }
  return result;
}
