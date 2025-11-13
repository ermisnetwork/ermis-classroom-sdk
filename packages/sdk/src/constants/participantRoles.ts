/**
 * Participant role constants
 */
export const ParticipantRoles = {
    OWNER: "owner",
    ADMIN: "admin",
    MODERATOR: "moderator",
    MEMBER: "member",
    GUEST: "guest",
} as const;

export type ParticipantRole = (typeof ParticipantRoles)[keyof typeof ParticipantRoles];
