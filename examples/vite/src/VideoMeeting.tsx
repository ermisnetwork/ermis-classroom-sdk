import React, { useState, useEffect, useRef, useCallback } from "react";
import ErmisClassroom, {
  Participant,
  Room,
} from "ermis-classroom-sdk";
import styled from "styled-components";
import {
  MdMic,
  MdMicOff,
  MdVideocam,
  MdVideocamOff,
  MdCallEnd,
  MdPushPin,
  MdOutlinePushPin,
} from "react-icons/md";

// Styled Components
const Container = styled.div`
  padding: 30px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
  width: 100%;
  height: 100%;
`;

const LoginSection = styled.div`
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const VideoContainer = styled.div`
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
  width: 100%;
  height: 100%;
`;

const MainVideoStyled = styled.div<{ $totalParticipants: number }>`
  width: 100%;
  height: 100%;
  background: #000;
  position: relative;
  display: grid;
  grid-template-columns: ${(props) => {
    if (props.$totalParticipants === 1 || props.$totalParticipants === 0)
      return "1fr";
    if (props.$totalParticipants === 2) return "repeat(2, 1fr)";
    return "repeat(3, 1fr)";
  }};
  grid-template-rows: ${(props) => {
    if (props.$totalParticipants === 1) return "1fr";
    return "repeat(auto-fit, minmax(150px, 1fr))";
  }};
  gap: 4px;
  padding: 4px;

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #111;
    border-radius: 4px;
  }
`;

const ParticipantVideoContainer = styled.div<{
  $isSmall?: boolean;
  $isLocal?: boolean;
  $isPinned?: boolean;
}>`
  position: relative;
  background: #111;
  border-radius: 4px;
  overflow: hidden;
  min-height: 150px;
  aspect-ratio: 16 / 9;
  ${(props) =>
    props.$isSmall &&
    `
    position: absolute;
    bottom: 20px;
    right: 20px;
    width: 200px;
    height: 150px;
    z-index: 10;
    border: 2px solid white;
  `}
  ${(props) =>
    props.$isPinned &&
    `
    border: 3px solid #ffd700;
    box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
  `}

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &:hover .participant-actions {
    opacity: 1;
  }
`;

const ParticipantInfo = styled.div`
  position: absolute;
  top: 5px;
  right: 5px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const OwnerBadge = styled.span`
  background: #ffd700;
  color: #000;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: bold;
`;

const Button = styled.button<{ variant?: "primary" | "danger" }>`
  background: ${(props) =>
    props.variant === "danger" ? "#dc3545" : "#007bff"};
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-right: 10px;

  &:hover {
    opacity: 0.8;
  }

  &:disabled {
    background: #6c757d;
    cursor: not-allowed;
  }
`;

const Input = styled.input`
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  margin-bottom: 10px;
`;

const ControlsContainer = styled.div`
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 20;
`;

const ControlButton = styled.button<{
  $isActive?: boolean;
  variant?: "mic" | "video" | "leave";
}>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  padding: 0;

  ${(props) => {
    if (props.variant === "leave") {
      return `
        background: #dc3545;
        color: white;
        &:hover {
          background: #c82333;
          transform: scale(1.1);
        }
      `;
    }

    if (props.$isActive) {
      return `
        background: #28a745;
        color: white;
        &:hover {
          background: #218838;
          transform: scale(1.1);
        }
      `;
    }

    return `
      background: #6c757d;
      color: white;
      &:hover {
        background: #5a6268;
        transform: scale(1.1);
      }
    `;
  }}

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
`;

const LocalVideoOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 24px;
`;

const ConfirmDialog = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ConfirmBox = styled.div`
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;

const ConfirmTitle = styled.h3`
  margin: 0 0 12px 0;
  font-size: 18px;
  color: #333;
`;

const ConfirmMessage = styled.p`
  margin: 0 0 20px 0;
  font-size: 14px;
  color: #666;
  line-height: 1.5;
`;

const ConfirmButtons = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
`;

const ConfirmButton = styled.button<{ variant?: 'primary' | 'secondary' }>`
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;

  ${props => props.variant === 'primary' ? `
    background: #007bff;
    color: white;
    &:hover {
      background: #0056b3;
    }
  ` : `
    background: #f0f0f0;
    color: #333;
    &:hover {
      background: #e0e0e0;
    }
  `}
`;

const ParticipantActions = styled.div`
  position: absolute;
  bottom: 5px;
  left: 5px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.3s ease;
`;

const PinButtonContainer = styled.div`
  position: relative;
`;

const ActionButton = styled.button<{ $isActive?: boolean }>`
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(props) =>
    props.$isActive ? "rgba(255, 215, 0, 0.9)" : "rgba(0, 0, 0, 0.7)"};
  color: white;
  transition: all 0.2s ease;
  padding: 0;

  &:hover {
    background: ${(props) =>
    props.$isActive ? "rgba(255, 215, 0, 1)" : "rgba(0, 0, 0, 0.9)"};
    transform: scale(1.1);
  }
`;

const PinMenu = styled.div<{ $show: boolean }>`
  position: absolute;
  bottom: 35px;
  left: 0;
  background: rgba(0, 0, 0, 0.95);
  border-radius: 8px;
  padding: 8px;
  display: ${(props) => (props.$show ? "flex" : "none")};
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 100;

  &::before {
    content: "";
    position: absolute;
    bottom: -8px;
    left: 10px;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid rgba(0, 0, 0, 0.95);
  }
`;

const PinMenuItem = styled.button<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: ${(props) => (props.$disabled ? "#666" : "white")};
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  border-radius: 4px;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  transition: background 0.2s ease;

  &:hover {
    background: ${(props) =>
    props.$disabled ? "transparent" : "rgba(255, 255, 255, 0.1)"};
  }

  svg {
    flex-shrink: 0;
  }
`;

// Main Component
const VideoMeeting: React.FC = () => {
  const [userId, setUserId] = useState("tuannt20591@gmail.com");
  const [roomCode, setRoomCode] = useState("5fay-jmyt-jvqn");
  const [isConnected, setIsConnected] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [pinMenuOpen, setPinMenuOpen] = useState<string | null>(null); // Stores participantId of open menu
  const [pinType, setPinType] = useState<'local' | 'everyone' | null>(null); // Track pin type
  const [showPinConfirm, setShowPinConfirm] = useState(false); // Confirmation dialog
  const [pendingPinAction, setPendingPinAction] = useState<{ userId: string, type: 'local' } | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Sử dụng useRef để lưu trữ client instance - chỉ tạo 1 lần
  const clientRef = useRef<any>(null);

  // Khởi tạo client chỉ 1 lần khi component mount
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = ErmisClassroom.create({
        host: "daibo.ermis.network:9992",
        debug: true,
        webtpUrl: "https://daibo.ermis.network:4458/meeting/wt",
      });

      // Setup event listeners ngay khi tạo client
      setupEventListeners(clientRef.current);
    }

    // Cleanup khi component unmount
    return () => {
      if (clientRef.current) {
        // Add any cleanup logic here if needed
        // clientRef.current.disconnect();
      }
    };
  }, []);

  // Close pin menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (pinMenuOpen) {
        setPinMenuOpen(null);
      }
    };

    if (pinMenuOpen) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [pinMenuOpen]);

  // Setup SDK Event Listeners
  const setupEventListeners = useCallback((client: any) => {
    const events = ErmisClassroom.events || {};

    console.log("--client--", client);

    // Lắng nghe local stream (camera của bạn)
    client.on(events.LOCAL_STREAM_READY, (event: any) => {
      // Attach local stream to local video element
      if (localVideoRef.current && event.videoOnlyStream) {
        localVideoRef.current.srcObject = event.videoOnlyStream;
      }
    });

    // Lắng nghe remote streams (video của participants khác)
    client.on(events.REMOTE_STREAM_READY, (event: any) => {
      setRemoteStreams((prev) => {
        const updated = new Map(prev);
        updated.set(event.participant.userId, event.stream);
        return updated;
      });
    });

    // Room events
    client.on(events.ROOM_JOINED, (data: any) => {
      console.log("--------ROOM_JOINED-------", data);
    });

    // Participant events
    client.on(events.PARTICIPANT_ADDED, (data: any) => {
      console.log("-------PARTICIPANT_ADDED------", data);
      setParticipants(
        (prev) => new Map(prev.set(data.participant.userId, data.participant))
      );
    });

    client.on(events.PARTICIPANT_REMOVED, (data: any) => {
      console.log("-------PARTICIPANT_REMOVED------", data);
      setParticipants((prev) => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        return updated;
      });
      setRemoteStreams((prev) => {
        const updated = new Map(prev);
        updated.delete(data.participant.userId);
        return updated;
      });
    });

    client.on(events.ROOM_LEFT, (data: any) => {
      console.log("-------ROOM_LEFT------", data);
    });

    // Remote participant mic/camera status changes
    client.on(events.REMOTE_AUDIO_STATUS_CHANGED, (data: any) => {
      console.log("-------REMOTE_AUDIO_STATUS_CHANGED------", data);
      setParticipants((prev) => {
        const updated = new Map(prev);
        const participant = updated.get(data.participant.userId);
        if (participant) {
          participant.isAudioEnabled = data.enabled;
          updated.set(data.participant.userId, participant);
        }
        return updated;
      });
    });

    client.on(events.REMOTE_VIDEO_STATUS_CHANGED, (data: any) => {
      console.log("-------REMOTE_VIDEO_STATUS_CHANGED------", data);
      setParticipants((prev) => {
        const updated = new Map(prev);
        const participant = updated.get(data.participant.userId);
        if (participant) {
          participant.isVideoEnabled = data.enabled;
          updated.set(data.participant.userId, participant);
        }
        return updated;
      });
    });

    // Local participant audio toggle event
    client.on("audioToggled", (data: any) => {
      console.log("-------LOCAL_AUDIO_TOGGLED------", data);
      if (data.participant.isLocal) {
        setIsMicEnabled(data.enabled);
        setParticipants((prev) => {
          const updated = new Map(prev);
          const participant = updated.get(data.participant.userId);
          if (participant) {
            participant.isAudioEnabled = data.enabled;
            updated.set(data.participant.userId, participant);
          }
          return updated;
        });
      }
    });

    // Local participant video toggle event
    client.on("videoToggled", (data: any) => {
      console.log("-------LOCAL_VIDEO_TOGGLED------", data);
      if (data.participant.isLocal) {
        setIsVideoEnabled(data.enabled);
        setParticipants((prev) => {
          const updated = new Map(prev);
          const participant = updated.get(data.participant.userId);
          if (participant) {
            participant.isVideoEnabled = data.enabled;
            updated.set(data.participant.userId, participant);
          }
          return updated;
        });
      }
    });

    // Screen sharing events
    client.on(events.SCREEN_SHARE_STARTED, (data: any) => {
      console.log("-------SCREEN_SHARE_STARTED------", data);
    });

    client.on(events.SCREEN_SHARE_STOPPED, (data: any) => {
      console.log("-------SCREEN_SHARE_STOPPED------", data);
    });

    client.on(events.REMOTE_SCREEN_SHARE_STARTED, (data: any) => {
      console.log("-------REMOTE_SCREEN_SHARE_STARTED------", data);
      setParticipants((prev) => {
        const updated = new Map(prev);
        const participant = updated.get(data.participant.userId);
        if (participant) {
          participant.isScreenSharing = true;
          updated.set(data.participant.userId, participant);
        }
        return updated;
      });
    });

    client.on(events.REMOTE_SCREEN_SHARE_STOPPED, (data: any) => {
      console.log("-------REMOTE_SCREEN_SHARE_STOPPED------", data);
      setParticipants((prev) => {
        const updated = new Map(prev);
        const participant = updated.get(data.participant.userId);
        if (participant) {
          participant.isScreenSharing = false;
          updated.set(data.participant.userId, participant);
        }
        return updated;
      });
    });

    // Pin for everyone events
    client.on(events.PARTICIPANT_PINNED_FOR_EVERYONE, (data: any) => {
      console.log("-------PARTICIPANT_PINNED_FOR_EVERYONE------", data);
      // Update to 'everyone' pin type
      setPinType('everyone');
      // Force re-render to show pin status
      setParticipants((prev) => new Map(prev));
    });

    client.on(events.PARTICIPANT_UNPINNED_FOR_EVERYONE, (data: any) => {
      console.log("-------PARTICIPANT_UNPINNED_FOR_EVERYONE------", data);
      // Clear pin type
      setPinType(null);
      // Force re-render to show unpin status
      setParticipants((prev) => new Map(prev));
    });

    client.on(events.ERROR, (data: any) => {
      console.error(`SDK Error in ${data.action}:`, data.error.message);
    });
  }, []);

  // Login and authenticate
  const handleLogin = async () => {
    if (!clientRef.current) return;
    try {
      setIsLoading(true);

      // Authenticate với client đã được tạo
      await clientRef.current.authenticate(userId);

      setIsConnected(true);
    } catch (error) {
      console.error("Authentication failed:", error);
      alert("Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Join room
  const handleJoinRoom = async () => {
    if (!clientRef.current) return;
    try {
      setIsLoading(true);

      const result: any = await clientRef.current.joinRoom(roomCode);

      setCurrentRoom(result.room);
      setIsInRoom(true);

      // Set participants
      const participantMap = new Map();
      result.participants.forEach((participant: Participant) => {
        participantMap.set(participant.userId, participant);

        // Update local mic and camera status if this is the local participant
        if (participant.isLocal) {
          setIsMicEnabled(participant.isAudioEnabled);
          setIsVideoEnabled(participant.isVideoEnabled);
        }
      });
      setParticipants(participantMap);
    } catch (error) {
      console.error("Failed to join room:", error);
      alert("Failed to join room");
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle microphone
  const handleToggleMicrophone = async () => {
    const p = participants.get(userId);
    if (!p) return;

    await p.toggleMicrophone();
    // Update local state immediately after toggle
    setIsMicEnabled(p.isAudioEnabled);

    // Update participant in map to trigger re-render
    setParticipants(prev => {
      const updated = new Map(prev);
      updated.set(userId, p);
      return updated;
    });
  };

  // Toggle camera
  const handleToggleCamera = async () => {
    const p = participants.get(userId);
    if (!p) return;

    await p.toggleCamera();
    // Update local state immediately after toggle
    setIsVideoEnabled(p.isVideoEnabled);

    // Update participant in map to trigger re-render
    setParticipants(prev => {
      const updated = new Map(prev);
      updated.set(userId, p);
      return updated;
    });
  };

  // Leave room
  const handleLeaveRoom = async () => {
    if (!clientRef.current || !isInRoom) return;

    try {
      await clientRef.current.leaveRoom();
      setIsInRoom(false);
      setCurrentRoom(null);
      setParticipants(new Map());
      setRemoteStreams(new Map());
      setIsMicEnabled(true);
      setIsVideoEnabled(true);
    } catch (error) {
      console.error("Failed to leave room:", error);
    }
  };

  // Pin participant locally (only for this user)
  const handlePinLocal = async (participantUserId: string) => {
    if (!currentRoom) return;

    try {
      const isPinned = currentRoom.pinnedParticipant?.userId === participantUserId;

      // Check if already pinned for everyone
      if (pinType === 'everyone' && !isPinned) {
        // Show confirmation dialog
        setPendingPinAction({ userId: participantUserId, type: 'local' });
        setShowPinConfirm(true);
        return;
      }

      if (isPinned) {
        currentRoom.unpinParticipant();
        setPinType(null);
      } else {
        currentRoom.pinParticipant(participantUserId);
        setPinType('local');
      }

      // Force re-render
      setParticipants(prev => new Map(prev));
    } catch (error) {
      console.error("Failed to pin participant:", error);
    }
  };

  // Confirm pin local when already pinned for everyone
  const confirmPinLocal = async () => {
    if (!pendingPinAction || !currentRoom) return;

    try {
      currentRoom.pinParticipant(pendingPinAction.userId);
      setPinType('local');
      setParticipants(prev => new Map(prev));
    } catch (error) {
      console.error("Failed to confirm pin:", error);
    } finally {
      setShowPinConfirm(false);
      setPendingPinAction(null);
    }
  };

  // Cancel pin confirmation
  const cancelPinConfirm = () => {
    setShowPinConfirm(false);
    setPendingPinAction(null);
  };

  // Pin participant for everyone (host only)
  const handlePinForEveryone = async (participantUserId: string) => {
    if (!currentRoom) return;

    try {
      const participant = currentRoom.getParticipant(participantUserId);
      if (!participant) return;

      // Access publisher from Room's localParticipant
      const localParticipant = currentRoom.localParticipant;
      if (!localParticipant || !(localParticipant as any).publisher) return;

      const publisher = (localParticipant as any).publisher;
      const isPinned = currentRoom.pinnedParticipant?.userId === participantUserId;

      if (isPinned && pinType === 'everyone') {
        // Send unpin event
        await publisher.unpinForEveryone(participant.streamId);
        setPinType(null);
      } else {
        // If pinned locally, this will override it
        // Send pin event
        await publisher.pinForEveryone(participant.streamId);
        setPinType('everyone');
      }
    } catch (error) {
      console.error("Failed to pin for everyone:", error);
    }
  };

  // Function to render participant videos based on layout rules
  const renderParticipantVideos = () => {
    const totalParticipants = participants.size + 1; // +1 for local user
    const remoteParticipantsList = Array.from(participants.values()).filter(
      (p) => !p.isLocal
    );

    const isHost = currentRoom?.localParticipant?.role === "owner";
    const pinnedUserId = currentRoom?.pinnedParticipant?.userId;

    if (totalParticipants === 1) {
      // Only local user - show full screen
      return (
        <ParticipantVideoContainer
          key="local"
          $isPinned={pinnedUserId === userId}
        >
          <video ref={localVideoRef} autoPlay playsInline muted />
          {!isVideoEnabled && (
            <LocalVideoOverlay>
              <MdVideocamOff />
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            You ({userId})
            {!isMicEnabled && (
              <span>
                <MdMicOff />
              </span>
            )}
            {currentRoom?.localParticipant?.role === "owner" && (
              <OwnerBadge>OWNER</OwnerBadge>
            )}
          </ParticipantInfo>

          <ParticipantActions className="participant-actions">
            <PinButtonContainer>
              <ActionButton
                $isActive={pinnedUserId === userId}
                onClick={(e) => {
                  e.stopPropagation();
                  setPinMenuOpen(pinMenuOpen === userId ? null : userId);
                }}
                title="Pin options"
              >
                {pinnedUserId === userId ? <MdPushPin size={16} /> : <MdOutlinePushPin size={16} />}
              </ActionButton>

              <PinMenu $show={pinMenuOpen === userId}>
                <PinMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePinLocal(userId);
                    setPinMenuOpen(null);
                  }}
                >
                  <MdPushPin size={14} />
                  Pin locally
                </PinMenuItem>
                <PinMenuItem
                  $disabled={!isHost}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isHost) {
                      handlePinForEveryone(userId);
                      setPinMenuOpen(null);
                    }
                  }}
                >
                  <MdPushPin size={14} />
                  Pin for everyone {!isHost && "(Host only)"}
                </PinMenuItem>
              </PinMenu>
            </PinButtonContainer>
          </ParticipantActions>
        </ParticipantVideoContainer>
      );
    }

    // 2+ participants - 3 columns, local first
    const localParticipantData = participants.get(userId);
    const allParticipants = [
      {
        userId: userId,
        isLocal: true,
        isAudioEnabled: localParticipantData?.isAudioEnabled ?? isMicEnabled,
        isVideoEnabled: localParticipantData?.isVideoEnabled ?? isVideoEnabled,
        role: currentRoom?.localParticipant?.role,
        stream: null,
      },
      ...remoteParticipantsList.map((p) => ({
        ...p,
        stream: remoteStreams.get(p.userId),
      })),
    ];

    return allParticipants.map((participant) => {
      const isPinned = pinnedUserId === participant.userId;

      return (
        <ParticipantVideoContainer
          key={participant.userId}
          $isPinned={isPinned}
        >
          <video
            autoPlay
            playsInline
            muted={participant.isLocal}
            ref={
              participant.isLocal
                ? localVideoRef
                : (videoElement) => {
                  if (videoElement && participant.stream) {
                    videoElement.srcObject = participant.stream;
                  }
                }
            }
          />
          {/* Show camera off overlay for both local and remote */}
          {!participant.isVideoEnabled && (
            <LocalVideoOverlay>
              <MdVideocamOff />
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            {participant.isLocal ? "You" : participant.userId}
            {!participant.isAudioEnabled && (
              <span>
                <MdMicOff />
              </span>
            )}
            {participant.role === "owner" && <OwnerBadge>OWNER</OwnerBadge>}
            {(participant as any).isScreenSharing && (
              <span title="Sharing screen">📺</span>
            )}
            {isPinned && (
              <span title="Pinned" style={{ color: "#ffd700" }}>
                <MdPushPin />
              </span>
            )}
          </ParticipantInfo>

          <ParticipantActions className="participant-actions">
            <PinButtonContainer>
              <ActionButton
                $isActive={isPinned}
                onClick={(e) => {
                  e.stopPropagation();
                  setPinMenuOpen(pinMenuOpen === participant.userId ? null : participant.userId);
                }}
                title="Pin options"
              >
                {isPinned ? <MdPushPin size={16} /> : <MdOutlinePushPin size={16} />}
              </ActionButton>

              <PinMenu $show={pinMenuOpen === participant.userId}>
                <PinMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePinLocal(participant.userId);
                    setPinMenuOpen(null);
                  }}
                >
                  <MdPushPin size={14} />
                  Pin locally {pinType === 'local' && isPinned && '✓'}
                </PinMenuItem>
                <PinMenuItem
                  $disabled={!isHost}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isHost) {
                      handlePinForEveryone(participant.userId);
                      setPinMenuOpen(null);
                    }
                  }}
                >
                  <MdPushPin size={14} />
                  Pin for everyone {pinType === 'everyone' && isPinned && '✓'} {!isHost && "(Host only)"}
                </PinMenuItem>
              </PinMenu>
            </PinButtonContainer>
          </ParticipantActions>
        </ParticipantVideoContainer>
      );
    });
  };

  return (
    <Container>
      {/* Login Section */}
      {!isConnected && (
        <LoginSection>
          <h2>Join Meeting</h2>
          <Input
            type="email"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter your email"
          />
          <Button onClick={handleLogin} disabled={isLoading}>
            {isLoading ? "Connecting..." : "Connect"}
          </Button>
        </LoginSection>
      )}

      {/* Room Join Section */}
      {isConnected && !isInRoom && (
        <LoginSection>
          <h2>Enter Room</h2>
          <Input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="Enter room code"
            onKeyPress={(e) => e.key === "Enter" && handleJoinRoom()}
          />
          <Button onClick={handleJoinRoom} disabled={isLoading}>
            {isLoading ? "Joining..." : "Join Room"}
          </Button>
        </LoginSection>
      )}

      <VideoContainer>
        <MainVideoStyled $totalParticipants={participants.size}>
          {renderParticipantVideos()}
        </MainVideoStyled>

        {/* Control Buttons */}
        {isInRoom && (
          <ControlsContainer>
            <ControlButton
              variant="mic"
              $isActive={isMicEnabled}
              onClick={handleToggleMicrophone}
              title={isMicEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {isMicEnabled ? <MdMic size={20} /> : <MdMicOff size={20} />}
            </ControlButton>

            <ControlButton
              variant="video"
              $isActive={isVideoEnabled}
              onClick={handleToggleCamera}
              title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {isVideoEnabled ? (
                <MdVideocam size={20} />
              ) : (
                <MdVideocamOff size={20} />
              )}
            </ControlButton>

            <ControlButton
              variant="leave"
              onClick={handleLeaveRoom}
              title="Leave room"
            >
              <MdCallEnd size={20} />
            </ControlButton>
          </ControlsContainer>
        )}
      </VideoContainer>

      {/* Pin Confirmation Dialog */}
      {showPinConfirm && (
        <ConfirmDialog onClick={cancelPinConfirm}>
          <ConfirmBox onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>Confirm Pin Change</ConfirmTitle>
            <ConfirmMessage>
              This participant is currently pinned for everyone by the host.
              Do you want to override this and pin locally instead?
            </ConfirmMessage>
            <ConfirmButtons>
              <ConfirmButton variant="secondary" onClick={cancelPinConfirm}>
                Cancel
              </ConfirmButton>
              <ConfirmButton variant="primary" onClick={confirmPinLocal}>
                Pin Locally
              </ConfirmButton>
            </ConfirmButtons>
          </ConfirmBox>
        </ConfirmDialog>
      )}
    </Container>
  );
};

export default VideoMeeting;
