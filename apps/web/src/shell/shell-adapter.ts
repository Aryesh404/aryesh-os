/**
 * docs/13 D2 — the app ships in a browser now and inside Tauri v2 from Phase 2.
 *
 * Everything the desktop wrapper will provide goes through this interface from
 * M1, so adding Tauri later is a second implementation rather than a refactor
 * of every call site.
 */

export interface Notification {
  title: string;
  body?: string;
  /** Deep link back into the app, e.g. `/goals/abc`. */
  target?: string;
}

export interface ShellAdapter {
  readonly kind: 'browser' | 'desktop';

  /** True when a global (OS-wide) hotkey can be registered. */
  readonly supportsGlobalHotkey: boolean;

  /**
   * Register the command-palette hotkey. In the browser this binds within the
   * document; on the desktop it binds OS-wide. Returns an unsubscribe fn.
   */
  registerCommandPalette(handler: () => void): () => void;

  notify(notification: Notification): Promise<void>;

  /** Open an external URL without navigating the app away. */
  openExternal(url: string): Promise<void>;

  /**
   * Secret storage. The browser implementation deliberately refuses: secrets
   * never live in web storage (docs/01 §7). Until Tauri lands, the API process
   * holds them.
   */
  readonly secrets: {
    available: boolean;
    get(handle: string): Promise<string | null>;
    set(handle: string, value: string): Promise<void>;
  };
}
