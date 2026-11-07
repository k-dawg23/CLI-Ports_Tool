import { InvalidArgumentError } from "commander";

export function parsePort(value: string): number {
  const port = Number(value);
  if (!value || /[^0-9]/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError(`Invalid port: ${JSON.stringify(value)}. Use a decimal integer from 1 to 65535.`);
  }
  return port;
}

export function parsePid(value: string): number {
  const pid = Number(value);
  if (!value || /[^0-9]/.test(value) || !Number.isInteger(pid) || pid < 0 || pid > 0xffffffff) {
    throw new InvalidArgumentError(`Invalid PID: ${JSON.stringify(value)}. Use a decimal integer from 0 to 4294967295.`);
  }
  return pid;
}

export function parseProjectQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new InvalidArgumentError("Project filter must contain non-whitespace text.");
  return query;
}
