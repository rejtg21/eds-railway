/**
 * The transport-agnostic seam.
 *
 * Today: PgBossEventBus (Postgres-backed queue, no extra infra).
 * Later:  BullMqEventBus (Redis) - swap the binding in events.module.ts,
 *         nothing else in the app changes.
 */

export interface IntegrationEvent<T = unknown> {
  /** Stable id carried from the outbox row. Consumers key idempotency on this. */
  id: string;
  /** e.g. "order.created" */
  name: string;
  payload: T;
  occurredAt: string;
}

export type EventHandler = (event: IntegrationEvent) => Promise<void>;

export interface EventBus {
  /** Connect / provision the transport. Idempotent. */
  start(): Promise<void>;
  /** Drain in-flight work and disconnect. */
  stop(): Promise<void>;
  /** Enqueue an event for delivery. */
  publish(event: IntegrationEvent): Promise<void>;
  /** Register a worker. `consumerName` is for logging/telemetry only. */
  subscribe(
    eventName: string,
    consumerName: string,
    handler: EventHandler,
  ): Promise<void>;
}

export const EVENT_BUS = Symbol('EVENT_BUS');
