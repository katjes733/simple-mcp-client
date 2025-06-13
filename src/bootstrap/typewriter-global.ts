import { Typewriter } from "../util/Typewriter";

const typewriter = new Typewriter(10);

Object.defineProperty(globalThis, "typewriter", {
  value: typewriter,
  writable: false,
  enumerable: false,
});

console.log = (...args: any[]) => typewriter.log(...args);
console.error = (...args: any[]) => typewriter.error(...args);

export {};
