import { BUNDLED, type Model, readsOnly } from "@/engine/models.ts";

/** What i18n.detectLanguage resolves to. */
export interface Detection {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

/** Only this much text is examined; enough for a reliable answer, cheap on long pages. */
export const SAMPLE_LENGTH = 4000;

/**
 * A warning for text that is clearly not in the model's language, or null. A model and its text
 * front end know one language: another one in the same script is read with the wrong sounds,
 * which is wrong but not silent, so the user is told rather than stopped.
 */
export function languageWarning(detection: Detection, model: Model = BUNDLED): string | null {
  if (!detection.isReliable) return null;
  const [top] = detection.languages.toSorted((a, b) => b.percentage - a.percentage);
  // Compared by language alone: "pt" is what the detector says for a page a "pt-BR" model reads.
  const language = (tag: string) => tag.toLowerCase().split("-")[0];
  if (!top || top.language === "und" || language(top.language) === language(model.language)) return null;
  let name = top.language;
  try {
    name = new Intl.DisplayNames(["en"], { type: "language" }).of(top.language) ?? name;
  } catch {
    // Not a code Intl knows: show it as it is.
  }
  return `This looks like ${name}. ${readsOnly(model)}, so it will sound wrong.`;
}
