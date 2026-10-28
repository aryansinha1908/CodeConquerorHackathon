// Enum values shared by the Mongoose models and the Zod validators, so the two layers can't drift.
export { STATUSES as BOOKING_STATUSES } from "../engines/stateMachine.js";

export const ROLES = ["member", "manager", "admin"];
export const MEMBER_TYPES = ["ug", "pg", "rs", "faculty", "staff"];
export const EMAIL_LEVELS = ["ug", "pg", "rs"];
export const VERIFICATION_STATUSES = [
  "unsubmitted",
  "pending",
  "approved",
  "rejected",
];

export const ORG_UNIT_TYPES = ["department", "centre", "central_facility"];

export const RESOURCE_CATEGORIES = ["space", "equipment", "computing", "tool"];
export const BOOKING_MODES = ["slot", "loan"];
export const RISK_LEVELS = ["low", "medium", "high"];
export const RESOURCE_STATUSES = ["active", "maintenance", "archived"];
export const APPROVAL_MODES = ["manual", "auto"];
export const SLOT_MINUTES = [15, 30, 60];

export const USER_BADGE_STATUSES = [
  "requested",
  "active",
  "rejected",
  "revoked",
];

export const DECISION_ACTIONS = ["approve", "reject", "waitlist"];
export const RETURN_OUTCOMES = ["ok", "issue"];
export const REPORT_PHASES = ["check_in", "check_out", "return_confirmation"];
export const CONDITION_OVERALL = ["good", "minor_issue", "damaged"];

export const INCIDENT_SOURCES = ["user", "manager", "system"];
export const INCIDENT_TYPES = [
  "damage",
  "delay",
  "misuse",
  "safety",
  "conflict",
  "other",
];
export const INCIDENT_SEVERITIES = ["low", "medium", "high"];
export const INCIDENT_STATUSES = ["open", "in_review", "resolved"];
export const INCIDENT_OUTCOMES = [
  "no_action",
  "warning",
  "repair_required",
  "strike",
];
