// Array-backed binary min-heap. "Min" is defined by a priority function:
// the root is the element for which no other element is LESS desirable.
//
// Layout: parent(i) = (i - 1) >> 1, left(i) = 2i + 1, right(i) = 2i + 2.

export class MinHeap {
  /** @param {(a, b) => number} better  > 0 when a is more desirable than b */
  constructor(better) {
    this.better = better;
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  // a should sit above b when a is LESS desirable than b
  #above(i, j) {
    return this.better(this.items[i], this.items[j]) < 0;
  }

  #swap(i, j) {
    const t = this.items[i];
    this.items[i] = this.items[j];
    this.items[j] = t;
  }

  /** O(log K) */
  push(item) {
    this.items.push(item);
    this.#siftUp(this.items.length - 1);
  }

  /** Remove and return the root. O(log K) */
  pop() {
    const n = this.items.length;
    if (n === 0) return undefined;
    const root = this.items[0];
    const last = this.items.pop();
    if (n > 1) {
      this.items[0] = last;
      this.#siftDown(0);
    }
    return root;
  }

  /** Replace the root with `item` and restore the heap property. O(log K) */
  replaceRoot(item) {
    if (this.items.length === 0) throw new Error("replaceRoot on empty heap");
    const old = this.items[0];
    this.items[0] = item;
    this.#siftDown(0);
    return old;
  }

  #siftUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#above(i, p)) break;
      this.#swap(i, p);
      i = p;
    }
  }

  #siftDown(i) {
    const n = this.items.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let top = i;
      if (l < n && this.#above(l, top)) top = l;
      if (r < n && this.#above(r, top)) top = r;
      if (top === i) break;
      this.#swap(i, top);
      i = top;
    }
  }

  /** Verifies every parent is no more desirable than its children. O(K) — for tests/debug. */
  isValidHeap() {
    for (let i = 1; i < this.items.length; i++) {
      const p = (i - 1) >> 1;
      if (this.better(this.items[p], this.items[i]) > 0) return false;
    }
    return true;
  }

  toArray() {
    return this.items.slice();
  }
}
