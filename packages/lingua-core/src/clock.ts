import { monotonicFactory } from "ulid";

// 时钟端口（ADR-0017 真接缝）：ID 生成并入此端口，不单独开缝。
export interface Clock {
  now(): number;
  newId(): string;
}

export class SystemClock implements Clock {
  #ulid = monotonicFactory();

  now(): number {
    return Date.now();
  }

  newId(): string {
    return this.#ulid(this.now());
  }
}

export class FakeClock implements Clock {
  #current: number;
  #ulid = monotonicFactory();

  constructor(start: number = 0) {
    this.#current = start;
  }

  now(): number {
    return this.#current;
  }

  newId(): string {
    return this.#ulid(this.#current);
  }

  advance(ms: number): void {
    this.#current += ms;
  }

  set(ms: number): void {
    this.#current = ms;
  }
}
