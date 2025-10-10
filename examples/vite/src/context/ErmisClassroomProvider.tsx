import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErmisClassroomContext } from './ErmisClassroomContext';
import ErmisClassroom, { type Participant, type Room, MediaDeviceManager } from 'ermis-classroom-sdk';

interface ErmisClassroomConfig {
  host: string;
  debug?: boolean;
  webtpUrl: string;
  apiUrl?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

interface ErmisClassroomProviderProps {
  config: ErmisClassroomConfig;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  children: React.ReactNode;
}

export const ErmisClassroomProvider = ({ config, videoRef: initialVideoRef, children }: ErmisClassroomProviderProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const cfg = useMemo(
    () => ({
      host: config.host,
      debug: config.debug,
      webtpUrl: config.webtpUrl,
      apiUrl: config.apiUrl,
      reconnectAttempts: config.reconnectAttempts,
      reconnectDelay: config.reconnectDelay,
    }),
    [config.host, config.debug, config.webtpUrl, config.apiUrl, config.reconnectAttempts, config.reconnectDelay]
  );
  const cfgKey = useMemo(() => JSON.stringify(cfg), [cfg]);

  const [roomCode, setRoomCode] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [micEnabled, setMicEnabled] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [pinType, setPinType] = useState<'local' | 'everyone' | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [inRoom, setInRoom] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [devices, setDevices] = useState<any>(null);
  const [selectedDevices, setSelectedDevices] = useState<any>(null);

  const clientRef = useRef<any>(null);
  const deviceManagerRef = useRef<MediaDeviceManager | null>(null);
  const unsubRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (initialVideoRef?.current && localStream) {
      initialVideoRef.current.srcObject = localStream;
    }
  }, [initialVideoRef, localStream]);

  const setupEventListeners = useCallback((client: any) => {
    const events = ErmisClassroom.events;
    const unsubs: (() => void)[] = [];

    const on = (evt: string, handler: (...args: any[]) => void) => {
      client.on(evt, handler);
      if (typeof client.off === 'function') {
        unsubs.push(() => client.off(evt, handler));
      } else if (typeof client.removeListener === 'function') {
        unsubs.push(() => client.removeListener(evt, handler));
      }
    };

    on(events.LOCAL_STREAM_READY, (event: any) => {
      if (event.videoOnlyStream) {
        setLocalStream(event.videoOnlyStream);
      }
    });

    on(events.REMOTE_STREAM_READY, (event: any) => {
      setRemoteStreams(prev => {
        const updated = new Map(prev);
        updated.set(event.participant.userId, event.stream);
        return updated;
      });
    });

    on(events.ROOM_JOINED, (data: any) => {
      console.log('ROOM_JOINED', data);
    });

    on(events.PARTICIPANT_ADDED, (data: any) => {
      setParticipants(prev => new Map(prev.set(data.participant.userId, data.participant)));
    });

    on(events.PARTICIPANT_REMOVED, (data: any) => {
      setParticipants(prev => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        return updated;
      });
      setRemoteStreams(prev => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        return updated;
      });
    });

    on(events.ROOM_LEFT, (data: any) => {
      console.log('ROOM_LEFT', data);
    });

    on(events.REMOTE_AUDIO_STATUS_CHANGED, (data: any) => {
      setParticipants(prev => {
        const updated = new Map(prev);
        const p = updated.get(data.participant.userId);
        if (p) {
          p.isAudioEnabled = data.enabled;
          updated.set(data.participant.userId, p);
        }
        return updated;
      });
    });

    on(events.REMOTE_VIDEO_STATUS_CHANGED, (data: any) => {
      setParticipants(prev => {
        const updated = new Map(prev);
        const p = updated.get(data.participant.userId);
        if (p) {
          p.isVideoEnabled = data.enabled;
          updated.set(data.participant.userId, p);
        }
        return updated;
      });
    });

    on('audioToggled', (data: any) => {
      if (data.participant.isLocal) {
        setMicEnabled(data.enabled);
        setParticipants(prev => {
          const updated = new Map(prev);
          const p = updated.get(data.participant.userId);
          if (p) {
            p.isAudioEnabled = data.enabled;
            updated.set(data.participant.userId, p);
          }
          return updated;
        });
      }
    });

    on('videoToggled', (data: any) => {
      if (data.participant.isLocal) {
        setVideoEnabled(data.enabled);
        setParticipants(prev => {
          const updated = new Map(prev);
          const p = updated.get(data.participant.userId);
          if (p) {
            p.isVideoEnabled = data.enabled;
            updated.set(data.participant.userId, p);
          }
          return updated;
        });
      }
    });

    on('handRaiseToggled', (data: any) => {
      if (data.participant.isLocal) {
        setHandRaised(data.enabled);
        setParticipants(prev => {
          const updated = new Map(prev);
          const p = updated.get(data.participant.userId);
          if (p) {
            p.isHandRaised = data.enabled;
            updated.set(data.participant.userId, p);
          }
          return updated;
        });
      }
    });

    on(events.SCREEN_SHARE_STARTED, (data: any) => {
      console.log('SCREEN_SHARE_STARTED', data);
    });
    
    on(events.SCREEN_SHARE_STOPPED, (data: any) => {
      console.log('SCREEN_SHARE_STOPPED', data);
    });

    on(events.REMOTE_SCREEN_SHARE_STARTED, (data: any) => {
      setParticipants(prev => {
        const updated = new Map(prev);
        const p = updated.get(data.participant.userId);
        if (p) {
          (p as any).isScreenSharing = true;
          updated.set(data.participant.userId, p);
        }
        return updated;
      });
    });

    on(events.REMOTE_SCREEN_SHARE_STOPPED, (data: any) => {
      setParticipants(prev => {
        const updated = new Map(prev);
        const p = updated.get(data.participant.userId);
        if (p) {
          (p as any).isScreenSharing = false;
          updated.set(data.participant.userId, p);
        }
        return updated;
      });
    });

    on(events.PARTICIPANT_PINNED_FOR_EVERYONE, () => {
      setPinType('everyone');
      setParticipants(prev => new Map(prev));
    });

    on(events.PARTICIPANT_UNPINNED_FOR_EVERYONE, () => {
      setPinType(null);
      setParticipants(prev => new Map(prev));
    });

    on(events.REMOTE_HAND_RAISING_STATUS_CHANGED, (data: any) => {
      setParticipants(prev => {
        const updated = new Map(prev);
        const p = updated.get(data.participant.userId);
        if (p) {
          p.isHandRaised = data.raised;
          updated.set(data.participant.userId, p);
        }
        return updated;
      });
    });

    on(events.ERROR, (data: any) => {
      console.error(`SDK Error in ${data.action}:`, data.error?.message);
    });

    return unsubs;
  }, []);

  useEffect(() => {
    if (clientRef.current) {
      if (typeof clientRef.current.updateConfig === 'function') {
        clientRef.current.updateConfig(cfg);
        return;
      }
      try {
        unsubRef.current.forEach(fn => fn());
      } catch {}
      unsubRef.current = [];
      try {
        clientRef.current.destroy?.();
      } catch {}
      clientRef.current = null;
    }

    const client = ErmisClassroom.create(cfg);
    clientRef.current = client;

    const off = setupEventListeners(client);
    unsubRef.current = off;

    return () => {
      try {
        unsubRef.current.forEach(fn => fn());
      } catch {}
      unsubRef.current = [];
      try {
        clientRef.current?.destroy?.();
      } catch {}
      clientRef.current = null;
    };
  }, [cfgKey, setupEventListeners]);

  useEffect(() => {
    const initDeviceManager = async () => {
      try {
        const manager = new MediaDeviceManager();
        await manager.initialize();

        deviceManagerRef.current = manager;
        setDevices(manager.getDevices());
        setSelectedDevices(manager.getSelectedDevices());

        manager.on('devicesChanged', (newDevices: any) => {
          setDevices(newDevices);
        });

        manager.on('deviceSelected', () => {
          setSelectedDevices(manager.getSelectedDevices());
        });
      } catch (error) {
        console.error('Failed to initialize device manager:', error);
      }
    };

    initDeviceManager();

    return () => {
      deviceManagerRef.current?.destroy();
      deviceManagerRef.current = null;
    };
  }, []);

  const authenticate = useCallback(async (userIdToAuth: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('Client not initialized');
    setUserId(userIdToAuth);
    await client.authenticate(userIdToAuth);
  }, []);

  const joinRoom = useCallback(async (code: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('Client not initialized');
    const result = await client.joinRoom(code);
    setCurrentRoom(result.room);
    setRoomCode(code);
    setInRoom(true);

    setParticipants(prev => {
      const map = new Map(prev);
      result.participants.forEach((p: Participant) => {
        map.set(p.userId, p);
        if (p.isLocal) {
          setMicEnabled(p.isAudioEnabled);
          setVideoEnabled(p.isVideoEnabled);
          setHandRaised((p as any).isHandRaised || false);
        }
      });
      return map;
    });
  }, []);

  const leaveRoom = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !inRoom) return;
    await client.leaveRoom();
    setInRoom(false);
    setCurrentRoom(null);
    setParticipants(new Map());
    setRemoteStreams(new Map());
    setMicEnabled(true);
    setVideoEnabled(true);
    setHandRaised(false);
    setPinType(null);
    setRoomCode(undefined);
  }, [inRoom]);

  const toggleMicrophone = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleMicrophone();
    setMicEnabled(p.isAudioEnabled);
    setParticipants(prev => {
      const updated = new Map(prev);
      updated.set(userId, p);
      return updated;
    });
  }, [participants, userId]);

  const toggleCamera = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleCamera();
    setVideoEnabled(p.isVideoEnabled);
    setParticipants(prev => {
      const updated = new Map(prev);
      updated.set(userId, p);
      return updated;
    });
  }, [participants, userId]);

  const toggleRaiseHand = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleRaiseHand();
    setHandRaised(p.isHandRaised);
    setParticipants(prev => {
      const updated = new Map(prev);
      updated.set(userId, p);
      return updated;
    });
  }, [participants, userId]);

  const togglePin = useCallback(
    async (participantId: string, pinFor: 'local' | 'everyone') => {
      if (!currentRoom) return;
      const target = currentRoom.getParticipant(participantId);
      if (!target) return;

      const local = currentRoom.localParticipant as any;
      if (!local?.publisher) return;

      const isPinned = currentRoom.pinnedParticipant?.userId === participantId;

      setParticipants(prev => {
        const updated = new Map(prev);
        updated.set(participantId, target);
        return updated;
      });

      if (pinFor === 'everyone') {
        if (isPinned) {
          await local.publisher.unpinForEveryone(target.streamId);
        } else {
          await local.publisher.pinForEveryone(target.streamId);
        }
      }
    },
    [currentRoom]
  );

  const switchCamera = useCallback(async (deviceId: string) => {
    if (!deviceManagerRef.current || !currentRoom) return;

    try {
      deviceManagerRef.current.selectCamera(deviceId);
      const local = currentRoom.localParticipant as any;
      if (local?.publisher) {
        const result = await local.publisher.switchCamera(deviceId);

        if (result?.videoOnlyStream) {
          setLocalStream(result.videoOnlyStream);
        }
      }
    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  }, [currentRoom]);

  const switchMicrophone = useCallback(async (deviceId: string) => {
    if (!deviceManagerRef.current || !currentRoom) return;

    try {
      deviceManagerRef.current.selectMicrophone(deviceId);
      const local = currentRoom.localParticipant as any;
      if (local?.publisher) {
        const result = await local.publisher.switchMicrophone(deviceId);

        if (result?.videoOnlyStream) {
          setLocalStream(result.videoOnlyStream);
        }
      }
    } catch (error) {
      console.error('Failed to switch microphone:', error);
    }
  }, [currentRoom]);

  const value = useMemo(
    () => ({
      client: clientRef.current,
      participants,
      remoteStreams,
      localStream,
      micEnabled,
      handRaised,
      pinType,
      authenticate,
      joinRoom,
      currentRoom,
      inRoom,
      videoEnabled,
      leaveRoom,
      roomCode,
      userId,
      toggleMicrophone,
      toggleCamera,
      toggleRaiseHand,
      togglePin,
      devices,
      selectedDevices,
      switchCamera,
      switchMicrophone,
    }),
    [
      participants,
      remoteStreams,
      localStream,
      micEnabled,
      handRaised,
      pinType,
      authenticate,
      joinRoom,
      currentRoom,
      inRoom,
      videoEnabled,
      leaveRoom,
      roomCode,
      userId,
      toggleMicrophone,
      toggleCamera,
      toggleRaiseHand,
      togglePin,
      devices,
      selectedDevices,
      switchCamera,
      switchMicrophone,
    ]
  );

  return (
    <ErmisClassroomContext.Provider value={value}>
      {children}
    </ErmisClassroomContext.Provider>
  );
};

