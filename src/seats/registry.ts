import type { SeatProfile } from "../contracts/seats.js";
import { SEAT_PROFILES } from "./profiles.js";

export class SeatRegistry {
  private seats: Map<string, SeatProfile>;

  constructor(profiles: SeatProfile[] = SEAT_PROFILES) {
    this.seats = new Map(profiles.map((p) => [p.id, p]));
  }

  get(id: string): SeatProfile | undefined {
    return this.seats.get(id);
  }

  getOrThrow(id: string): SeatProfile {
    const seat = this.seats.get(id);
    if (!seat) throw new Error(`Unknown seat: ${id}`);
    return seat;
  }

  listAll(): SeatProfile[] {
    return Array.from(this.seats.values());
  }

  listStarter(): SeatProfile[] {
    return this.listAll().filter((s) => s.isStarter);
  }

  listByCategory(category: string): SeatProfile[] {
    return this.listAll().filter((s) => s.category === category);
  }

  starterIds(): string[] {
    return this.listStarter().map((s) => s.id);
  }

  has(id: string): boolean {
    return this.seats.has(id);
  }

  get size(): number {
    return this.seats.size;
  }
}

export const defaultRegistry = new SeatRegistry();
