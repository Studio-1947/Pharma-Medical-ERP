/**
 * Every value written to audit_logs.action.
 *
 * Kept in one place so the writers and the console's filter dropdown cannot
 * drift apart — the column is a free-form varchar(100), so nothing else would
 * catch a typo.
 */
export const AuditAction = {
  USER_CREATE: "USER_CREATE",
  USER_UPDATE: "USER_UPDATE",
  USER_ROLE_CHANGE: "USER_ROLE_CHANGE",
  USER_DEACTIVATE: "USER_DEACTIVATE",
  USER_REACTIVATE: "USER_REACTIVATE",
  ADMIN_PASSWORD_RESET: "ADMIN_PASSWORD_RESET",
  SESSION_REVOKE: "SESSION_REVOKE",
  SESSIONS_REVOKE_ALL: "SESSIONS_REVOKE_ALL",
  IMPERSONATION_START: "IMPERSONATION_START",
  IMPERSONATION_STOP: "IMPERSONATION_STOP",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AUDIT_ACTIONS = Object.values(AuditAction);
