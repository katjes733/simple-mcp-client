import { formatWithOptions } from "node:util";
import type { WriteStream } from "node:tty";

interface TypeOpts {
  /** override the per-character delay just for this line */
  delay?: number;
}

const inspectOpts = {
  depth: null,
  colors: process.stdout.isTTY,
  compact: false,
};

export class Typewriter {
  /* queue now stores text + delay per entry */
  private typingQ: { text: string; delay: number }[] = [];
  private pending: { stream: WriteStream; text: string }[] = [];
  private busy = false;

  private defaultDelay: number;
  constructor(defaultDelay = 35) {
    this.defaultDelay = defaultDelay;
  }

  /*──────────────────────────────  PUBLIC  ─────────────────────────────*/

  /** Retro, character-by-character.  Pass `{ delay }` to override speed. */
  type(...args: any[]) {
    let opts: TypeOpts | undefined;

    /* last arg may be an options object with a `delay` field */
    if (
      args.length &&
      typeof args[args.length - 1] === "object" &&
      args[args.length - 1] !== null &&
      "delay" in args[args.length - 1]
    ) {
      opts = args.pop() as TypeOpts;
    }

    const text = this.fmt(args) + "\n";
    const delay = opts?.delay ?? this.defaultDelay;

    this.typingQ.push({ text, delay });
    if (!this.busy) this.pump();
  }

  /** Standard log (flushes after typing). */
  log(...a: any[]) {
    this.enqueue(process.stdout, a);
  }

  /** Standard error (flushes after typing). */
  error(...a: any[]) {
    this.enqueue(process.stderr, a);
  }

  isBusy() {
    return this.busy || this.typingQ.length > 0;
  }
  async done() {
    while (this.isBusy()) await wait(15);
  }

  /*────────────────────────────── INTERNALS ───────────────────────────*/

  private fmt(a: any[]) {
    return formatWithOptions(inspectOpts, ...a);
  }

  private enqueue(stream: WriteStream, a: any[]) {
    const text = this.fmt(a) + "\n";
    if (this.isBusy()) this.pending.push({ stream, text });
    else stream.write(text);
  }

  private async pump() {
    this.busy = true;
    while (this.typingQ.length) {
      const { text, delay } = this.typingQ.shift()!;
      for (const ch of text) {
        process.stdout.write(ch);
        await wait(delay);
      }
      /* flush any buffered log/error lines */
      while (this.pending.length) {
        const { stream, text } = this.pending.shift()!;
        stream.write(text);
      }
    }
    this.busy = false;
  }
}

/* small helper */
function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
