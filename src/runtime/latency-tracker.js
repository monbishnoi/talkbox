export class LatencyTracker {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.startedAt = this.clock();
    this.marks = [{ name: 'turn.started', elapsedMs: 0 }];
  }

  mark(name, detail = {}) {
    const elapsedMs = Math.round(this.clock() - this.startedAt);
    const mark = { name, elapsedMs, detail };
    this.marks.push(mark);
    return mark;
  }

  summary() {
    const out = {
      totalMs: this.marks.at(-1)?.elapsedMs || 0,
      marks: this.marks,
    };

    for (const mark of this.marks) {
      out[`${mark.name.replaceAll('.', '_')}Ms`] = mark.elapsedMs;
    }

    return out;
  }
}
