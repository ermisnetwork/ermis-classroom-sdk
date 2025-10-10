import {useEffect, useRef, useState} from "react";
import {
  MdCallEnd,
  MdMic,
  MdMicOff,
  MdOutlinePushPin,
  MdPanTool,
  MdPushPin,
  MdVideocam,
  MdVideocamOff,
} from "react-icons/md";
import {
  ActionButton,
  Button,
  Container,
  ControlButton,
  ControlsContainer,
  Input,
  LocalVideoOverlay,
  LoginSection,
  MainVideoStyled,
  OwnerBadge,
  ParticipantActions,
  ParticipantInfo,
  ParticipantVideoContainer,
  PinButtonContainer,
  PinMenu,
  PinMenuItem,
  VideoContainer
} from "./VideoMeeting.styles.tsx";
import {useErmisMeeting} from "./hooks/useErmisMeeting.ts";

// Main Component
export default function VideoMeeting() {
  const [userId, setUserId] = useState("tuannt20591@gmail.com");
  const [roomCode, setRoomCode] = useState("5fay-jmyt-jvqn");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pinMenuOpen, setPinMenuOpen] = useState<string | null>(null); // Stores participantId of open menu

  const localVideoRef = useRef<HTMLVideoElement>(null);

  const {
    participants, remoteStreams, authenticate, joinRoom,
    videoEnabled, micEnabled, handRaised, inRoom, currentRoom,
    leaveRoom, toggleMicrophone, toggleCamera, toggleRaiseHand,
    togglePin,
  } = useErmisMeeting({
    config: {
      host: "daibo.ermis.network:9992",
      debug: true,
      webtpUrl: "https://daibo.ermis.network:4458/meeting/wt",
    },
    videoRef: localVideoRef,
  });

  // Close pin menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (pinMenuOpen) setPinMenuOpen(null);
    };
    if (pinMenuOpen) document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [pinMenuOpen]);

  // Login and authenticate
  const handleLogin = async () => {
    try {
      setIsLoading(true);
      await authenticate(userId);
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
    try {
      setIsLoading(true);
      await joinRoom(roomCode);
    } catch (error) {
      console.error("Failed to join room:", error);
      alert("Failed to join room");
    } finally {
      setIsLoading(false);
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
          <video ref={localVideoRef} autoPlay playsInline muted/>
          {!videoEnabled && (
            <LocalVideoOverlay>
              <MdVideocamOff/>
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            You ({userId})
            {!micEnabled && (
              <span>
                <MdMicOff/>
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
                {pinnedUserId === userId ? <MdPushPin size={16}/> : <MdOutlinePushPin size={16}/>}
              </ActionButton>

              <PinMenu $show={pinMenuOpen === userId}>
                <PinMenuItem
                  onClick={() => togglePin(userId, 'local')}
                >
                  <MdPushPin size={14}/>
                  Pin locally
                </PinMenuItem>
                <PinMenuItem
                  $disabled={!isHost}
                  onClick={() => togglePin(userId, 'everyone')}
                >
                  <MdPushPin size={14}/>
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
        isAudioEnabled: localParticipantData?.isAudioEnabled ?? micEnabled,
        isVideoEnabled: localParticipantData?.isVideoEnabled ?? videoEnabled,
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
              <MdVideocamOff/>
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            {participant.isLocal ? "You" : participant.userId}
            {!participant.isAudioEnabled && (
              <span>
                <MdMicOff/>
              </span>
            )}
            {participant.role === "owner" && <OwnerBadge>OWNER</OwnerBadge>}
            {(participant as any).isScreenSharing && (
              <span title="Sharing screen">📺</span>
            )}
            {(participant as any).isHandRaised && (
              <span title="Hand raised" style={{color: "#ffa500"}}>
                <MdPanTool/>
              </span>
            )}
            {isPinned && (
              <span title="Pinned" style={{color: "#ffd700"}}>
                <MdPushPin/>
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
                {isPinned ? <MdPushPin size={16}/> : <MdOutlinePushPin size={16}/>}
              </ActionButton>

              <PinMenu $show={pinMenuOpen === participant.userId}>
                <PinMenuItem
                  onClick={() => togglePin(participant.userId, 'local')}
                >
                  <MdPushPin size={14}/>
                  Pin locally
                </PinMenuItem>
                <PinMenuItem
                  $disabled={!isHost}
                  onClick={() => togglePin(participant.userId, 'everyone')}
                >
                  <MdPushPin size={14}/>
                  Pin for everyone
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
          <h2 style={{color: 'black'}}>Join Meeting</h2>
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
      {isConnected && !inRoom && (
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
        {inRoom && (
          <ControlsContainer>
            <ControlButton
              variant="mic"
              $isActive={micEnabled}
              onClick={toggleMicrophone}
              title={micEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {micEnabled ? <MdMic size={20}/> : <MdMicOff size={20}/>}
            </ControlButton>

            <ControlButton
              variant="video"
              $isActive={videoEnabled}
              onClick={toggleCamera}
              title={videoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {videoEnabled ? (
                <MdVideocam size={20}/>
              ) : (
                <MdVideocamOff size={20}/>
              )}
            </ControlButton>

            <ControlButton
              $isActive={handRaised}
              onClick={toggleRaiseHand}
              title={handRaised ? "Lower hand" : "Raise hand"}
            >
              <MdPanTool size={20}/>
            </ControlButton>

            <ControlButton
              variant="leave"
              onClick={leaveRoom}
              title="Leave room"
            >
              <MdCallEnd size={20}/>
            </ControlButton>
          </ControlsContainer>
        )}
      </VideoContainer>
    </Container>
  );
};
