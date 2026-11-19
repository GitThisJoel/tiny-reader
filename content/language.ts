/** What i18n.detectLanguage resolves to. */
export interface Detection {
	isReliable: boolean;
	languages: { language: string; percentage: number }[];
}

/** Only this much text is examined; enough for a reliable answer, cheap on long pages. */
export const SAMPLE_LENGTH = 4000;

/**
 * A warning for text that is clearly not English, or null. The model and its phonemizer are
 * English only: other languages in Latin script are read with English sounds, which is wrong
 * but not silent, so the user is told rather than stopped.
 */
export function languageWarning(detection: Detection): string | null {
	if (!detection.isReliable) return null;
	const [top] = detection.languages.toSorted(
		(a, b) => b.percentage - a.percentage,
	);
	if (
		!top ||
		top.language === "und" ||
		top.language.toLowerCase().startsWith("en")
	)
		return null;
	let name = top.language;
	try {
		name =
			new Intl.DisplayNames(["en"], { type: "language" }).of(top.language) ??
			name;
	} catch {
		// Not a code Intl knows: show it as it is.
	}
	return `This looks like ${name}. tiny-voca only reads English, so it will sound wrong.`;
}
