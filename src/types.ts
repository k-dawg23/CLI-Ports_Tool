export type Framework =
  | "Next.js"
  | "Astro"
  | "Vite"
  | "Remix"
  | "Nuxt"
  | "SvelteKit"
  | "Angular"
  | "-";

export interface PackageContext {
  packageJsonPath?: string;
  projectName: string;
  framework: Framework;
}

export interface PortProcess {
  port: number;
  pid: number;
  command: string;
  cwd?: string;
  memoryKb?: number;
  uptime?: string;
  projectName: string;
  framework: Framework;
}

export interface ListenerTarget {
  pid: number;
  port: number;
}

export interface PortSnapshot {
  processes: readonly PortProcess[];
  warnings: readonly string[];
  completedAt: number;
}
