import React, { useState, useEffect, useRef, useCallback } from 'react';
import ErmisClassroom, { Participant, Room } from '@tuannt591/ermis-classroom-sdk';
import styled from 'styled-components';


// Styled Components
const Container = styled.div`
  padding: 30px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
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
`;

const MainVideoStyled = styled.div<{ $totalParticipants: number }>`
  height: 500px;
  background: #000;
  position: relative;
  display: grid;
  grid-template-columns: ${props => {
    if (props.$totalParticipants === 1) return '1fr';
    if (props.$totalParticipants === 2) return '1fr';
    return 'repeat(3, 1fr)';
  }};
  grid-template-rows: ${props => {
    if (props.$totalParticipants <= 2) return '1fr';
    return 'repeat(auto-fit, minmax(150px, 1fr))';
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

const ParticipantVideoContainer = styled.div<{ $isSmall?: boolean; $isLocal?: boolean }>`
  position: relative;
  background: #111;
  border-radius: 4px;
  overflow: hidden;
  min-height: 150px;
  ${props => props.$isSmall && `
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
  bottom: 5px;
  right: 5px;
  background: rgba(0,0,0,0.8);
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



const Button = styled.button<{ variant?: 'primary' | 'danger' }>`
  background: ${props => props.variant === 'danger' ? '#dc3545' : '#007bff'};
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

const ControlButton = styled.button<{ isActive?: boolean; variant?: 'mic' | 'video' | 'leave' }>`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  transition: all 0.3s ease;
  
  ${props => {
    if (props.variant === 'leave') {
      return `
        background: #dc3545;
        color: white;
        &:hover {
          background: #c82333;
          transform: scale(1.1);
        }
      `;
    }

    if (props.isActive) {
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
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 24px;
`;

// Main Component
const VideoMeeting: React.FC = () => {
  const [userId, setUserId] = useState('tuannt20591@gmail.com');
  const [roomCode, setRoomCode] = useState('5faf-bgj5-mhsy');
  const [isConnected, setIsConnected] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Sử dụng useRef để lưu trữ client instance - chỉ tạo 1 lần
  const clientRef = useRef<any>(null);

  // Khởi tạo client chỉ 1 lần khi component mount
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = ErmisClassroom.create({
        host: "daibo.ermis.network:9999",
        debug: true,
      });

      // clientRef.current.enableStreamOutput();
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

    console.log('--client--', client);

    // Lắng nghe local stream (camera của bạn)
    client.on(events.LOCAL_STREAM_READY, (event: any) => {
      // Attach local stream to local video element
      if (localVideoRef.current && event.videoOnlyStream) {
        localVideoRef.current.srcObject = event.videoOnlyStream;
      }
    });

    // Lắng nghe remote streams (video của participants khác)
    client.on(events.REMOTE_STREAM_READY, (event: any) => {
      setRemoteStreams(prev => {
        const updated = new Map(prev);
        updated.set(event.participant.userId, event.stream);
        return updated;
      });
    });

    // Lắng nghe khi remote stream bị remove
    client.on(events.STREAM_REMOVED, (event: any) => {
      console.log('-----remoteStreamRemoved---------', event);

      setRemoteStreams(prev => {
        const updated = new Map(prev);
        updated.delete(event.participant.userId);
        return updated;
      });
    });

    // Room events
    client.on(events.ROOM_JOINED, (data: any) => {
      console.log('--------ROOM_JOINED-------', data);
    });

    // Participant events
    client.on(events.PARTICIPANT_ADDED, (data: any) => {
      console.log('-------PARTICIPANT_ADDED------', data);
      setParticipants(prev => new Map(prev.set(data.participant.userId, data.participant)));
    });

    // client.on(events.PARTICIPANT_REMOVED || 'participantRemoved', ({ participant }: { participant: any }) => {
    //   console.log('Participant left:', participant.userId);
    //   setParticipants(prev => {
    //     const updated = new Map(prev);
    //     updated.delete(participant.userId);
    //     return updated;
    //   });
    // });

    // client.on(events.PARTICIPANT_PINNED || 'participantPinned', ({ participant }: { participant: any }) => {
    //   console.log('Participant pinned:', participant.userId);
    //   setParticipants(prev => {
    //     const updated = new Map(prev);
    //     const updatedParticipant = { ...participant, isPinned: true };
    //     updated.set(participant.userId, updatedParticipant);
    //     return updated;
    //   });
    // });

    // client.on(events.ERROR || 'error', ({ error, action }: { error: Error, action: string }) => {
    //   console.error(`SDK Error in ${action}:`, error.message);
    // });
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
      console.error('Authentication failed:', error);
      alert('Authentication failed');
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
      });
      setParticipants(participantMap);
    } catch (error) {
      console.error('Failed to join room:', error);
      alert('Failed to join room');
    } finally {
      setIsLoading(false);
    }
  };



  // Toggle microphone
  const handleToggleMicrophone = async () => {
    const localParticipant = currentRoom?.localParticipant;
    await localParticipant?.toggleMicrophone();
    setIsMicEnabled(!!localParticipant?.isAudioEnabled);
  };

  // Toggle camera
  const handleToggleCamera = async () => {
    if (!clientRef.current || !isInRoom) return;

    try {
      if (isVideoEnabled) {
        await clientRef.current.disableVideo();
      } else {
        await clientRef.current.enableVideo();
      }
      setIsVideoEnabled(!isVideoEnabled);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
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
      console.error('Failed to leave room:', error);
    }
  };

  console.log('---participants---', participants);

  // Function to render participant videos based on layout rules
  const renderParticipantVideos = () => {
    const totalParticipants = participants.size + 1; // +1 for local user
    const remoteParticipantsList = Array.from(participants.values()).filter(p => !p.isLocal);
    
    if (totalParticipants === 1) {
      // Only local user - show full screen
      return (
        <ParticipantVideoContainer key="local">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
          />
          {!isVideoEnabled && (
            <LocalVideoOverlay>
              📹
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            You ({userId})
            {!isMicEnabled && <span>🔇</span>}
            {currentRoom?.localParticipant?.role === 'owner' && <OwnerBadge>OWNER</OwnerBadge>}
          </ParticipantInfo>
        </ParticipantVideoContainer>
      );
    }
    
    if (totalParticipants === 2) {
      // 2 participants - remote full, local bottom right small
      const remoteParticipant = remoteParticipantsList[0];
      const remoteStream = remoteStreams.get(remoteParticipant.userId);
      
      return (
        <>
          {/* Remote participant full screen */}
          <ParticipantVideoContainer key={remoteParticipant.userId}>
            <video
              autoPlay
              playsInline
              ref={(videoElement) => {
                if (videoElement && remoteStream) {
                  videoElement.srcObject = remoteStream;
                }
              }}
            />
            <ParticipantInfo>
              {remoteParticipant.userId}
              {!remoteParticipant.isAudioEnabled && <span>🔇</span>}
              {remoteParticipant.role === 'owner' && <OwnerBadge>OWNER</OwnerBadge>}
            </ParticipantInfo>
          </ParticipantVideoContainer>
          
          {/* Local participant small in bottom right */}
          <ParticipantVideoContainer key="local" $isSmall={true}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
            />
            {!isVideoEnabled && (
              <LocalVideoOverlay>
                📹
              </LocalVideoOverlay>
            )}
            <ParticipantInfo>
              You
              {!isMicEnabled && <span>🔇</span>}
              {currentRoom?.localParticipant?.role === 'owner' && <OwnerBadge>OWNER</OwnerBadge>}
            </ParticipantInfo>
          </ParticipantVideoContainer>
        </>
      );
    }
    
    // 3+ participants - 3 columns, local first
    const allParticipants = [
      {
        userId: userId,
        isLocal: true,
        isAudioEnabled: isMicEnabled,
        isVideoEnabled: isVideoEnabled,
        role: currentRoom?.localParticipant?.role,
        stream: null
      },
      ...remoteParticipantsList.map(p => ({
        ...p,
        stream: remoteStreams.get(p.userId)
      }))
    ];
    
    return allParticipants.map((participant) => (
      <ParticipantVideoContainer key={participant.userId}>
        <video
          autoPlay
          playsInline
          muted={participant.isLocal}
          ref={participant.isLocal ? localVideoRef : (videoElement) => {
            if (videoElement && participant.stream) {
              videoElement.srcObject = participant.stream;
            }
          }}
        />
        {participant.isLocal && !isVideoEnabled && (
          <LocalVideoOverlay>
            📹
          </LocalVideoOverlay>
        )}
        <ParticipantInfo>
          {participant.isLocal ? 'You' : participant.userId}
          {!participant.isAudioEnabled && <span>🔇</span>}
          {participant.role === 'owner' && <OwnerBadge>OWNER</OwnerBadge>}
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
            {isLoading ? 'Connecting...' : 'Connect'}
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
            onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
          />
          <Button onClick={handleJoinRoom} disabled={isLoading}>
            {isLoading ? 'Joining...' : 'Join Room'}
          </Button>
        </LoginSection>
      )}

      {/* Video Meeting Area */}
      <div style={{ marginBottom: '20px', textAlign: 'center' }}>
        <h2>Room: {currentRoom?.name}</h2>
      </div>

      <VideoContainer>
          <MainVideoStyled $totalParticipants={participants.size + 1}>
            {renderParticipantVideos()}
          </MainVideoStyled>

          {/* Control Buttons */}
          {isInRoom && (
            <ControlsContainer>
              <ControlButton
                variant="mic"
                isActive={isMicEnabled}
                onClick={handleToggleMicrophone}
                title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
              >
                {isMicEnabled ? '🎤' : '🔇'}
              </ControlButton>

              <ControlButton
                variant="video"
                isActive={isVideoEnabled}
                onClick={handleToggleCamera}
                title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
              >
                {isVideoEnabled ? '📹' : '📷'}
              </ControlButton>

              <ControlButton
                variant="leave"
                onClick={handleLeaveRoom}
                title="Leave room"
              >
                📞
              </ControlButton>
            </ControlsContainer>
          )}
        </VideoContainer>


          <h3>Participants ({participants.size})</h3>
          <ParticipantList>
            {/* Local user */}
            <ParticipantItem isLocal={true}>
              <div>
                <strong>
                  {userId} (You)
                  <span style={{ marginLeft: '8px' }}>
                    {isMicEnabled ? '🎤' : '🔇'}
                    {isVideoEnabled ? '📹' : '📷'}
                  </span>
                </strong>
              </div>
            </ParticipantItem>

            {/* Remote participants */}
            {Array.from(participants.values()).filter(p => !p.isLocal).map((participant) => (
              <ParticipantItem
                key={participant.userId}
                isLocal={participant.isLocal}
                isPinned={participant.isPinned}
              >
                <div>
                  <strong>
                    {participant.userId}
                    {participant.role === 'owner' ? ' 👑' :
                      participant.role === 'moderator' ? ' �' : ''}
                    <span style={{ marginLeft: '8px' }}>
                      {participant.isAudioEnabled ? '🎤' : '🔇'}
                      {participant.isVideoEnabled ? '�' : '📷'}
                    </span>
                  </strong>
                </div>
              </ParticipantItem>
            ))}
          </ParticipantList>
        </ParticipantSidebar>
      </MeetingArea>
    </Container>
  );
};

export default VideoMeeting;