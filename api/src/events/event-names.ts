export const EVENT_NAMES = {
  ORDER_CREATED: 'order.created',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];
