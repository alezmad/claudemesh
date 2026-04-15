const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
export function print(msg: string): void { process.stdout.write(msg + "\n"); }
export function printErr(msg: string): void { process.stderr.write(msg + "\n"); }
export function isQuiet(): boolean { return process.argv.includes("-q") || process.argv.includes("--quiet"); }
export function isVerbose(): boolean { return process.argv.includes("-v") || process.argv.includes("--verbose"); }
export function isJson(): boolean { return process.argv.includes("--json"); }
export function isTty(): boolean { return !!isTTY; }
