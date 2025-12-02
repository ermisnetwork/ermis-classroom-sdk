import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErmisClassroomContext } from "./ErmisClassroomContext";
import ErmisClassroom, {
  type Participant,
  type Room,
  // TODO: MediaDeviceManager not yet migrated to TypeScript SDK
  // MediaDeviceManager,
} from "@ermisnetwork/ermis-classroom-sdk";

interface ErmisClassroomConfig {
  host: string;
  debug?: boolean;
  webtpUrl: string;
  apiUrl?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  // for testing only
  publishProtocol?: string
  subscribeProtocol?: string
  hostNode?: string

}

interface ErmisClassroomProviderProps {
  config: ErmisClassroomConfig;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  children: React.ReactNode;
}
export interface ScreenShareData {
  userName: string;
  stream: MediaStream | null; // adjust based on your actual stream type
}
export const ErmisClassroomProvider = ({
  config,
  videoRef: initialVideoRef,
  children,
}: ErmisClassroomProviderProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const cfg = useMemo(
    () => ({
      host: config.host,
      debug: config.debug,
      webtpUrl: config.webtpUrl,
      apiUrl: config.apiUrl,
      reconnectAttempts: config.reconnectAttempts,
      reconnectDelay: config.reconnectDelay,
      publishProtocol: config.publishProtocol,
      subscribeProtocol: config.subscribeProtocol,
      hostNode: config.hostNode,
    }),
    [
      config.host,
      config.debug,
      config.webtpUrl,
      config.apiUrl,
      config.reconnectAttempts,
      config.reconnectDelay,
      config.publishProtocol,
      config.subscribeProtocol,
      config.hostNode,
    ]
  );
  const cfgKey = useMemo(() => JSON.stringify(cfg), [cfg]);

  const [roomCode, setRoomCode] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [participants, setParticipants] = useState<Map<string, Participant>>(
    new Map()
  );
  const participantsRef = useRef<Map<string, Participant>>(new Map());
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );
  const [micEnabled, setMicEnabled] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [pinType, setPinType] = useState<"local" | "everyone" | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [inRoom, setInRoom] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  // TODO: Re-enable setters when MediaDeviceManager is migrated
  const [devices] = useState<any>(null);
  const [selectedDevices] = useState<any>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareStreams, setScreenShareStreams] = useState<Map<string, ScreenShareData>>(new Map());

  const clientRef = useRef<any>(null);
  // TODO: MediaDeviceManager not yet migrated to TypeScript SDK
  // const deviceManagerRef = useRef<MediaDeviceManager | null>(null);
  const deviceManagerRef = useRef<any>(null);
  const unsubRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (initialVideoRef?.current && localStream) {
      initialVideoRef.current.srcObject = localStream;
    }
  }, [initialVideoRef, localStream]);



  const setupEventListeners = useCallback((client: any) => {
    const events = ErmisClassroom.events;
    const unsubs: (() => void)[] = [];

    // Debounced update function to batch participant changes
    const scheduleParticipantsUpdate = () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = setTimeout(() => {
        setParticipants(new Map(participantsRef.current));
        updateTimeoutRef.current = null;
      }, 16); // ~60fps
    };

    const on = (evt: string, handler: (...args: any[]) => void) => {
      client.on(evt, handler);
      if (typeof client.off === "function") {
        unsubs.push(() => client.off(evt, handler));
      } else if (typeof client.removeListener === "function") {
        unsubs.push(() => client.removeListener(evt, handler));
      }
    };

    // TODO! Define proper types for events
    on(events.LOCAL_STREAM_READY, (event: any) => {
      if (event.videoOnlyStream) {
        setLocalStream(event.videoOnlyStream);
      }
    });

    // Listen for local screen share ready - use both event name and constant
    on("localScreenShareReady", (event: any) => {
      if (event.videoOnlyStream && event.participant) {
        setIsScreenSharing(true);
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.set(event.participant.userId, {
            stream: event.videoOnlyStream,
            userName: event.participant.name || event.participant.userId,
          });
          return updated;
        });
      }
    });

    on(events.REMOTE_STREAM_READY, (event: any) => {
      setRemoteStreams((prev) => {
        const updated = new Map(prev);
        updated.set(event.participant.userId, event.stream);
        return updated;
      });
    });

    on(events.ROOM_JOINED, () => {
      // Room joined event
    });

    on(events.PARTICIPANT_ADDED, (data: any) => {

      setParticipants((prev) => {
        participantsRef.current = new Map(prev.set(data.participant.userId, data.participant));
        return participantsRef.current;
      });
    });

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

    on(events.ROOM_LEFT, () => {
      // Room left event
    });

    on(events.REMOTE_AUDIO_STATUS_CHANGED, (data: any) => {
      const p = participantsRef.current.get(data.participant.userId);
      if (p) {
        // Participant object already mutated, schedule batched update
        scheduleParticipantsUpdate();
      }
    });

    on(events.REMOTE_VIDEO_STATUS_CHANGED, (data: any) => {
      const p = participantsRef.current.get(data.participant.userId);
      if (p) {
        // Participant object already mutated, schedule batched update
        scheduleParticipantsUpdate();
      }
    });

    on("audioToggled", (data: any) => {
      if (data.participant.isLocal) {
        setMicEnabled(data.enabled);
        // Don't update participants Map - server will broadcast remoteAudioStatusChanged
      }
    });

    on("videoToggled", (data: any) => {
      if (data.participant.isLocal) {
        setVideoEnabled(data.enabled);
        // Don't update participants Map - server will broadcast remoteVideoStatusChanged
      }
    });

    on("handRaiseToggled", (data: any) => {
      if (data.participant.isLocal) {
        setHandRaised(data.enabled);
        // Don't update participants Map - server will broadcast remoteHandRaisingStatusChanged
      }
    });

    on(events.SCREEN_SHARE_STARTED, (data: any) => {
      setIsScreenSharing(true);

      const stream = data.stream;
      const participant = data.participant;

      if (stream && participant) {
        // Create video-only stream for display
        const videoOnlyStream = new MediaStream();
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoOnlyStream.addTrack(videoTracks[0]);
        }

        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.set(participant.userId, {
            stream: videoOnlyStream.getTracks().length > 0 ? videoOnlyStream : stream,
            userName: participant.name || participant.userId,
          });
          return updated;
        });
      }
    });

    on(events.SCREEN_SHARE_STOPPED, (data: any) => {
      setIsScreenSharing(false);
      // Use data.room to get local participant's userId
      if (data.room && data.room.localParticipant) {
        const localUserId = data.room.localParticipant.userId;
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(localUserId);
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

    // Listen for remote screen share stream ready
    on(events.REMOTE_SCREEN_SHARE_STREAM_READY, (data: any) => {
      if (data.stream && data.participant) {
        setScreenShareStreams((prev) => {
          const updated = new Map(prev);
          updated.set(data.participant.userId, {
            stream: data.stream,
            userName: data.participant.name || data.participant.userId,
          });
          return updated;
        });
      }
    });

    on(events.PARTICIPANT_PINNED_FOR_EVERYONE, () => {
      setPinType("everyone");
      setParticipants((prev) => new Map(prev));
    });

    on(events.PARTICIPANT_UNPINNED_FOR_EVERYONE, () => {
      setPinType(null);
      setParticipants((prev) => new Map(prev));
    });

    on(events.REMOTE_HAND_RAISING_STATUS_CHANGED, (data: any) => {
      const p = participantsRef.current.get(data.participant.userId);
      if (p) {
        // Participant object already mutated, schedule batched update
        scheduleParticipantsUpdate();
      }
    });

    // SubRoom event handlers
    on("subRoomCreated", (data: any) => {
      setCurrentRoom(data.room);
      setParticipants(data.room.participants);
    });

    on("subRoomJoined", (data: any) => {
      setCurrentRoom(data.room);
      setParticipants(data.room.currentSubRoom?.participants || new Map());
    });

    on("subRoomLeft", (data: any) => {
      setCurrentRoom(data.room);
      setParticipants(data.room.participants);
    });

    on(events.ERROR, (data: any) => {
      console.error(`SDK Error in ${data.action}:`, data.error?.message);
    });

    return unsubs;
  }, []);

  // Effect 1: Setup client (only re-run when config changes)
  useEffect(() => {
    if (clientRef.current) {
      if (typeof clientRef.current.updateConfig === "function") {
        try {
          clientRef.current.updateConfig(cfg);
          console.log("Updated client config without recreating:", cfg);
          return;
        } catch (e) {
          console.warn("updateConfig failed, will recreate client:", e);
        }
      }

      // Only recreate client if in room state would be preserved
      if (inRoom) {
        console.warn("Cannot recreate client while in room - config change ignored");
        return;
      }

      console.log("[Provider] Cleaning up old client before recreation...");
      try {
        unsubRef.current.forEach((fn) => fn());
      } catch { }
      unsubRef.current = [];
      try {
        // Use hard cleanup when recreating (not in room)
        clientRef.current?.cleanup?.();
      } catch (e) {
        console.error("[Provider] Cleanup before recreation failed:", e);
      }
      clientRef.current = null;
    }

    const client = ErmisClassroom.create(cfg);
    clientRef.current = client;

    const off = setupEventListeners(client);
    unsubRef.current = off;
  }, [cfgKey, setupEventListeners]);

  // Effect 2: Handle re-authentication when userId/auth state changes
  useEffect(() => {
    if (clientRef.current && isAuthenticated && userId) {
      clientRef.current.authenticate(userId).catch((e: any) => {
        console.error("Re-authentication failed:", e);
        setIsAuthenticated(false);
      });
    }
  }, [isAuthenticated, userId]);

  // Effect 3: Cleanup ONLY on component unmount
  useEffect(() => {
    return () => {
      try {
        unsubRef.current.forEach((fn) => fn());
      } catch { }
      unsubRef.current = [];

      try {
        clientRef.current?.cleanup?.();
      } catch (e) {
        console.error("[Provider] Unmount cleanup failed:", e);
      }
      clientRef.current = null;
    };
  }, []); // Empty deps = only run on mount/unmount

  useEffect(() => {
    // TODO: MediaDeviceManager not yet migrated to TypeScript SDK
    // Commenting out device manager initialization for now
    /*
    const initDeviceManager = async () => {
      try {
        const manager = new MediaDeviceManager();
        await manager.initialize();

        deviceManagerRef.current = manager;
        setDevices(manager.getDevices());
        setSelectedDevices(manager.getSelectedDevices());

        manager.on("devicesChanged", (newDevices: any) => {
          setDevices(newDevices);
        });

        manager.on("deviceSelected", () => {
          setSelectedDevices(manager.getSelectedDevices());
        });
      } catch (error) {
        console.error("Failed to initialize device manager:", error);
      }
    };

    initDeviceManager();

    return () => {
      deviceManagerRef.current?.destroy();
      deviceManagerRef.current = null;
    };
    */
  }, []);
  // Auto-pin/unpin screen shares when they appear/disappear
  useEffect(() => {
    if (!currentRoom) return;

    // If there's a screen share, pin the first one
    if (screenShareStreams.size > 0) {
      const firstScreenShareUserId = Array.from(screenShareStreams.keys())[0];
      const screenShareId = `${firstScreenShareUserId}-screen`;

      // Only pin if not already pinned
      if (currentRoom.pinnedParticipant?.userId !== screenShareId) {
        currentRoom.pinParticipant(screenShareId);
        setPinType('local');
        setParticipants(prev => new Map(prev)); // Force re-render
      }
    } else {
      // No screen shares, unpin if currently pinned to a screen share
      const pinnedId = currentRoom.pinnedParticipant?.userId;
      if (pinnedId && pinnedId.endsWith('-screen') && pinType === 'local') {
        currentRoom.unpinParticipant();
        setPinType(null);
        setParticipants(prev => new Map(prev)); // Force re-render
      }
    }
  }, [screenShareStreams, currentRoom]);
  const authenticate = useCallback(async (userIdToAuth: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Client not initialized");
    setUserId(userIdToAuth);
    await client.authenticate(userIdToAuth);
    setIsAuthenticated(true);
  }, []);

  const joinRoom = useCallback(
    async (code: string, customStream?: MediaStream) => {
      const client = clientRef.current;
      if (!client) throw new Error("Client not initialized");

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
        // If authentication error, reset auth state
        if (error.message?.includes("authenticated")) {
          console.warn("Authentication required, resetting auth state");
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
    // State is updated by audioToggled event
  }, [participants, userId]);

  const toggleCamera = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleCamera();
    // State is updated by videoToggled event
  }, [participants, userId]);

  const toggleRaiseHand = useCallback(async () => {
    if (!userId) return;
    const p = participants.get(userId);
    if (!p) return;
    await p.toggleRaiseHand();
    // State is updated by handRaiseToggled event
  }, [participants, userId]);

  const togglePin = useCallback(
    async (participantId: string, pinFor: "local" | "everyone") => {
      if (!currentRoom) return;
      const target = currentRoom.getParticipant(participantId);
      if (!target) return;

      const local = currentRoom.localParticipant as any;
      if (!local?.publisher) return;

      const isPinned = currentRoom.pinnedParticipant?.userId === participantId;

      setParticipants((prev) => {
        const updated = new Map(prev);
        updated.set(participantId, target);
        return updated;
      });

      if (pinFor === "everyone") {
        if (isPinned) {
          await local.publisher.unpinForEveryone(target.streamId);
        } else {
          await local.publisher.pinForEveryone(target.streamId);
        }
      }
    },
    [currentRoom]
  );

  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!deviceManagerRef.current || !currentRoom) return;

      try {
        deviceManagerRef.current.selectCamera(deviceId);
        const local = currentRoom.localParticipant as any;
        if (local?.publisher) {
          const result = await local.publisher.switchCamera(deviceId);
          console.log("switchCamera result", result);
          if (result?.videoOnlyStream) {
            setLocalStream(result.videoOnlyStream);
          }
        }
      } catch (error) {
        console.error("Failed to switch camera:", error);
      }
    },
    [currentRoom]
  );

  const switchMicrophone = useCallback(
    async (deviceId: string) => {
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
        console.error("Failed to switch microphone:", error);
      }
    },
    [currentRoom]
  );

  const getPreviewStream = useCallback(
    async (cameraId?: string, micId?: string) => {
      try {
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
        console.error("Failed to get preview stream:", error);
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
        console.error("Failed to replace media stream:", error);
        throw error;
      }
    },
    [currentRoom]
  );

  // SubRoom methods
  const createSubRoom = useCallback(async (config: any) => {
    const client = clientRef.current;
    if (!client || !currentRoom) {
      throw new Error("Client or current room not available");
    }

    try {
      const result = await currentRoom.createSubRoom(config);
      return result;
    } catch (error) {
      console.error("Failed to create sub room:", error);
      throw error;
    }
  }, [currentRoom]);

  const joinSubRoom = useCallback(async (subRoomId: string) => {
    const client = clientRef.current;
    if (!client || !currentRoom) {
      throw new Error("Client or current room not available");
    }

    try {
      const result = await currentRoom.joinSubRoom(subRoomId);
      return result;
    } catch (error) {
      console.error("Failed to join sub room:", error);
      throw error;
    }
  }, [currentRoom]);

  const closeSubRoom = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !currentRoom) {
      throw new Error("Client or current room not available");
    }

    try {
      const result = await currentRoom.closeSubRoom();
      return result;
    } catch (error) {
      console.error("Failed to close sub room:", error);
      throw error;
    }
  }, [currentRoom]);

  const leaveSubRoom = useCallback(async (subRoomId: string) => {
    const client = clientRef.current;
    if (!client || !currentRoom) {
      throw new Error("Client or current room not available");
    }

    try {
      const result = await currentRoom.leaveSubRoom(subRoomId);
      return result;
    } catch (error) {
      console.error("Failed to leave sub room:", error);
      throw error;
    }
  }, [currentRoom]);

  const toggleScreenShare = useCallback(async () => {
    if (!currentRoom) return;

    try {
      if (isScreenSharing) {
        await currentRoom.stopScreenShare();
      } else {
        await currentRoom.startScreenShare();
      }
    } catch (error) {
      console.error("Failed to toggle screen share:", error);
      setIsScreenSharing(false);
    }
  }, [currentRoom, isScreenSharing, screenShareStreams]);

  const sendCustomEvent = useCallback(
    async (eventType: string, data: any) => {
      const client = clientRef.current;
      if (!client) throw new Error("Client not initialized");
      if (!inRoom) throw new Error("Not in a room");

      try {
        await client.sendCustomEvent(eventType, data);
      } catch (error) {
        console.error("Failed to send custom event:", error);
        throw error;
      }
    },
    [inRoom]
  );

  const value = useMemo(
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
      createSubRoom,
      joinSubRoom,
      leaveSubRoom,
      // Screen share
      screenShareStreams,
      isScreenSharing,
      toggleScreenShare,
      closeSubRoom,
      // test
      sendCustomEvent,
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
      createSubRoom,
      joinSubRoom,
      leaveSubRoom,
      toggleScreenShare,
      closeSubRoom,
      sendCustomEvent,
    ]
  );

  return (
    <ErmisClassroomContext.Provider value={value}>
      {children}
    </ErmisClassroomContext.Provider>
  );
};
