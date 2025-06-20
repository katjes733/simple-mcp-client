export class LimitedSizeArray<T> {
  private maxBytes: number;
  private elements: T[];
  private currentSize: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
    this.elements = [];
    this.currentSize = 0;
  }

  push(element: T): void {
    const elementSize = this.getByteSize(element);

    while (
      this.currentSize + elementSize > this.maxBytes &&
      this.elements.length > 0
    ) {
      const removedElement = this.elements.shift()!;
      this.currentSize -= this.getByteSize(removedElement);
    }

    this.elements.push(element);
    this.currentSize += elementSize;
  }

  all(): T[] {
    return this.elements;
  }

  getTotalSize(): number {
    return this.currentSize;
  }

  private getByteSize(obj: any): number {
    return Buffer.byteLength(JSON.stringify(obj), "utf8");
  }
}
