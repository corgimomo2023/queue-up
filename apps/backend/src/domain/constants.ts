export const ActorType = {
  Anonymous: 'anonymous',
  VendorAdmin: 'vendor_admin',
  ClientAdmin: 'client_admin',
  StaffAdmin: 'staff_admin',
  Customer: 'customer',
  System: 'system',
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];
export type VendorAdminActorType = typeof ActorType.VendorAdmin;
export type StaffAdminActorType = typeof ActorType.StaffAdmin;
export type CustomerActorType = typeof ActorType.Customer;

export const QueueLifecycleStatus = {
  Scheduled: 'scheduled',
  Active: 'active',
  Ended: 'ended',
} as const;

export type QueueLifecycleStatus = (typeof QueueLifecycleStatus)[keyof typeof QueueLifecycleStatus];

export const CustomerStatus = {
  Waiting: 'waiting',
  Served: 'served',
  Left: 'left',
  Removed: 'removed',
} as const;

export type CustomerStatus = (typeof CustomerStatus)[keyof typeof CustomerStatus];

export const CustomerEndReason = {
  Served: 'served',
  CustomerLeft: 'customer_left',
  VendorRemoved: 'vendor_removed',
  QueueCleared: 'queue_cleared',
  QueuePeriodEnded: 'queue_period_ended',
  QueueSoftRemoved: 'queue_soft_removed',
} as const;

export type CustomerEndReason = (typeof CustomerEndReason)[keyof typeof CustomerEndReason];

export const AuditAction = {
  VendorAdminLoginFailed: 'VENDOR_ADMIN_LOGIN_FAILED',
  VendorAdminLoginSuccess: 'VENDOR_ADMIN_LOGIN_SUCCESS',
  ClientAdminLoginFailed: 'CLIENT_ADMIN_LOGIN_FAILED',
  ClientAdminLoginSuccess: 'CLIENT_ADMIN_LOGIN_SUCCESS',
  EventCreated: 'EVENT_CREATED',
  EventUpdated: 'EVENT_UPDATED',
  EventArchived: 'EVENT_ARCHIVED',
  EventRestored: 'EVENT_RESTORED',
  EventLogoUploaded: 'EVENT_LOGO_UPLOADED',
  EventLogoRemoved: 'EVENT_LOGO_REMOVED',
  CustomerJoined: 'CUSTOMER_JOINED',
  CustomerLeft: 'CUSTOMER_LEFT',
  CustomerServed: 'CUSTOMER_SERVED',
  CustomerRemoved: 'CUSTOMER_REMOVED',
  QueueCleared: 'QUEUE_CLEARED',
  QueuePeriodEnded: 'QUEUE_PERIOD_ENDED',
  QueueSoftRemoved: 'QUEUE_SOFT_REMOVED',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ApiErrorCode = {
  InvalidImage: 'INVALID_IMAGE',
  UnsupportedImageType: 'UNSUPPORTED_IMAGE_TYPE',
  ImageDimensionsExceeded: 'IMAGE_DIMENSIONS_EXCEEDED',
  ImageTooLarge: 'IMAGE_TOO_LARGE',
  EventArchived: 'EVENT_ARCHIVED',
  EventAlreadyArchived: 'EVENT_ALREADY_ARCHIVED',
  EventNotArchived: 'EVENT_NOT_ARCHIVED',
  EventUpdateConflict: 'EVENT_UPDATE_CONFLICT',
  EventAssetConflict: 'EVENT_ASSET_CONFLICT',
  EventActiveCannotBeRescheduled: 'EVENT_ACTIVE_CANNOT_BE_RESCHEDULED',
  InvalidEventPeriod: 'INVALID_EVENT_PERIOD',
  QueueScheduled: 'QUEUE_SCHEDULED',
  QueueEnded: 'QUEUE_ENDED',
  JsonRequired: 'JSON_REQUIRED',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const RealtimeEvent = {
  Status: 'status',
  Update: 'update',
  QueueCalled: 'queue.called',
  QueueEnded: 'queue_ended',
  QueueArchived: 'queue_archived',
} as const;

export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export const QueueStartMode = {
  Now: 'now',
  Scheduled: 'scheduled',
} as const;

export type QueueStartMode = (typeof QueueStartMode)[keyof typeof QueueStartMode];
