export const BASE_CHROMIUM_ARGS = [
  "--disable-fre",
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
] as const;

export const GOOGLE_ENV = {
  GOOGLE_API_KEY: "AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k",
  GOOGLE_DEFAULT_CLIENT_ID: "811574891467.apps.googleusercontent.com",
  GOOGLE_DEFAULT_CLIENT_SECRET: "kdloedMFGdGla2P1zacGjAQh",
} as const;

export const AUTO_CLEANUP_REGISTRY_KEY = "tempchrome.auto-cleanup-registry";

export const ID_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ID_LENGTH = 10;
export const MAX_ID_ATTEMPTS = 100;
