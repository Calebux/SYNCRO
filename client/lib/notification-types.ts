export type NotificationAction =
  | "resolve_duplicate"
  | "cancel_unused"
  | "cancel_trial"
  | "view_consolidation"

export type NotificationType =
  | "duplicate"
  | "unused"
  | "trial"
  | "price_change"
  | "renewal"
  | "budget"
  | "consolidation"
  | "alert"
  | "info"

export interface NotificationBase {
  id: string | number
  title: string
  description: string
  type: NotificationType
  read: boolean
}

export interface NotificationDuplicateInfo {
  subscriptions: Array<{
    id: number
    name: string
    [key: string]: unknown
  }>
  potentialSavings: number
  name: string
  count: number
  totalCost: number
}

export interface DetectedSubscription {
  name: string
  category: string
  price: number
  logo: string
  tags: string[]
  renewsIn: number
  status: string
  icon: string
  color: string
  renewalUrl: string
  emailAccountId: number
  [key: string]: unknown
}

export interface DuplicateNotification extends NotificationBase {
  type: "duplicate"
  duplicateInfo: NotificationDuplicateInfo
}

export interface UnusedNotification extends NotificationBase {
  type: "unused"
  subscriptionId: number
}

export interface TrialNotification extends NotificationBase {
  type: "trial"
  subscriptionId: number
}

export interface PriceChangeNotification extends NotificationBase {
  type: "price_change"
  priceChangeInfo: unknown
}

export interface RenewalNotification extends NotificationBase {
  type: "renewal"
  subscriptionId: number
}

export interface BudgetNotification extends NotificationBase {
  type: "budget"
}

export interface ConsolidationNotification extends NotificationBase {
  type: "consolidation"
  suggestionId: number
}

export interface AlertNotification extends NotificationBase {
  type: "alert"
  detectedSubscription: DetectedSubscription
}

export interface InfoNotification extends NotificationBase {
  type: "info"
}

export type Notification =
  | DuplicateNotification
  | UnusedNotification
  | TrialNotification
  | PriceChangeNotification
  | RenewalNotification
  | BudgetNotification
  | ConsolidationNotification
  | AlertNotification
  | InfoNotification

export type NotificationActionPayloadMap = {
  resolve_duplicate: NotificationDuplicateInfo
  cancel_unused: number
  cancel_trial: number
  view_consolidation: number
}

export type NotificationActionHandler = {
  (action: "resolve_duplicate", payload: NotificationDuplicateInfo): void
  (action: "cancel_unused", payload: number): void
  (action: "cancel_trial", payload: number): void
  (action: "view_consolidation", payload: number): void
}
