import {useEffect, useState} from "react";
import {
  MdCallEnd,
  MdMic,
  MdMicOff,
  MdOutlinePushPin,
  MdPanTool,
  MdPushPin,
  MdVideocam,
  MdVideocamOff,
  MdSettings,
} from "react-icons/md";
import {
  ActionButton,
  Button,
  Container,
  ControlButton,
  ControlsContainer,
  DeviceGroup,
  DeviceLabel,
  DeviceSelect,
  DeviceSettingsPanel,
  DeviceSettingsTitle,
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
import { useErmisMeeting } from "./context";

interface VideoMeetingProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export default function VideoMeeting({ videoRef }: VideoMeetingProps) {
  const [userId, setUserId] = useState("tuannt20591@gmail.com");
  const [roomCode, setRoomCode] = useState("5fay-jmyt-jvqn");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pinMenuOpen, setPinMenuOpen] = useState<string | null>(null);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewCameraId, setPreviewCameraId] = useState<string>('');
  const [previewMicId, setPreviewMicId] = useState<string>('');

  const {
    participants, remoteStreams, localStream, previewStream, authenticate, joinRoom,
    videoEnabled, micEnabled, handRaised, inRoom, currentRoom,
    leaveRoom, toggleMicrophone, toggleCamera, toggleRaiseHand,
    togglePin, devices, selectedDevices, switchCamera, switchMicrophone,
    getPreviewStream, stopPreviewStream, replaceMediaStream,
  } = useErmisMeeting();

  useEffect(() => {
    if (videoRef?.current) {
      if (inRoom && localStream) {
        videoRef.current.srcObject = localStream;
      } else if (!inRoom && previewStream) {
        videoRef.current.srcObject = previewStream;
      }
    }
  }, [videoRef, localStream, previewStream, inRoom]);

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

      let streamToUse = previewStream;

      if (!streamToUse && (previewCameraId || previewMicId)) {
        const constraints: any = {};

        if (previewCameraId) {
          constraints.video = { deviceId: { exact: previewCameraId } };
        } else {
          constraints.video = true;
        }

        if (previewMicId) {
          constraints.audio = { deviceId: { exact: previewMicId } };
        } else {
          constraints.audio = true;
        }

        streamToUse = await navigator.mediaDevices.getUserMedia(constraints);
      }

      await joinRoom(roomCode, streamToUse);
      setShowPreview(false);
    } catch (error) {
      console.error("Failed to join room:", error);
      alert("Failed to join room");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartPreview = async () => {
    try {
      setIsLoading(true);
      await getPreviewStream(previewCameraId || undefined, previewMicId || undefined);
      setShowPreview(true);
    } catch (error) {
      console.error("Failed to start preview:", error);
      alert("Failed to start preview. Please check camera/microphone permissions.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopPreview = () => {
    stopPreviewStream();
    setShowPreview(false);
  };

  const handleDeviceChange = async (type: 'camera' | 'mic', deviceId: string) => {
    if (type === 'camera') {
      setPreviewCameraId(deviceId);
    } else {
      setPreviewMicId(deviceId);
    }

    if (showPreview) {
      try {
        stopPreviewStream();
        await getPreviewStream(
          type === 'camera' ? deviceId : previewCameraId,
          type === 'mic' ? deviceId : previewMicId
        );
      } catch (error) {
        console.error("Failed to update preview:", error);
      }
    }
  };

  const handleReplaceStream = async () => {
    try {
      setIsLoading(true);
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: previewCameraId ? { deviceId: { exact: previewCameraId } } : true,
        audio: previewMicId ? { deviceId: { exact: previewMicId } } : true,
      });
      await replaceMediaStream(newStream);
      alert("Media stream replaced successfully!");
    } catch (error) {
      console.error("Failed to replace stream:", error);
      alert("Failed to replace media stream");
    } finally {
      setIsLoading(false);
    }
  };

  // Function to render participant videos based on layout rules
  const renderParticipantVideos = () => {
    const totalParticipants = participants.size + 1; // +1 for local user
    const remoteParticipantsList = Array.from(participants.values()).filter(
      (p: any) => !p.isLocal
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
          <video ref={videoRef} autoPlay playsInline muted/>
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
      ...remoteParticipantsList.map((p: any) => ({
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
                ? videoRef
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

          <div style={{ marginTop: '20px', width: '100%' }}>
            <h3 style={{ marginBottom: '10px' }}>Select Devices</h3>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <select
                value={previewCameraId}
                onChange={(e) => handleDeviceChange('camera', e.target.value)}
                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value="">Default Camera</option>
                {devices?.cameras?.map((camera: any) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                  </option>
                ))}
              </select>
              <select
                value={previewMicId}
                onChange={(e) => handleDeviceChange('mic', e.target.value)}
                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value="">Default Microphone</option>
                {devices?.microphones?.map((mic: any) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {!showPreview ? (
                <Button onClick={handleStartPreview} disabled={isLoading} style={{ flex: 1 }}>
                  Start Preview
                </Button>
              ) : (
                <Button onClick={handleStopPreview} style={{ flex: 1, background: '#dc3545' }}>
                  Stop Preview
                </Button>
              )}
            </div>
          </div>

          <Button onClick={handleJoinRoom} disabled={isLoading} style={{ marginTop: '20px' }}>
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
              $isActive={showDeviceSettings}
              onClick={() => setShowDeviceSettings(!showDeviceSettings)}
              title="Device settings"
            >
              <MdSettings size={20}/>
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

        {inRoom && (
          <DeviceSettingsPanel $show={showDeviceSettings}>
            <DeviceSettingsTitle>Device Settings</DeviceSettingsTitle>

            <DeviceGroup>
              <DeviceLabel>Camera</DeviceLabel>
              <DeviceSelect
                value={selectedDevices?.camera || ''}
                onChange={(e) => switchCamera(e.target.value)}
                disabled={!videoEnabled}
              >
                {devices?.cameras?.map((camera: any) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                  </option>
                ))}
              </DeviceSelect>
            </DeviceGroup>

            <DeviceGroup>
              <DeviceLabel>Microphone</DeviceLabel>
              <DeviceSelect
                value={selectedDevices?.microphone || ''}
                onChange={(e) => switchMicrophone(e.target.value)}
                disabled={!micEnabled}
              >
                {devices?.microphones?.map((mic: any) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label}
                  </option>
                ))}
              </DeviceSelect>
            </DeviceGroup>

            <DeviceGroup style={{ marginTop: '20px' }}>
              <DeviceLabel>Replace Entire Stream</DeviceLabel>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <select
                  value={previewCameraId}
                  onChange={(e) => setPreviewCameraId(e.target.value)}
                  style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="">Default Camera</option>
                  {devices?.cameras?.map((camera: any) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {camera.label}
                    </option>
                  ))}
                </select>
                <select
                  value={previewMicId}
                  onChange={(e) => setPreviewMicId(e.target.value)}
                  style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="">Default Microphone</option>
                  {devices?.microphones?.map((mic: any) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={handleReplaceStream} disabled={isLoading} style={{ width: '100%' }}>
                {isLoading ? "Replacing..." : "Replace Stream"}
              </Button>
            </DeviceGroup>
          </DeviceSettingsPanel>
        )}
      </VideoContainer>
    </Container>
  );
};
