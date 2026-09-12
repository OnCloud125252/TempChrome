#!/usr/bin/env bun
/**
 * Regenerates the `launch` command's `preferences` block in
 * raycast/package.json from the shared schema in
 * raycast/src/options/schema.ts.
 *
 * This lives outside raycast/ on purpose. `ray publish` copies the whole
 * extension folder, and the Raycast CI runs npm without bun, so no bun
 * script may sit inside raycast/. The git hooks call this instead.
 *
 * Idempotent — running it twice produces identical output.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	isArgField,
	LAUNCH_OPTIONS_SCHEMA,
	type ArgField,
} from "../raycast/src/options/schema";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(scriptDir, "..", "raycast", "package.json");

type ManifestPreference = Record<string, unknown>;

function toManifestPreference(field: ArgField): ManifestPreference {
	const base: ManifestPreference = {
		name: field.name,
		type: field.kind,
		required: false,
		title: field.title,
		description: field.description,
		default: field.default,
	};

	switch (field.kind) {
		case "dropdown":
			return { ...base, data: field.options.map((option) => ({ ...option })) };
		case "checkbox":
			return { ...base, label: field.label };
		case "textfield":
			return field.placeholder !== undefined
				? { ...base, placeholder: field.placeholder }
				: base;
	}
}

type PackageJson = {
	commands: Array<{ name: string; preferences?: ManifestPreference[] }>;
};

const raw = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw) as PackageJson;

const launchCmd = pkg.commands.find((cmd) => cmd.name === "launch");
if (!launchCmd) {
	throw new Error("`launch` command not found in package.json");
}

launchCmd.preferences = LAUNCH_OPTIONS_SCHEMA.filter(isArgField).map(
	toManifestPreference,
);

const next = `${JSON.stringify(pkg, null, 2)}\n`;

if (next !== raw) {
	writeFileSync(pkgPath, next);
	console.info(
		"[sync-options-schema] Updated launch.preferences in package.json",
	);
} else {
	console.info("[sync-options-schema] launch.preferences already in sync");
}
