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
}>`
  position: relative;
  background: #111;
  border-radius: 4px;
  overflow: hidden;
  min-height: 150px;
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

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
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
      // Update UI to reflect pin status
    });

    client.on(events.PARTICIPANT_UNPINNED_FOR_EVERYONE, (data: any) => {
      console.log("-------PARTICIPANT_UNPINNED_FOR_EVERYONE------", data);
      // Update UI to reflect unpin status
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

  // Function to render participant videos based on layout rules
  const renderParticipantVideos = () => {
    const totalParticipants = participants.size + 1; // +1 for local user
    const remoteParticipantsList = Array.from(participants.values()).filter(
      (p) => !p.isLocal
    );

    if (totalParticipants === 1) {
      // Only local user - show full screen
      return (
        <ParticipantVideoContainer key="local">
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

    return allParticipants.map((participant) => (
      <ParticipantVideoContainer key={participant.userId}>
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
        </ParticipantInfo>
      </ParticipantVideoContainer>
    ));
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
    </Container>
  );
};

export default VideoMeeting;
