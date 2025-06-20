/* eslint-disable no-unused-vars */
/* mark as a module so TS treats it as a declaration file */
export {};

import type { Typewriter } from "~/util/Typewriter";

declare global {
  /** Retro-style logger available everywhere */
  var typewriter: Typewriter;

  interface Console {
    /** bypasses the typewriter, prints immediately */
    type: (...args: any[]) => void;
  }
}
