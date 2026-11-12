// The module two entry points share, so a split build puts it in one chunk both load.

export function parseDemo(text: string): string {
  return text.trim();
}

export const DEMO_VERSION = "0.0.0-demo";

export class DemoError extends Error {}

const demoProto = { synthetic: true };

export { demoProto as "__proto__", demoProto as "dash-name" };

export default function demoDefault(): number {
  return 1;
}

// A live binding: the chunk reassigns it, so a copy taken when an entry loads would go stale.
export let demoCounter = 0;

export function bumpDemoCounter(): void {
  demoCounter += 1;
}
