import type { AgendaStage, RoundResult, SeatStatement, StopReason } from "../contracts/trace.js";
import type { DecisionType } from "../contracts/response.js";
import type { SpeakerCallbacks } from "./speaker.js";

export type DebateEvent =
  | { type: "seat_selected"; seats: string[] }
  | { type: "round_start"; round: number; stage: AgendaStage }
  | { type: "seat_speaking"; seatId: string; round: number }
  | { type: "seat_responded"; seatId: string; statement: SeatStatement }
  | { type: "objection_raised"; seatId: string; objection: string }
  | { type: "round_complete"; round: number; result: RoundResult }
  | { type: "consensus_reached"; decisionType: DecisionType }
  | { type: "debate_end"; reason: StopReason }
  | { type: "synthesis_start" }
  | { type: "synthesis_complete"; answer: string }
  | { type: "cache_hit"; hash: string };

export type DebateEventType = DebateEvent["type"];

export type DebateEventHandler<T extends DebateEventType = DebateEventType> = (
  event: Extract<DebateEvent, { type: T }>,
) => void;

export class DebateEventBus {
  private handlers = new Map<DebateEventType, Set<DebateEventHandler<any>>>();

  on<T extends DebateEventType>(type: T, handler: DebateEventHandler<T>): this {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return this;
  }

  off<T extends DebateEventType>(type: T, handler: DebateEventHandler<T>): this {
    this.handlers.get(type)?.delete(handler);
    return this;
  }

  emit(event: DebateEvent): void {
    const listeners = this.handlers.get(event.type);
    if (!listeners) return;
    for (const handler of listeners) {
      handler(event);
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}

/**
 * Adapt legacy SpeakerCallbacks to emit DebateEvents.
 * Allows existing callback-based consumers to coexist with the new event bus.
 */
export function callbacksToEventBus(callbacks: SpeakerCallbacks): DebateEventBus {
  const bus = new DebateEventBus();

  if (callbacks.onSeatSelected) {
    const fn = callbacks.onSeatSelected;
    bus.on("seat_selected", (e) => fn(e.seats));
  }
  if (callbacks.onRoundStart) {
    const fn = callbacks.onRoundStart;
    bus.on("round_start", (e) => fn(e.round));
  }
  if (callbacks.onSeatSpeaking) {
    const fn = callbacks.onSeatSpeaking;
    bus.on("seat_speaking", (e) => fn(e.seatId, e.round));
  }
  if (callbacks.onRoundComplete) {
    const fn = callbacks.onRoundComplete;
    bus.on("round_complete", (e) => fn(e.round, e.result));
  }
  if (callbacks.onDebateEnd) {
    const fn = callbacks.onDebateEnd;
    bus.on("debate_end", (e) => fn(e.reason));
  }

  return bus;
}

/**
 * Create a SpeakerCallbacks object that forwards events to a DebateEventBus.
 */
export function eventBusToCallbacks(bus: DebateEventBus): SpeakerCallbacks {
  return {
    onSeatSelected: (seats) => bus.emit({ type: "seat_selected", seats }),
    onRoundStart: (round) => {
      bus.emit({ type: "round_start", round, stage: round === 1 ? "opening" : "rebuttal" });
    },
    onSeatSpeaking: (seatId, round) => bus.emit({ type: "seat_speaking", seatId, round }),
    onRoundComplete: (round, result) => bus.emit({ type: "round_complete", round, result }),
    onDebateEnd: (reason) => bus.emit({ type: "debate_end", reason }),
  };
}
