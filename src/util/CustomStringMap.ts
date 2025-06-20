export class CustomStringMap<V> {
  private map: Record<string, V> = {};

  mergeFrom(other: Map<string, V> | { [key: string]: V }) {
    if (other instanceof Map) {
      for (const [key, value] of other.entries()) {
        this.set(key, value);
      }
    } else {
      for (const key in other) {
        if (Object.prototype.hasOwnProperty.call(other, key)) {
          this.set(key, other[key]);
        }
      }
    }
  }

  set(key: string, value: V): void {
    this.map[key] = value;
  }

  /**
   * Leniently returns the value for the key.
   * Underscores are treated as hyphens by default.
   *
   * @param key The key.
   * @param exact Whether or no to lookup the key exactly. Default is not to be exact.
   * @returns The value.
   */
  get(key: string, exact = false): V | undefined {
    if (exact) return this.map[key];
    if (this.has(key)) return this.map[key];
    return this.map[key.replaceAll("_", "-")];
  }

  getEntry(key: string, exact = false): [string, V] | undefined {
    if (exact && this.map[key]) return [key, this.map[key]];
    if (this.map[key]) return [key, this.map[key]];
    const fixKey = key.replaceAll("_", "-");
    return this.map[fixKey] ? [fixKey, this.map[fixKey]] : undefined;
  }

  has(key: string): boolean {
    return key in this.map;
  }

  delete(key: string): void {
    delete this.map[key];
  }

  keys(): string[] {
    return Object.keys(this.map);
  }

  values(): V[] {
    return Object.values(this.map);
  }

  entries(): [string, V][] {
    return Object.entries(this.map);
  }
}
