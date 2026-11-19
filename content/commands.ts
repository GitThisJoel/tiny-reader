/**
 * What the background can tell the reader in the active tab to do. Keyboard shortcuts use these
 * names in the manifest; the toolbar popup sends them in a CommandMessage.
 * "read" reads the selection, or the page's main text when nothing is selected.
 */
export const COMMANDS = ["read", "read-selection", "toggle", "stop", "next", "previous"] as const;
export type Command = (typeof COMMANDS)[number];

export const isCommand = (value: unknown): value is Command => (COMMANDS as readonly unknown[]).includes(value);

/** Said where a reading cannot start because the add-on is not allowed into the page. */
export const BLOCKED =
  "Tiny Reader cannot read here. Firefox keeps add-ons out of Reader View, its PDF viewer, its own pages, addons.mozilla.org and frames from another site. For a PDF, use Read a PDF in the toolbar popup.";

/** Said in the popup on a PDF shown by Firefox's own viewer. */
export const PDF_BLOCKED =
  "This is a PDF. Firefox does not let add-ons read inside its PDF viewer, so Tiny Reader reads PDFs on a page of its own.";

/** What the popup needs to know about the tab it was opened on. */
export type PageState =
  | { kind: "readable" }
  /** Firefox's PDF viewer. `name` is the file's name, taken from the address. */
  | { kind: "pdf"; name: string }
  /** Another page the add-on is not allowed into. */
  | { kind: "blocked" };

/** Popup → background: "what is the active tab?" The reply is a PageState. */
export const PAGE_STATE = "page-state";

/** The file name of a PDF address, such as "report.pdf", or null when the address does not end in one. */
export function pdfName(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return /\.pdf$/i.test(last) ? last : null;
  } catch {
    return null;
  }
}

/** Popup → background. The reply is false when a reading could not be started. */
export interface CommandMessage {
  type: "command";
  name: Command;
}

export const isCommandMessage = (value: unknown): value is CommandMessage =>
  typeof value === "object" &&
  value !== null &&
  (value as CommandMessage).type === "command" &&
  isCommand((value as CommandMessage).name);
