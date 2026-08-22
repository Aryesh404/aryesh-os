import type { Notification, ShellAdapter } from './shell-adapter.js';

const REFUSAL =
  'Secrets are not stored in the browser. They live in the API process until the ' +
  'Tauri shell provides OS-backed storage (docs/01 §7).';

export const browserShell: ShellAdapter = {
  kind: 'browser',
  supportsGlobalHotkey: false,

  registerCommandPalette(handler) {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  },

  async notify({ title, body }: Notification) {
    if (!('Notification' in window)) return;
    if (window.Notification.permission === 'granted') {
      new window.Notification(title, body === undefined ? undefined : { body });
    }
  },

  async openExternal(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },

  secrets: {
    available: false,
    async get() {
      throw new Error(REFUSAL);
    },
    async set() {
      throw new Error(REFUSAL);
    },
  },
};
