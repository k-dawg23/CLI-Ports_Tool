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
