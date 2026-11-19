// The glyphs shared by the control bar and the toolbar popup, drawn on a 24 × 24 grid.
export const ICONS = {
  play: "M7 4v16l13-8z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  toggle: "M3 5v14l9-7zM14 5h3v14h-3zM19 5h3v14h-3z",
  previous: "M6 5h2v14H6zM20 5v14l-11-7z",
  next: "M16 5h2v14h-2zM4 5v14l11-7z",
  stop: "M6 6l12 12M18 6L6 18",
  grip: "M8 5h2v2H8zM14 5h2v2h-2zM8 11h2v2H8zM14 11h2v2h-2zM8 17h2v2H8zM14 17h2v2h-2z",
};

const SVG = "http://www.w3.org/2000/svg";

export function icon(name: keyof typeof ICONS) {
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

/** A button that shows only an icon; `label` is its accessible name and tooltip. */
export function iconButton(name: keyof typeof ICONS, label: string, onClick: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.title = label;
  element.append(icon(name));
  element.addEventListener("click", onClick);
  return element;
}
