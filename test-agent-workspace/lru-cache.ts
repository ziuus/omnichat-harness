/**
 * Least-recently-used cache with O(1) average-time lookup and updates.
 *
 * The Map provides key-to-node lookup; the doubly linked list keeps the
 * most-recently-used entry at the head and the least-recently-used at the tail.
 */
type CacheNode<K, V> = {
  key: K;
  value: V;
  previous: CacheNode<K, V> | null;
  next: CacheNode<K, V> | null;
};

export class LRUCache<K, V> {
  private readonly entries = new Map<K, CacheNode<K, V>>();
  private readonly head: CacheNode<K, V>;
  private readonly tail: CacheNode<K, V>;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("capacity must be a positive safe integer");
    }

    this.head = { key: undefined as K, value: undefined as V, previous: null, next: null };
    this.tail = { key: undefined as K, value: undefined as V, previous: null, next: null };
    this.head.next = this.tail;
    this.tail.previous = this.head;
  }

  get(key: K): V | undefined {
    const node = this.entries.get(key);
    if (node === undefined) return undefined;
    this.moveToFront(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.value = value;
      this.moveToFront(existing);
      return;
    }

    const node: CacheNode<K, V> = {
      key,
      value,
      previous: null,
      next: null,
    };
    this.entries.set(key, node);
    this.insertAfterHead(node);

    if (this.entries.size > this.capacity) {
      const leastRecentlyUsed = this.tail.previous;
      if (leastRecentlyUsed !== null && leastRecentlyUsed !== this.head) {
        this.detach(leastRecentlyUsed);
        this.entries.delete(leastRecentlyUsed.key);
      }
    }
  }

  delete(key: K): boolean {
    const node = this.entries.get(key);
    if (node === undefined) return false;
    this.detach(node);
    this.entries.delete(key);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.head.next = this.tail;
    this.tail.previous = this.head;
  }

  size(): number {
    return this.entries.size;
  }

  private moveToFront(node: CacheNode<K, V>): void {
    this.detach(node);
    this.insertAfterHead(node);
  }

  private insertAfterHead(node: CacheNode<K, V>): void {
    const first = this.head.next!;
    node.previous = this.head;
    node.next = first;
    this.head.next = node;
    first.previous = node;
  }

  private detach(node: CacheNode<K, V>): void {
    node.previous!.next = node.next;
    node.next!.previous = node.previous;
    node.previous = null;
    node.next = null;
  }
}
