/**
 * What the background can tell the reader in the active tab to do. Keyboard shortcuts use these
 * names in the manifest; the toolbar popup sends them in a CommandMessage.
 * "read" reads the selection, or the page's main text when nothing is selected.
 */
export const COMMANDS = ["read", "read-selection", "toggle", "stop", "next", "previous"] as const;
export type Command = (typeof COMMANDS)[number];

export const isCommand = (value: unknown): value is Command => (COMMANDS as readonly unknown[]).includes(value);

/** Popup → background. */
export interface CommandMessage {
  type: "command";
  name: Command;
}

export const isCommandMessage = (value: unknown): value is CommandMessage =>
  typeof value === "object" &&
  value !== null &&
  (value as CommandMessage).type === "command" &&
  isCommand((value as CommandMessage).name);
