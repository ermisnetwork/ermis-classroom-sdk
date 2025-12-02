import {signRoomServiceToken} from "../utils/signRoomServiceToken";
import {HttpMethod, ParticipantPermissions} from "../types";
import Participant from "../cores/Participant";
import Room from "../cores/Room";

export class RoomServiceClient {
  private serviceToken: string = '';
  private apiHost: string = 'https://daibo.ermis.network:9993';
  
  constructor(apiHost: string, privateKeyOrPath: string) {
    this.serviceToken = signRoomServiceToken(privateKeyOrPath);
    this.apiHost = apiHost;
  }
  
  getParticipants(roomId: string): Promise<Participant[]> {
    throw new Error("Method not implemented.");
  }
  
  getRoom(roomId: string): Promise<Room> {
    throw new Error("Method not implemented.");
  }
  
  removeParticipant(roomId: string, participantId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  updateParticipant(roomId: string, participantId: string, newPermissions: ParticipantPermissions): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  updateRoom(roomId: string, updates: any): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  
  async call(method: HttpMethod, endpoint: string, body?: any): Promise<any> {
    const response = await fetch(`${this.apiHost}/${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }
}