import { TranslatorPanel } from "../elements/panel";
import { MathTextboxElement } from "../elements/mathTextbox";
import { config } from "../../package.json";

const elements = {
  [`${config.addonRef}-translator-panel`]: TranslatorPanel,
  [`${config.addonRef}-math-textbox`]: MathTextboxElement,
} as unknown as Record<string, CustomElementConstructor>;

for (const [key, constructor] of Object.entries(elements)) {
  if (!customElements.get(key)) {
    customElements.define(key, constructor);
  }
}
