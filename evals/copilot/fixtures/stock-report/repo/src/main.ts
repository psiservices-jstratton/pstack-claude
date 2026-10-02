#!/usr/bin/env node
import { run } from "./cli.ts";

try {
  process.stdout.write(run(process.argv.slice(2)) + "\n");
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
