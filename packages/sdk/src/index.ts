/**
 * Ermis Classroom SDK
 * TypeScript SDK for virtual classroom and meeting integration
 */

// Export main client (renamed for backward compatibility)
export {MeetingClient} from "./cores/MeetingClient";
export {MeetingClient as ErmisClient} from "./cores/MeetingClient";
export {MeetingClient as default} from "./cores/MeetingClient";

// Export core classes
export {Room} from "./cores/Room";
export {Participant} from "./cores/Participant";
export {SubRoom} from "./cores/SubRoom";

// Export media components
export {Publisher} from "./media/publisher/Publisher";
export {Subscriber} from "./media/subscriber/Subscriber";
export {MediaDeviceManager} from "./media/devices/MediaDeviceManager";

// Export constants
export {RoomTypes} from "./types/core/room.types";
export {StreamTypes} from "./types/media/publisher.types";
export {MEETING_EVENTS} from "./constants/publisherConstants";
export {ROOM_EVENTS} from "./constants/roomEvents";
export {ConnectionStatus} from "./constants/connectionStatus";
export {ParticipantRoles} from "./constants/participantRoles";
export {VERSION} from "./constants/version";

// Export utilities
export * from './utils';
export * from './types';

// Export API client
export {ApiClient} from "./api/ApiClient";

// Export event emitter
export {EventEmitter} from "./events/EventEmitter";

// Export global event bus for advanced use cases
export {globalEventBus, GlobalEvents} from "./events/GlobalEventBus";
export type {GlobalEventMap} from "./events/GlobalEventBus";

