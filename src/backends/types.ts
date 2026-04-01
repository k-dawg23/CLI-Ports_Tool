export interface RawListener {
  port: number;
  pid: number;
  command?: string;
}

export interface ProcessStats {
  command?: string;
  args?: string;
  memoryKb?: number;
  uptime?: string;
}

export interface BackendActionResult {
  success: boolean;
  message: string;
}

export interface PlatformPortBackend {
  getListeningPorts(): Promise<RawListener[]>;
  getWorkingDirectory(pid: number): Promise<string | undefined>;
  getProcessStats(pid: number): Promise<ProcessStats | undefined>;
  killProcess(pid: number, port: number): Promise<BackendActionResult>;
  isProcessAlive(pid: number): Promise<boolean>;
  openInBrowser(url: string): Promise<BackendActionResult>;
  openInEditor(path: string): Promise<BackendActionResult>;
}
