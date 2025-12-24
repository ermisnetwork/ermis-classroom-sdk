/**
 * ErmisClassroomProvider - React Provider for Ermis Classroom SDK
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErmisClassroom, {
  log,
  MediaDeviceManager,
  type MediaDevices,
  type Participant,
  type Room,
  ROOM_EVENTS,
  type SelectedDevices,
} from '@ermisnetwork/ermis-classroom-sdk';
import { ErmisClassroomContext } from './ErmisClassroomContext';
import type { ErmisClassroomContextValue, ErmisClassroomProviderProps, ScreenShareData, } from '../types';

/**
 * Provider component that wraps the Ermis Classroom SDK
 * Manages SDK lifecycle, event subscriptions, and state
 */
export function ErmisClassroomProvider({
  config,
  children,
}: ErmisClassroomProviderProps) {
  // Local media state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  // Memoize config to prevent unnecessary re-renders
  const cfg = useMemo(() => ({
    host: config.host,
    hostNode: config.hostNode,
    debug: config.debug,
    webtpUrl: config.webtpUrl,
    apiUrl: config.apiUrl,
    reconnectAttempts: config.reconnectAttempts,
    reconnectDelay: config.reconnectDelay,
  }), [config.host, config.hostNode, config.debug, config.webtpUrl, config.apiUrl, config.reconnectAttempts, config.reconnectDelay]);
  const cfgKey = useMemo(() => JSON.stringify(cfg), [cfg]);

  // Room state
  const [roomCode, setRoomCode] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [inRoom, setInRoom] = useState(false);

  // Participants state
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const participantsRef = useRef<Map<string, Participant>>(new Map());
  const updateTimeoutRef = useRef<any>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  // Media state
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareStreams, setScreenShareStreams] = useState<Map<string, ScreenShareData>>(new Map());

  // Pin/Hand state
  const [handRaised, setHandRaised] = useState(false);
  const [pinType, setPinType] = useState<'local' | 'everyone' | null>(null);

  // Device state
  const [devices, setDevices] = useState<MediaDevices | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<SelectedDevices | null>(null);

  // Refs
  const clientRef = useRef<any>(null);
  const deviceManagerRef = useRef<MediaDeviceManager | null>(null);
  const unsubRef = useRef<(() => void)[]>([]);

  // Debounced update function to batch participant changes
  const scheduleParticipantsUpdate = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    updateTimeoutRef.current = setTimeout(() => {
      setParticipants(new Map(participantsRef.current));
      updateTimeoutRef.current = null;
    }, 16); // ~60fps
  }, []);

  // Setup event listeners
  const setupEventListeners = useCallback((client: any) => {
    const events = ROOM_EVENTS;
    const unsubs: (() => void)[] = [];

    const on = (evt: string, handler: (...args: any[]) => void) => {
      client.on(evt, handler);
      if (typeof client.off === 'function') {
        unsubs.push(() => client.off(evt, handler));
      } else if (typeof client.removeListener === 'function') {
        unsubs.push(() => client.removeListener(evt, handler));
      }
    };

    // Local stream ready
    on(events.LOCAL_STREAM_READY, (event: any) => {
      if (event.videoOnlyStream) {
        setLocalStream(event.videoOnlyStream);
      }
      // Sync initial enabled state from the stream
      if (typeof event.videoEnabled === 'boolean') {
        setVideoEnabled(event.videoEnabled);
      }
      if (typeof event.audioEnabled === 'boolean') {
        setMicEnabled(event.audioEnabled);
      }
    });

    // Local screen share ready
    on(events.LOCAL_SCREEN_SHARE_READY, (event: any) => {
      if (event.videoOnlyStream && event.participant) {
        setIsScreenSharing(true);
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.set(event.participant.userId, {
            id: event.participant.userId,
            stream: event.videoOnlyStream,
            userName: event.participant.name || event.participant.userId,
          });
          return updated;
        });
      }
    });

    // Remote stream ready
    on(events.REMOTE_STREAM_READY, (event: any) => {
      setRemoteStreams((prev) => {
        const updated = new Map(prev);
        updated.set(event.participant.userId, event.stream);
        return updated;
      });
    });

    // Participant added
    on(events.PARTICIPANT_ADDED, (data: any) => {
      setParticipants((prev) => {
        participantsRef.current = new Map(prev.set(data.participant.userId, data.participant));
        return participantsRef.current;
      });
    });

    // Participant removed
    on(events.PARTICIPANT_REMOVED, (data: any) => {
      setParticipants((prev) => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        participantsRef.current = updated;
        return updated;
      });
      setRemoteStreams((prev) => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        return updated;
      });
    });

    // Audio/Video status changes
    on(events.REMOTE_AUDIO_STATUS_CHANGED, (data: any) => {
      const p = participantsRef.current.get(data.participant.userId);
      if (p) {
        scheduleParticipantsUpdate();
      }
    });

    on(events.REMOTE_VIDEO_STATUS_CHANGED, (data: any) => {
      const p = participantsRef.current.get(data.participant.userId);
      if (p) {
        scheduleParticipantsUpdate();
      }
    });

    // Audio toggled (local)
    on(events.AUDIO_TOGGLED, (data: any) => {
      if (data.participant.isLocal) {
        setMicEnabled(data.enabled);
      }
    });

    // Video toggled (local)
    on(events.VIDEO_TOGGLED, (data: any) => {
      if (data.participant.isLocal) {
        setVideoEnabled(data.enabled);
      }
    });

    // Hand raise toggled
    on(events.HAND_RAISE_TOGGLED, (data: any) => {
      if (data.participant.isLocal) {
        setHandRaised(data.enabled);
      }
    });

    // Screen share events
    on(events.SCREEN_SHARE_STARTED, (data: any) => {
      setIsScreenSharing(true);
      const stream = data.stream;
      const participant = data.participant;
      if (stream && participant) {
        const videoOnlyStream = new MediaStream();
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoOnlyStream.addTrack(videoTracks[0]);
        }
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.set(participant.userId, {
            id: participant.userId,
            stream: videoOnlyStream.getTracks().length > 0 ? videoOnlyStream : stream,
            userName: participant.name || participant.userId,
          });
          return updated;
        });
      }
    });

    on(events.SCREEN_SHARE_STOPPED, (data: any) => {
      setIsScreenSharing(false);
      const participantUserId = data.participant?.userId || data.room?.localParticipant?.userId;
      if (participantUserId) {
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(participantUserId);
          return updated;
        });
      }
    });

    on(events.REMOTE_SCREEN_SHARE_STARTED, (data: any) => {
      setParticipants((prev) => {
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
      setParticipants((prev) => {
        const updated = new Map(prev);
        const p = updated.get(data.participant.userId);
        if (p) {
          (p as any).isScreenSharing = false;
          updated.set(data.participant.userId, p);
        }
        return updated;
      });
      setScreenShareStreams((prev) => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        return updated;
      });
    });

    on(events.REMOTE_SCREEN_SHARE_STREAM_READY, (data: any) => {
      if (data.stream && data.participant) {
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.set(data.participant.userId, {
            id: data.participant.userId,
            stream: data.stream,
            userName: data.participant.name || data.participant.userId,
          });
          return updated;
        });
      }
    });

    // Pin events
    on(events.PARTICIPANT_PINNED_FOR_EVERYONE, () => {
      setPinType('everyone');
      setParticipants((prev) => new Map(prev));
    });

    on(events.PARTICIPANT_UNPINNED_FOR_EVERYONE, () => {
      setPinType(null);
      setParticipants((prev) => new Map(prev));
    });

    // Hand raising status
    on(events.REMOTE_HAND_RAISING_STATUS_CHANGED, (data: any) => {
      const p = participantsRef.current.get(data.participant.userId);
      if (p) {
        scheduleParticipantsUpdate();
      }
    });

    // Sub-room events
    on(events.SUB_ROOM_CREATED, (data: any) => {
      setCurrentRoom(data.room);
      setParticipants(data.room.participants);
    });

    on(events.SUB_ROOM_JOINED, (data: any) => {
      setCurrentRoom(data.room);
      setParticipants(data.room.currentSubRoom?.participants || new Map());
    });

    on(events.SUB_ROOM_LEFT, (data: any) => {
      setCurrentRoom(data.room);
      setParticipants(data.room.participants);
    });

    // Error handling
    on(events.ERROR, (data: any) => {
      console.error(`SDK Error in ${data.action}:`, data.error?.message);
    });

    return unsubs;
  }, [scheduleParticipantsUpdate]);

  // Effect: Setup client
  useEffect(() => {
    if (clientRef.current) {
      if (typeof clientRef.current.updateConfig === 'function') {
        try {
          clientRef.current.updateConfig(cfg);
          return;
        } catch (e) {
          console.warn('updateConfig failed, will recreate client:', e);
        }
      }
      if (inRoom) {
        console.warn('Cannot recreate client while in room - config change ignored');
        return;
      }
      try {
        unsubRef.current.forEach((fn) => fn());
      } catch {
      }
      unsubRef.current = [];
      try {
        clientRef.current?.cleanup?.();
      } catch (e) {
        console.error('[Provider] Cleanup before recreation failed:', e);
      }
      clientRef.current = null;
    }

    const client = ErmisClassroom.create(cfg);
    clientRef.current = client;
    unsubRef.current = setupEventListeners(client);

    // Initialize MediaDeviceManager
    const deviceManager = new MediaDeviceManager();
    deviceManagerRef.current = deviceManager;

    // Set up device manager event listeners
    const handleDevicesChanged = () => {
      setDevices(deviceManager.getDevices());
      setSelectedDevices(deviceManager.getSelectedDevices());
    };

    const handleDeviceSelected = () => {
      setSelectedDevices(deviceManager.getSelectedDevices());
    };

    deviceManager.on('devicesChanged', handleDevicesChanged as any);
    deviceManager.on('deviceSelected', handleDeviceSelected as any);

    // Initialize device manager
    deviceManager.initialize().then(() => {
      setDevices(deviceManager.getDevices());
      setSelectedDevices(deviceManager.getSelectedDevices());
    }).catch((err) => {
      console.warn('Failed to initialize MediaDeviceManager:', err);
    });

    // Add cleanup for device manager
    unsubRef.current.push(() => {
      deviceManager.off('devicesChanged', handleDevicesChanged as any);
      deviceManager.off('deviceSelected', handleDeviceSelected as any);
      deviceManager.destroy();
      deviceManagerRef.current = null;
    });
  }, [cfgKey, setupEventListeners, inRoom, cfg]);

  // Effect: Re-authentication
  useEffect(() => {
    if (clientRef.current && isAuthenticated && userId) {
      clientRef.current.authenticate(userId).catch((e: any) => {
        console.error('Re-authentication failed:', e);
        setIsAuthenticated(false);
      });
    }
  }, [isAuthenticated, userId]);

  // Effect: Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        unsubRef.current.forEach((fn) => fn());
      } catch {
      }
      unsubRef.current = [];
      try {
        clientRef.current?.cleanup?.();
      } catch (e) {
        console.error('[Provider] Unmount cleanup failed:', e);
      }
      clientRef.current = null;
    };
  }, []);

  // Actions
  const authenticate = useCallback(async (userIdToAuth: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('Client not initialized');
    setUserId(userIdToAuth);
    await client.authenticate(userIdToAuth);
    setIsAuthenticated(true);
  }, []);

  const joinRoom = useCallback(
    async (code: string, customStream?: MediaStream) => {
      const client = clientRef.current;
      if (!client) throw new Error('Client not initialized');

      try {
        const result = await client.joinRoom(code, customStream);
        setCurrentRoom(result.room);
        setRoomCode(code);
        setInRoom(true);

        setParticipants((prev) => {
          const map = new Map(prev);
          result.participants.forEach((p: Participant) => {
            map.set(p.userId, p);
            if (p.isLocal) {
              setMicEnabled(p.isAudioEnabled);
              setVideoEnabled(p.isVideoEnabled);
              setHandRaised((p as any).isHandRaised || false);
            }
          });
          participantsRef.current = map;
          return map;
        });

        if (previewStream) {
          setPreviewStream(null);
        }
      } catch (error: any) {
        if (error.message?.includes('authenticated')) {
          console.warn('Authentication required, resetting auth state');
          setIsAuthenticated(false);
        }
        throw error;
      }
    },
    [previewStream]
  );

  const leaveRoom = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !inRoom) return;
    await client.leaveRoom();
    setInRoom(false);
    setCurrentRoom(null);
    const emptyMap = new Map();
    participantsRef.current = emptyMap;
    setParticipants(emptyMap);
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
  }, [participants, userId]);

  const toggleCamera = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleCamera();
  }, [participants, userId]);

  const toggleRaiseHand = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleRaiseHand();
  }, [participants, userId]);

  const togglePin = useCallback(
    async (participantId: string, pinFor: 'local' | 'everyone', action?: 'pin' | 'unpin') => {
      if (!currentRoom) return;
      const target = currentRoom.getParticipant(participantId);
      if (!target) return;

      const local = currentRoom.localParticipant;
      if (!local) return;

      // Use explicit action if provided, otherwise infer from currentRoom state
      const roomIsPinned = currentRoom.pinnedParticipant?.userId === participantId;
      const shouldUnpin = action === 'unpin' || (action === undefined && roomIsPinned);

      log('[Provider] togglePin:', {
        participantId,
        pinFor,
        action,
        roomIsPinned,
        shouldUnpin,
        pinnedParticipant: currentRoom.pinnedParticipant?.userId
      });

      setParticipants((prev) => {
        const updated = new Map(prev);
        updated.set(participantId, target);
        return updated;
      });

      if (pinFor === 'everyone') {
        if (shouldUnpin) {
          log('[Provider] Calling unPinForEveryone');
          await local.unPinForEveryone(target.streamId);
        } else {
          log('[Provider] Calling pinForEveryone');
          await local.pinForEveryone(target.streamId);
        }
      }
    },
    [currentRoom]
  );

  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!deviceManagerRef.current) return;
      try {
        deviceManagerRef.current.selectCamera(deviceId);
        setSelectedDevices({ ...deviceManagerRef.current.getSelectedDevices() });

        if (currentRoom) {
          const local = currentRoom.localParticipant as any;
          if (local?.publisher) {
            const result = await local.publisher.switchVideoDevice(deviceId);
            if (result?.videoOnlyStream) {
              setLocalStream(result.videoOnlyStream);
            }
          }
        }
      } catch (error) {
        console.error('Failed to switch camera:', error);
      }
    },
    [currentRoom]
  );

  const switchMicrophone = useCallback(
    async (deviceId: string) => {
      if (!deviceManagerRef.current) return;
      try {
        deviceManagerRef.current.selectMicrophone(deviceId);
        setSelectedDevices({ ...deviceManagerRef.current.getSelectedDevices() });

        if (currentRoom) {
          const local = currentRoom.localParticipant as any;
          if (local?.publisher) {
            await local.publisher.switchAudioDevice(deviceId);
          }
        }
      } catch (error) {
        console.error('Failed to switch microphone:', error);
      }
    },
    [currentRoom]
  );

  const getPreviewStream = useCallback(
    async (cameraId?: string, micId?: string) => {
      try {
        // Use MediaDeviceManager if available
        if (deviceManagerRef.current) {
          const constraints: MediaStreamConstraints = {
            video: true,
            audio: true,
          };

          // Apply specific device IDs if provided
          if (cameraId) {
            deviceManagerRef.current.selectCamera(cameraId);
          }
          if (micId) {
            deviceManagerRef.current.selectMicrophone(micId);
          }

          const stream = await deviceManagerRef.current.getUserMedia(constraints);
          setPreviewStream(stream);
          setSelectedDevices(deviceManagerRef.current.getSelectedDevices());
          return stream;
        }

        // Fallback to direct getUserMedia
        const constraints: any = {};
        if (cameraId || selectedDevices?.camera) {
          constraints.video = {
            deviceId: { exact: cameraId || selectedDevices?.camera },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          };
        } else {
          constraints.video = true;
        }
        if (micId || selectedDevices?.microphone) {
          constraints.audio = {
            deviceId: { exact: micId || selectedDevices?.microphone },
            echoCancellation: true,
            noiseSuppression: true,
          };
        } else {
          constraints.audio = true;
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setPreviewStream(stream);
        return stream;
      } catch (error) {
        console.error('Failed to get preview stream:', error);
        throw error;
      }
    },
    [selectedDevices]
  );

  const stopPreviewStream = useCallback(() => {
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
      setPreviewStream(null);
    }
  }, [previewStream]);

  const replaceMediaStream = useCallback(
    async (newStream: MediaStream) => {
      if (!currentRoom) return;
      try {
        const local = currentRoom.localParticipant as any;
        if (local?.publisher) {
          const result = await local.replaceMediaStream(newStream);
          if (result?.videoOnlyStream) {
            setLocalStream(result.videoOnlyStream);
          }
          setMicEnabled(result.hasAudio);
          setVideoEnabled(result.hasVideo);
        }
      } catch (error) {
        console.error('Failed to replace media stream:', error);
        throw error;
      }
    },
    [currentRoom]
  );

  const toggleScreenShare = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    try {
      await p.toggleScreenShare();
    } catch (error) {
      console.error('Failed to toggle screen share:', error);
      setIsScreenSharing(false);
    }
  }, [participants, userId]);

  const sendCustomEvent = useCallback(
    async (eventType: string, data: any) => {
      const client = clientRef.current;
      if (!client) throw new Error('Client not initialized');
      if (!inRoom) throw new Error('Not in a room');
      try {
        await client.sendCustomEvent(eventType, data);
      } catch (error) {
        console.error('Failed to send custom event:', error);
        throw error;
      }
    },
    [inRoom]
  );

  // SubRoom methods
  const createSubRoom = useCallback(async (config: any) => {
    const client = clientRef.current;
    if (!client || !currentRoom) {
      throw new Error('Client or current room not available');
    }

    try {
      const result = await currentRoom.createSubRoom(config);
      return result;
    } catch (error) {
      console.error('Failed to create sub room:', error);
      throw error;
    }
  }, [currentRoom]);

  const closeSubRoom = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !currentRoom) {
      throw new Error('Client or current room not available');
    }

    try {
      const result = await currentRoom.closeSubRoom();
      return result;
    } catch (error) {
      console.error('Failed to close sub room:', error);
      throw error;
    }
  }, [currentRoom]);

  // Context value
  const value: ErmisClassroomContextValue = useMemo(
    () => ({
      client: clientRef.current,
      participants,
      remoteStreams,
      localStream,
      previewStream,
      micEnabled,
      handRaised,
      pinType,
      authenticate,
      isAuthenticated,
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
      getPreviewStream,
      stopPreviewStream,
      replaceMediaStream,
      screenShareStreams,
      isScreenSharing,
      toggleScreenShare,
      sendCustomEvent,
      createSubRoom,
      closeSubRoom,
    }),
    [
      participants,
      remoteStreams,
      localStream,
      previewStream,
      micEnabled,
      handRaised,
      pinType,
      screenShareStreams,
      isScreenSharing,
      authenticate,
      isAuthenticated,
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
      getPreviewStream,
      stopPreviewStream,
      replaceMediaStream,
      toggleScreenShare,
      sendCustomEvent,
      createSubRoom,
      closeSubRoom,
    ]
  );

  return (
    <ErmisClassroomContext.Provider value={value}>
      {children}
    </ErmisClassroomContext.Provider>
  );
}
