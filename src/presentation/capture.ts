import type { PresentationEvent, PresentationSink, PresentationSnapshot, FighterSnapshot } from './snapshot';
export interface QueuedEvent {
    readonly epoch: number;
    readonly sequence: number;
    readonly clock: number;
    readonly event: PresentationEvent;
}
/** Scene-owned, bounded passive inbox. Clock advances per observed host tick, including cosmetic result ticks. */
export class PresentationCapture implements PresentationSink {
    snapshot?: PresentationSnapshot;
    clock = 0;
    epoch = 0;
    dropped = 0;
    private pendingHits = new Set<string>();
    private reset = -1;
    private sequence = 0;
    private queue: QueuedEvent[] = [];
    private ages = new Map<string, {
        key: string;
        age: number;
        air: number;
        hit: number;
    }>();
    onEvent = (event: PresentationEvent): void => {
        if (event.type === 'contact' && event.hit.outcome !== 'block')
            this.pendingHits.add(event.hit.defenderId);
        if (event.type === 'lifecycle') {
            this.checkReset(event.resetVersion);
            if (this.snapshot)
                this.snapshot = Object.freeze({ ...this.snapshot, state: event.state, paused: event.paused });
        }
        if (this.queue.length === 512) {
            this.queue.shift();
            this.dropped++;
        }
        this.queue.push(Object.freeze({ epoch: this.epoch, sequence: ++this.sequence, clock: this.clock + (event.type === 'lifecycle' || event.type === 'ko' ? 0 : 1), event }));
    };
    onFrame = (snapshot: PresentationSnapshot): void => {
        this.checkReset(snapshot.resetVersion);
        this.clock++;
        const previous = this.snapshot;
        this.snapshot = snapshot;
        for (const f of snapshot.fighters) {
            const key = f.health <= 0 ? 'ko' : [snapshot.state, f.action.type, f.action.id, f.state].join('/'), old = this.ages.get(f.id);
            this.ages.set(f.id, { key, age: old?.key === key ? old.age + 1 : 0, air: f.state === 'jump' ? (old?.air ?? -1) + 1 : 0, hit: f.action.type === 'hitstun' && !this.pendingHits.has(f.id) && previous?.fighters.find(p => p.id === f.id)?.action.type === 'hitstun' ? (old?.hit ?? 0) + 1 : 0 });
            if (f.health <= 0 && (previous?.fighters.find(p => p.id === f.id)?.health ?? 0) > 0)
                this.onEvent(Object.freeze({ type: 'ko', id: f.id, x: f.x, y: f.y, z: f.z }));
        }
        this.pendingHits.clear();
    };
    context(f: FighterSnapshot) { const a = this.ages.get(f.id); return { clock: this.clock, age: a?.age ?? 0, airAge: a?.air ?? 0, hitAge: a?.hit ?? 0, matchState: this.snapshot?.state ?? 'Menu', winner: this.snapshot?.winner }; }
    drain(): QueuedEvent[] { return this.queue.splice(0); }
    clear(): void { this.snapshot = undefined; this.queue = []; this.ages.clear(); this.pendingHits.clear(); this.clock = 0; this.sequence = 0; this.reset = -1; this.epoch++; }
    private checkReset(version: number) { if (version !== this.reset) {
        this.queue = [];
        this.ages.clear();
        this.pendingHits.clear();
        this.clock = 0;
        this.sequence = 0;
        this.snapshot = undefined;
        this.reset = version;
        this.epoch++;
    } }
}
