import { type SynthOptions, VOICES } from "@/engine/protocol.ts";
import css from "./bar.css?inline";
import { iconButton as button, icon } from "./icons.ts";
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

export interface Position {
  left: number;
  top: number;
}

/** `position` moved as little as needed for a box of `size` to lie inside `viewport`. */
export function clampPosition(
  position: Position,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Position {
  // Whole pixels, and never past the far edge by a fraction of one.
  const within = (value: number, room: number) => Math.max(0, Math.min(Math.round(value), Math.floor(room)));
  return {
    left: within(position.left, viewport.width - size.width),
    top: within(position.top, viewport.height - size.height),
  };
}

/** Pixels per arrow-key press when moving the bar from the keyboard. */
const KEY_STEP = 16;
const ARROWS: Record<string, [x: number, y: number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

// Where the user last put the bar on this page. The next reading opens it there.
// ponytail: kept per page, in memory. Store it with the settings if it should follow you across pages.
let moved: Position | null = null;

export function statusText(state: ReaderState): string {
  const place = `Sentence ${Math.min(state.index + 1, state.total)} of ${state.total}`;
  switch (state.status) {
    case "loading":
      return "Loading…";
    // Paused shows the same place: the play button already says that it is paused.
    case "playing":
    case "paused":
      return place;
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
  const grip = button("grip", "Move the bar: drag it, or use the arrow keys", () => {});
  grip.className = "grip";
  const toggle = button("pause", "Pause", handlers.toggle);
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  toolbar.append(
    grip,
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

  /** Puts the bar's top-left corner at `position`, kept inside the window. */
  function place(position: Position) {
    const { width, height } = host.getBoundingClientRect();
    // clientWidth and clientHeight leave out the page's scrollbars, which the bar should not sit under.
    const { clientWidth, clientHeight } = document.documentElement;
    moved = clampPosition(position, { width, height }, { width: clientWidth, height: clientHeight });
    // Set through the style object, which a page CSP does not govern. Overrides the default bottom-centre place.
    host.style.left = `${moved.left}px`;
    host.style.top = `${moved.top}px`;
    host.style.bottom = "auto";
    host.style.transform = "none";
  }
  // Drag from the grip or from any part of the bar that is not a control.
  toolbar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest("button:not(.grip), select")) return;
    const start = host.getBoundingClientRect();
    const [offsetX, offsetY] = [event.clientX - start.left, event.clientY - start.top];
    const drag = (move: PointerEvent) => place({ left: move.clientX - offsetX, top: move.clientY - offsetY });
    const drop = () => {
      toolbar.removeEventListener("pointermove", drag);
      toolbar.removeEventListener("pointerup", drop);
      toolbar.removeEventListener("pointercancel", drop);
      delete toolbar.dataset.dragging;
    };
    toolbar.setPointerCapture(event.pointerId);
    toolbar.dataset.dragging = "";
    toolbar.addEventListener("pointermove", drag);
    toolbar.addEventListener("pointerup", drop);
    toolbar.addEventListener("pointercancel", drop);
    event.preventDefault(); // no text selection while dragging
  });
  grip.addEventListener("keydown", (event) => {
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault(); // the page must not scroll
    const { left, top } = host.getBoundingClientRect();
    place({ left: left + step[0] * KEY_STEP, top: top + step[1] * KEY_STEP });
  });
  // A smaller window must not leave the bar outside it.
  const keepInside = () => moved && place(moved);
  addEventListener("resize", keepInside);
  if (moved) place(moved);

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
      removeEventListener("resize", keepInside);
      host.remove();
    },
  };
}
