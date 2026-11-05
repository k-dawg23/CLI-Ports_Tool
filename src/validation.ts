import { InvalidArgumentError } from "commander";

export function parsePort(value: string): number {
  const port = Number(value);
  if (!value || /[^0-9]/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError(`Invalid port: ${JSON.stringify(value)}. Use a decimal integer from 1 to 65535.`);
  }
  return port;
}
