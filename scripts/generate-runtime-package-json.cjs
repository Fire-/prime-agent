#!/usr/bin/env node
/**
 * Generates a minimal package.json for the runtime tier from the vendor's
 * package-lock.json. Only includes externalized packages that the bundle
 * needs at runtime.
 */

const fs = require("fs");

const EXTERNALS = [
	"zeromq",
	"koffi",
	"undici",
	"@silvia-odwyer/photon-node",
	"@mariozechner/clipboard",
];

const [lockfilePath, outputPath] = process.argv.slice(2);

if (!lockfilePath || !outputPath) {
	console.error("Usage: node generate-runtime-package-json.js <package-lock.json> <output-package.json>");
	process.exit(1);
}

const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
const deps = {};

for (const pkg of EXTERNALS) {
	const key = `node_modules/${pkg}`;
	const pkgInfo = lockfile.packages?.[key];
	if (pkgInfo?.version) {
		deps[pkg] = pkgInfo.version;
	} else {
		console.warn(`Warning: ${pkg} not found in package-lock.json`);
	}
}

const output = {
	name: "prime-agent-runtime",
	version: "1.0.0",
	private: true,
	type: "module",
	dependencies: deps,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Generated ${outputPath} with ${Object.keys(deps).length} externals:`);
for (const [name, version] of Object.entries(deps)) {
	console.log(`  ${name}@${version}`);
}
