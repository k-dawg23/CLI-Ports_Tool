#!/usr/bin/env node
import { runCli } from "./commands.js";

void runCli().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error instanceof Error ? error.message : "Unexpected error.");
  process.exitCode = 1;
});
