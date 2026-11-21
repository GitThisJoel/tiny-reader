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
  /**
   * Firefox's PDF viewer. `name` is the file's name, from the tab's address or title. `url` is the
   * address when the PDF is on the web, where the add-on can download it; null for a local file.
   */
  | { kind: "pdf"; name: string; url: string | null }
  /** Another page the add-on is not allowed into. */
  | { kind: "blocked" };

/** Popup → background: "what is the active tab?" The reply is a PageState. */
export const PAGE_STATE = "page-state";

/**
 * The file name of the PDF a tab is showing in Firefox's viewer, or null when it does not look like one.
 *
 * The address tells when it ends in ".pdf". Many do not ("arxiv.org/pdf/1706.03762"), and the
 * add-on cannot look inside the viewer, but the viewer titles its tab with the file's name,
 * as "1706.03762v7.pdf" or "Attention Is All You Need - 1706.03762v7.pdf".
 */
export function pdfName(url: string, title = ""): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    if (/\.pdf$/i.test(last)) return last;
  } catch {
    // Not an address: the title may still tell.
  }
  const named = title.trim();
  return /\.pdf$/i.test(named) ? (named.split(" - ").pop() ?? named) : null;
}

/** `url` if it is an http(s) address, else null. Nothing else can be downloaded by the add-on. */
export function webUrl(url: string | null | undefined): string | null {
  try {
    return url && /^https?:$/.test(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

/** The host permission that covers `url`: its whole site. Match patterns carry no port. */
export function sitePattern(url: string): string {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

/** What the document page is asked to open: told to it in the fragment of its address. */
export interface DocumentRequest {
  /** The PDF's file name, to show and to ask for. */
  name: string | null;
  /** Where to download it from. Null: the user has to choose the file. */
  url: string | null;
}

export function documentFragment({ name, url }: DocumentRequest): string {
  const parameters = new URLSearchParams();
  if (name) parameters.set("name", name);
  if (url) parameters.set("url", url);
  return parameters.size ? `#${parameters}` : "";
}

/** Reads a fragment back. Anything but an http(s) address is dropped: this text comes from an address bar. */
export function parseDocumentFragment(hash: string): DocumentRequest {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  return { name: parameters.get("name") || null, url: webUrl(parameters.get("url")) };
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
