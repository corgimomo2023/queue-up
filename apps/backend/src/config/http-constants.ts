export const CookieName = {
  VendorAdmin: 'qf_super_admin',
  StaffAdmin: 'qf_vendor',
} as const;

export const Session = {
  DurationMilliseconds: 8 * 60 * 60_000,
  MinimumSecretLength: 32,
} as const;

export const RateLimit = {
  WindowMilliseconds: 15 * 60_000,
  ApiRequestsPerWindow: 200,
  LoginFailuresPerWindow: 10,
} as const;

export const RequestLimit = {
  JsonBody: '32kb',
  AuditMetadataUserAgentLength: 500,
} as const;

export const Realtime = {
  HeartbeatMilliseconds: 20_000,
  CallWindowMilliseconds: 5 * 60_000,
  CalledCustomerMessage: '現正輪到你，請於5分鐘到回到活動場地入場',
} as const;
