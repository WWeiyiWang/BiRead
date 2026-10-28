# AI reading guide — 0.1.28-beta.3

Entry: 论文导读 → 生成 AI 导读. Opening the panel sends nothing. Generation sends parsed paragraphs to the configured instruction-aware model. Google/Bing display a configuration message. Desktop only; no mobile or release publishing work in this change.

Features: question/method/findings bullets, quantitative results with conditions, multiple exact source quotes per claim with paragraph/page navigation, complete figure region images and translated captions, explicit separation of paper limitations and AI interpretation/questions. Additional bullets are expandable. Unparsed original-only pages are disclosed. Current-session results survive reopening the panel but are cleared when document blocks are replaced.

Evidence IDs and whitespace-normalized quotations must match their input batch. Unsupported numeric tokens and results missing conditions are rejected. This is not semantic entailment verification or comprehensive unit validation: the interface tells readers to check meaning, units and scope against quotations. Long documents are processed in bounded batches without silently truncating prose. Cancellation prevents subsequent requests and discards late results; an already transmitted request cannot be retracted. Changed model settings or documents invalidate running output. No model HTML or URLs are rendered.

Design references (no code or prompt copied, no skills installed):

- https://github.com/ai-azhou/pdf-to-interactive-web
- https://github.com/HKUSTDial/Supervisor-Skills/blob/main/skills/paper-writer/SKILL.md
  The second reference was found through search; the screenshot's JoeyWu-tech URL was unavailable. Its CC-BY-NC-SA-4.0 content was studied only for general evidence discipline.

Validation: 176 regression tests plus 2 mock-provider tests pass; TypeScript and packaging pass. Local browser tests cover explicit generation, multiple evidence jumps, complete-region image selection and translated captions. No real external model request or live Zotero installation was performed: cross-paper summary quality still needs real-model evaluation. Local test package: build/BiRead-0.1.28-beta.3.xpi.
