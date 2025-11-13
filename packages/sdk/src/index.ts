/**
 * Ermis Classroom SDK
 * TypeScript SDK for virtual classroom and meeting integration
 */

// Export main client (renamed for backward compatibility)
export { MeetingClient } from "./cores/MeetingClient";
export { MeetingClient as ErmisClient } from "./cores/MeetingClient";
export { MeetingClient as default } from "./cores/MeetingClient";

// Export core classes
export { Room } from "./cores/Room";
export { Participant } from "./cores/Participant";
export { SubRoom } from "./cores/SubRoom";

// Export media classes
export { Publisher } from "./media/publisher/Publisher";
export { Subscriber } from "./media/subscriber/Subscriber";

// Export API client
export { ApiClient } from "./api/ApiClient";

// Export types
export type * from "./types/core/ermisClient.types";
export type * from "./types/core/participant.types";
export type * from "./types/media/subscriber.types";

// Export event emitter
export { EventEmitter } from "./events/EventEmitter";

