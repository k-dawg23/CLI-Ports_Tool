import type { Framework } from "./types.js";

const FRAMEWORK_CHECKS: Array<[Framework, string[]]> = [
  ["Next.js", ["next"]],
  ["Astro", ["astro"]],
  ["Vite", ["vite"]],
  ["Remix", ["@remix-run/react", "@remix-run/dev", "remix"]],
  ["Nuxt", ["nuxt"]],
  ["SvelteKit", ["@sveltejs/kit"]],
  ["Angular", ["@angular/core", "@angular/cli"]]
];

export function detectFramework(packageJson: unknown): Framework {
  if (!packageJson || typeof packageJson !== "object") {
    return "-";
  }

  const dependencies = collectDependencyNames(packageJson as Record<string, unknown>);

  for (const [framework, packages] of FRAMEWORK_CHECKS) {
    if (packages.some((packageName) => dependencies.has(packageName))) {
      return framework;
    }
  }

  return "-";
}

function collectDependencyNames(packageJson: Record<string, unknown>): Set<string> {
  const sections = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies
  ];
  const names = new Set<string>();

  for (const section of sections) {
    if (!section || typeof section !== "object") {
      continue;
    }

    for (const name of Object.keys(section)) {
      names.add(name);
    }
  }

  return names;
}
