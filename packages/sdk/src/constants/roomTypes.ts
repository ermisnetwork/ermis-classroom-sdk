/**
 * Room type constants
 */
export const RoomTypes = {
    MAIN: "main",
    BREAKOUT: "breakout",
    PRIVATE: "private",
} as const;

export type RoomType = (typeof RoomTypes)[keyof typeof RoomTypes];
