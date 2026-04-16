/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Chromium Path - Absolute path to the Chromium binary */
  "chromiumPath": string,
  /** Temp Profile Base Directory - Directory where temporary profiles are created */
  "tempBaseDir": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `launch` command */
  export type Launch = ExtensionPreferences & {
  /** Browsing Mode - Default browsing mode */
  "browsingMode": "normal" | "incognito",
  /** Disable Web Security - Disables same-origin policy (use with caution) */
  "disableWebSecurity": boolean,
  /** Disable Extensions - Start Chromium without any installed extensions */
  "disableExtensions": boolean,
  /** Auto-Cleanup - Automatically delete the temp profile once the Chromium window is closed */
  "autoCleanup": boolean,
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

