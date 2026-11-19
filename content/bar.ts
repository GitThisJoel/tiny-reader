import { type SynthOptions, VOICES } from "@/engine/protocol.ts";
import css from "./bar.css?inline";
import type { ReaderState } from "./reader.ts";

export interface BarHandlers {
  toggle(): void;
  previous(): void;
  next(): void;
  stop(): void;
  setOptions(change: Partial<SynthOptions>): void;
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** The speeds on offer, with the one in use added when it is not a preset (set on the options page). */
export const speedChoices = (current: number): number[] =>
  SPEEDS.includes(current) ? SPEEDS : [...SPEEDS, current].sort((a, b) => a - b);

const ICONS = {
  play: "M7 4v16l13-8z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  previous: "M6 5h2v14H6zM20 5v14l-11-7z",
  next: "M16 5h2v14h-2zM4 5v14l11-7z",
  stop: "M6 6l12 12M18 6L6 18",
};

const SVG = "http://www.w3.org/2000/svg";

function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ICONS[name]);
  if (name === "stop") {
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
  }
  svg.append(path);
  return svg;
}

function button(name: keyof typeof ICONS, label: string, onClick: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.title = label;
  element.append(icon(name));
  element.addEventListener("click", onClick);
  return element;
}

function select(
  label: string,
  choices: [value: number, text: string][],
  selected: number,
  onChange: (value: number) => void,
) {
  const element = document.createElement("select");
  element.setAttribute("aria-label", label);
  element.title = label;
  for (const [value, text] of choices) element.add(new Option(text, String(value), false, value === selected));
  element.addEventListener("change", () => onChange(Number(element.value)));
  return element;
}

export function statusText(state: ReaderState): string {
  const place = `Sentence ${Math.min(state.index + 1, state.total)} of ${state.total}`;
  switch (state.status) {
    case "loading":
      return "Loading…";
    case "playing":
      return place;
    case "paused":
      return `Paused. ${place}`;
    case "blocked":
      return "Press play to start";
    case "done":
      return "Finished";
    case "error":
      return state.message ?? "Something went wrong";
  }
}

/**
 * The control bar. It lives in a closed shadow root on one host element appended to the
 * page's root: the only change the add-on makes to the page's DOM.
 */
export function createBar(handlers: BarHandlers, options: SynthOptions) {
  const host = document.createElement("tiny-reader-bar");
  const shadow = host.attachShadow({ mode: "closed" });
  // A constructed sheet is not an inline <style>, so a page CSP cannot block it.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];

  const toolbar = document.createElement("div");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Tiny Reader");
  const toggle = button("pause", "Pause", handlers.toggle);
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  toolbar.append(
    button("previous", "Previous sentence", handlers.previous),
    toggle,
    button("next", "Next sentence", handlers.next),
    status,
    select(
      "Speed",
      speedChoices(options.speed).map((speed) => [speed, `${speed}×`]),
      options.speed,
      (speed) => handlers.setOptions({ speed }),
    ),
    select(
      "Voice",
      VOICES.map((name, index) => [index, name]),
      options.voice,
      (voice) => handlers.setOptions({ voice }),
    ),
    button("stop", "Stop reading", handlers.stop),
  );
  toolbar.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    handlers.stop();
  });
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  shadow.append(notice, toolbar);
  document.documentElement.append(host);

  let showsPlay = false;
  return {
    update(state: ReaderState) {
      toolbar.dataset.status = state.status;
      const text = statusText(state);
      if (status.textContent !== text) status.textContent = text;
      const wantsPlay = state.status === "paused" || state.status === "blocked";
      if (wantsPlay !== showsPlay) {
        showsPlay = wantsPlay;
        const label = wantsPlay ? "Play" : "Pause";
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
        toggle.replaceChildren(icon(wantsPlay ? "play" : "pause"));
      }
    },
    /** A warning shown above the controls until the bar goes away. */
    notify(message: string) {
      notice.textContent = message;
      notice.hidden = false;
    },
    focus() {
      toggle.focus();
    },
    remove() {
      host.remove();
    },
  };
}
