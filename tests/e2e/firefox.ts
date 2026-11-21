// Drives a real headless Firefox over the Marionette protocol, with the built add-on
// installed. No test-only code ships in the add-on: tests act on pages the way a user would
// (clicks are real input events, so they count as user activation).
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const ADDON_ID = "tiny-reader@tiny-reader.invalid";
/** Fixed for the test profile, so the add-on's pages have a known address. */
const UUID = "5b1f6e0c-6a0e-4b7c-9d7e-0f3f5a1b2c3d";
export const ADDON_URL = `moz-extension://${UUID}`;

// Snap Firefox cannot use a profile outside its sandbox; the real binary inside the snap can.
const BINARIES = [
  process.env.FIREFOX,
  "/snap/firefox/current/usr/lib/firefox/firefox",
  "/usr/lib/firefox/firefox",
  "/usr/bin/firefox",
  "/Applications/Firefox.app/Contents/MacOS/firefox",
];

/** Marionette runs the script as a plain function body; this lets it use `await`. */
const ASYNC = (body: string) => `return (async function () { ${body} }).apply(null, arguments);`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Firefox {
  private socket!: Socket;
  private process!: ChildProcess;
  private profile = "";
  private nextId = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private current = "";

  static async launch(): Promise<Firefox> {
    const firefox = new Firefox();
    await firefox.start();
    return firefox;
  }

  private async start() {
    const binary = BINARIES.find((path) => path && existsSync(path));
    if (!binary) throw new Error("Firefox not found. Set FIREFOX to the binary.");
    const build = join(ROOT, ".output/firefox-mv3");
    if (!existsSync(join(build, "manifest.json"))) throw new Error("No build found. Run `pnpm build` first.");
    this.profile = await mkdtemp(join(tmpdir(), "tiny-reader-e2e-"));
    const prefs: Record<string, unknown> = {
      "extensions.webextensions.uuids": JSON.stringify({ [ADDON_ID]: UUID }),
      "marionette.port": 0, // any free port; Firefox writes it to MarionetteActivePort
      "browser.shell.checkDefaultBrowser": false,
      "datareporting.policy.dataSubmissionEnabled": false,
      "media.autoplay.default": 5, // Firefox's default: block audible autoplay
      "media.volume_scale": "0.0", // silent: audio still plays through Web Audio, at zero volume
    };
    await writeFile(
      join(this.profile, "user.js"),
      Object.entries(prefs)
        .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
        .join(""),
    );
    let log = "";
    this.process = spawn(
      binary,
      ["--headless", "--no-remote", "--profile", this.profile, "--marionette", "-remote-allow-system-access"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    this.process.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    let port = 0;
    for (let tries = 0; tries < 300 && !port; tries++) {
      await sleep(100);
      if (this.process.exitCode !== null) throw new Error(`Firefox exited:\n${log}`);
      port = Number(await readFile(join(this.profile, "MarionetteActivePort"), "utf8").catch(() => 0));
    }
    if (!port) throw new Error(`Firefox did not start Marionette:\n${log}`);

    this.socket = connect(port, "127.0.0.1");
    const hello = new Promise<void>((resolve) => {
      this.socket.on("data", (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        // Frames are "<byte length>:<json>".
        for (;;) {
          const colon = this.buffer.indexOf(":");
          if (colon < 0) return;
          const length = Number(this.buffer.subarray(0, colon).toString());
          if (this.buffer.length < colon + 1 + length) return;
          const message = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString());
          this.buffer = this.buffer.subarray(colon + 1 + length);
          if (!Array.isArray(message)) {
            resolve(); // the server's greeting
            continue;
          }
          const [, id, error, result] = message;
          const waiting = this.pending.get(id);
          this.pending.delete(id);
          if (error) waiting?.reject(new Error(`${error.error}: ${error.message}`));
          else waiting?.resolve(result);
        }
      });
    });
    await hello;
    await this.send("WebDriver:NewSession", {});
    await this.send("Addon:Install", { path: build, temporary: true });
  }

  send<T = Record<string, unknown>>(command: string, params: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      const body = JSON.stringify([0, id, command, params]);
      this.socket.write(`${Buffer.byteLength(body)}:${body}`);
    });
  }

  private async focus(tab: string) {
    if (this.current === tab) return;
    await this.send("WebDriver:SwitchToWindow", { handle: tab });
    this.current = tab;
  }

  /** The handles of all open tabs. */
  async tabs(): Promise<string[]> {
    return this.send<string[]>("WebDriver:GetWindowHandles", {});
  }

  /** Opens a tab and waits for the page to load. Returns the tab's handle. */
  async open(url: string): Promise<string> {
    const { handle } = await this.send<{ handle: string }>("WebDriver:NewWindow", { type: "tab" });
    await this.focus(handle);
    await this.send("WebDriver:Navigate", { url });
    return handle;
  }

  /**
   * Runs a function body in the page (promises are awaited) and returns its result.
   * `privileged` runs it with browser privileges, which can see into closed shadow roots
   * (`element.openOrClosedShadowRoot`).
   */
  async evaluate<T>(tab: string, body: string, args: unknown[] = [], privileged = false): Promise<T> {
    await this.focus(tab);
    const { value } = await this.send<{ value: T }>("WebDriver:ExecuteScript", {
      script: ASYNC(body),
      args,
      ...(privileged ? { sandbox: "system" } : {}),
    });
    return value;
  }

  /**
   * Like evaluate, but without bringing the tab to the front: whichever tab was showing stays
   * the active one. For a page that acts on "the active tab", such as the toolbar popup.
   */
  async evaluateBehind<T>(tab: string, body: string, args: unknown[] = []): Promise<T> {
    await this.send("WebDriver:SwitchToWindow", { handle: tab, focus: false });
    this.current = tab;
    const { value } = await this.send<{ value: T }>("WebDriver:ExecuteScript", { script: ASYNC(body), args });
    return value;
  }

  /** Runs a function body in the browser's own (privileged) context. */
  async chrome<T>(body: string, args: unknown[] = []): Promise<T> {
    await this.send("Marionette:SetContext", { value: "chrome" });
    try {
      const { value } = await this.send<{ value: T }>("WebDriver:ExecuteScript", { script: ASYNC(body), args });
      return value;
    } finally {
      await this.send("Marionette:SetContext", { value: "content" });
    }
  }

  /** Marionette's id for the first element matching `selector`. */
  private async elementId(tab: string, selector: string): Promise<string> {
    const element = await this.evaluate<Record<string, string>>(tab, "return document.querySelector(arguments[0]);", [
      selector,
    ]);
    const id = Object.values(element ?? {})[0];
    if (!id) throw new Error(`no element matches ${selector}`);
    return id;
  }

  /** A real click on the first element matching `selector`. */
  async click(tab: string, selector: string) {
    const id = await this.elementId(tab, selector);
    await this.send("WebDriver:ElementClick", { id });
  }

  /**
   * Triggers the add-on command bound to a shortcut such as "Alt+Shift+R", the way Firefox
   * does when the keys are pressed (including the activeTab grant). Fails when no add-on
   * command is registered for those keys. Synthesized key presses do not reach the browser's
   * shortcut handling in headless mode, so the keys themselves are not typed.
   */
  async shortcut(tab: string, keys: string) {
    await this.focus(tab);
    const parts = keys.toLowerCase().split("+");
    const fired = await this.chrome<boolean>(
      `const [modifiers, letter] = arguments;
       const key = [...document.querySelectorAll("keyset[id^='ext-keyset-id'] key")].find(
         (element) => element.getAttribute("modifiers") === modifiers && element.getAttribute("key")?.toLowerCase() === letter);
       key?.dispatchEvent(new CustomEvent("command", { bubbles: true }));
       return Boolean(key);`,
      [parts.slice(0, -1).join(","), parts.at(-1)],
    );
    if (!fired) throw new Error(`no add-on command is registered for ${keys}`);
  }

  async reload(tab: string) {
    await this.focus(tab);
    await this.send("WebDriver:Refresh", {});
  }

  /** Chooses a file in an <input type="file">, as the file picker would. */
  async upload(tab: string, selector: string, path: string) {
    const id = await this.elementId(tab, selector);
    await this.send("WebDriver:ElementSendKeys", { id, text: path });
  }

  /** Presses the left button at one viewport point, moves to another and releases. */
  async drag(tab: string, from: [x: number, y: number], to: [x: number, y: number]) {
    await this.focus(tab);
    const point = ([x, y]: [number, number]) => ({
      type: "pointerMove",
      origin: "viewport",
      x: Math.round(x),
      y: Math.round(y),
    });
    await this.send("WebDriver:PerformActions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            point(from),
            { type: "pointerDown", button: 0 },
            // A step in between: one jump could be taken for a click.
            point([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]),
            point(to),
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  /** Types keys into whatever has focus in the page. Names such as "ArrowRight" are understood. */
  async press(tab: string, ...keys: string[]) {
    await this.focus(tab);
    const codes: Record<string, string> = {
      ArrowLeft: "\uE012",
      ArrowUp: "\uE013",
      ArrowRight: "\uE014",
      ArrowDown: "\uE015",
      Escape: "\uE00C",
    };
    await this.send("WebDriver:PerformActions", {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: keys.flatMap((key) => {
            const value = codes[key] ?? key;
            return [
              { type: "keyDown", value },
              { type: "keyUp", value },
            ];
          }),
        },
      ],
    });
  }

  /** Right-clicks the element and picks the page context menu item with this label. */
  async contextMenu(tab: string, selector: string, label: string) {
    const element = await this.evaluate<Record<string, string>>(
      tab,
      `const element = document.querySelector(arguments[0]);
       element?.scrollIntoView({ block: "center" });
       return element;`,
      [selector],
    );
    const [[key, id] = []] = Object.entries(element ?? {});
    if (!key || !id) throw new Error(`no element matches ${selector}`);
    await this.send("WebDriver:PerformActions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", origin: { [key]: id }, x: 0, y: 0 },
            { type: "pointerDown", button: 2 },
            { type: "pointerUp", button: 2 },
          ],
        },
      ],
    });
    const picked = await this.chrome<string>(
      `const [label] = arguments;
       const menu = document.getElementById("contentAreaContextMenu");
       for (let tries = 0; tries < 50 && menu.state !== "open"; tries++)
         await new Promise((resolve) => setTimeout(resolve, 100));
       if (menu.state !== "open") return "the context menu did not open";
       const item = [...menu.querySelectorAll("menuitem")].find((node) => node.label === label && !node.hidden);
       if (!item) { menu.hidePopup(); return "no such item"; }
       menu.activateItem(item);
       return "ok";`,
      [label],
    );
    if (picked !== "ok") throw new Error(`context menu "${label}": ${picked}`);
  }

  /** A PNG of the element matching `selector`, or of the window's view without one, as bytes. */
  async screenshot(tab: string, selector?: string): Promise<Buffer> {
    await this.focus(tab);
    const id = selector ? await this.elementId(tab, selector) : undefined;
    const { value } = await this.send<{ value: string }>("WebDriver:TakeScreenshot", { id, full: false });
    return Buffer.from(value, "base64");
  }

  /** Polls `body` (a function body returning a value) until it is truthy. */
  async waitFor<T>(tab: string, body: string, timeout = 30_000, privileged = false): Promise<T> {
    const deadline = Date.now() + timeout;
    let last: T | null = null;
    while (Date.now() < deadline) {
      last = await this.evaluate<T>(tab, body, [], privileged);
      if (last) return last;
      await sleep(100);
    }
    throw new Error(`timed out waiting for: ${body} (last: ${JSON.stringify(last)})`);
  }

  async close() {
    this.socket?.destroy();
    this.process?.kill();
    await sleep(300);
    await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}
