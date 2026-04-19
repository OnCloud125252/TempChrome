/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Chromium Install Directory - Directory that contains (or will contain) Chromium.app. The installer places Chromium.app here; launches spawn the binary inside it. */
  "chromiumInstallDir": string,
  /** Temp Profile Base Directory - Directory where temporary profiles are created */
  "tempBaseDir": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `launch` command */
  export type Launch = ExtensionPreferences & {
  /** Auto-Cleanup - Automatically delete the temp profile once the Chromium window is closed */
  "autoCleanup": boolean,
  /** Start URL - Open Chromium directly on this page (leave blank for the default new tab) */
  "startUrl": string,
  /** Browsing Mode - Default browsing mode */
  "browsingMode": "normal" | "incognito",
  /** App Mode - Requires a Start URL. Emits --app=<url> instead of the positional URL */
  "appMode": boolean,
  /** Window State - Initial window mode */
  "windowState": "normal" | "maximized" | "fullscreen" | "kiosk",
  /** Window Size - Initial window size (WxH or W,H) */
  "windowSize": string,
  /** Window Position - Initial window position (X,Y) */
  "windowPosition": string,
  /** Disable Web Security - Disables same-origin policy (use with caution) */
  "disableWebSecurity": boolean,
  /** Ignore Certificate Errors - Skips TLS validation — use only for local dev */
  "ignoreCertificateErrors": boolean,
  /** Disable Extensions - Start Chromium without any installed extensions */
  "disableExtensions": boolean,
  /** Auto-Open DevTools - Passes --auto-open-devtools-for-tabs */
  "autoOpenDevtools": boolean,
  /** Remote Debugging Port - Enable CDP on a port (1–65535); blank to disable */
  "remoteDebuggingPort": string,
  /** User Agent - Override the User-Agent string */
  "userAgent": string,
  /** Proxy Server - HTTP or SOCKS proxy */
  "proxyServer": string,
  /** Language - BCP-47 language tag (e.g. en-US, ja-JP) */
  "language": string,
  /** Custom Chromium Arguments - Extra CLI flags appended to every launch (whitespace-separated) */
  "customArgs": string
}
  /** Preferences accessible in the `tempchrome` command */
  export type Tempchrome = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `launch` command */
  export type Launch = {}
  /** Arguments passed to the `tempchrome` command */
  export type Tempchrome = {}
}

