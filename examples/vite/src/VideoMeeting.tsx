import { useEffect, useRef, useState } from "react";
import {
  MdMic,
  MdMicOff,
  MdPanTool,
  MdVideocam,
  MdVideocamOff,
  MdCallEnd,
  MdPushPin,
  MdOutlinePushPin,
  MdScreenShare,
  MdStopScreenShare,
  MdSettings,
  MdGroups,
  MdClose,
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
  ScreenShareBadge,
  VideoContainer,
  SidebarParticipants,
  PinnedVideoContainer
} from "./VideoMeeting.styles.tsx";
import { useErmisMeeting } from "./context";
import SubRoomPopup from "./SubRoomPopup";
import type { ScreenShareData } from "./context/ErmisClassroomProvider.tsx";

interface VideoMeetingProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

// Main Component
export default function VideoMeeting({ videoRef }: VideoMeetingProps) {
  const [userId, setUserId] = useState("khoaphan7795@gmail.com");
  const [roomCode, setRoomCode] = useState("5fb9-azht-t8d5");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pinMenuOpen, setPinMenuOpen] = useState<string | null>(null); // Stores participantId of open menu

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewCameraId, setPreviewCameraId] = useState<string>("");
  const [previewMicId, setPreviewMicId] = useState<string>("");

  // New states for room management
  const [currentView, setCurrentView] = useState<"join" | "create" | "list">("join");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomType, setNewRoomType] = useState("main");
  const [availableRooms, setAvailableRooms] = useState<any[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // SubRoom states
  const [showSubRoomPopup, setShowSubRoomPopup] = useState(false);
  const [hasActiveSubRooms, setHasActiveSubRooms] = useState(false);
  const [isClosingSubRooms, setIsClosingSubRooms] = useState(false);

  const {
    participants,
    remoteStreams,
    localStream,
    previewStream,
    authenticate,
    joinRoom,
    videoEnabled,
    micEnabled,
    handRaised,
    inRoom,
    currentRoom,
    leaveRoom,
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
    client,
    screenShareStreams,
    isScreenSharing,
    toggleScreenShare,

    createSubRoom,
    closeSubRoom,
  } = useErmisMeeting();

  // console.log('---participants--', participants);
  console.log('---currentRoom--', currentRoom);


  useEffect(() => {
    if (videoRef?.current) {
      if (inRoom && localStream) {
        videoRef.current.srcObject = localStream;
      } else if (!inRoom && previewStream) {
        videoRef.current.srcObject = previewStream;
      }
    }
  }, [videoRef, localStream, previewStream, inRoom]);

  // Set srcObject for local video ref when in room
  useEffect(() => {
    if (localVideoRef?.current && inRoom && localStream) {
      console.log("Setting local video stream:", localStream);
      localVideoRef.current.srcObject = localStream;
    }
  }, [localVideoRef, localStream, inRoom]);

  // Listen for sub room creation events
  useEffect(() => {
    if (currentRoom && currentRoom.ownerId === userId && currentRoom.subRooms.size > 0) {
      setHasActiveSubRooms(true);
    }
  }, [currentRoom]);

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

  // Set srcObject for screen share streams when they change
  useEffect(() => {
    console.log("Setting srcObject for screen share streams:", screenShareStreams);

    // Set streams for active screen shares
    screenShareStreams?.forEach((data: any, userId: any) => {
      const videoId = `${userId}-screenshare`;
      const videoElement = videoRefs.current.get(videoId);
      if (videoElement && data.stream) {
        console.log(`Setting srcObject for ${videoId}:`, data.stream);
        console.log(`Stream active:`, data.stream.active);
        console.log(`Stream tracks:`, data.stream.getTracks());
        videoElement.srcObject = data.stream;
        videoElement.play().catch(e => console.warn("Video play failed:", e));
      } else {
        console.warn(`Cannot set srcObject for ${videoId}:`, {
          hasElement: !!videoElement,
          hasStream: !!data.stream
        });
      }
    });

    // Cleanup: Remove srcObject from video elements that are no longer in screenShareStreams
    return () => {
      videoRefs.current.forEach((videoElement, videoId) => {
        if (videoId.endsWith('-screenshare')) {
          const userId = videoId.replace('-screenshare', '');
          if (!screenShareStreams?.has(userId)) {
            console.log(`Cleaning up video element for ${videoId}`);
            if (videoElement.srcObject) {
              videoElement.srcObject = null;
            }
          }
        }
      });
    };
  }, [screenShareStreams]);
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
      await getPreviewStream(
        previewCameraId || undefined,
        previewMicId || undefined
      );
      setShowPreview(true);
    } catch (error) {
      console.error("Failed to start preview:", error);
      alert(
        "Failed to start preview. Please check camera/microphone permissions."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopPreview = () => {
    stopPreviewStream();
    setShowPreview(false);
  };

  const handleDeviceChange = async (
    type: "camera" | "mic",
    deviceId: string
  ) => {
    if (type === "camera") {
      setPreviewCameraId(deviceId);
    } else {
      setPreviewMicId(deviceId);
    }

    if (showPreview) {
      try {
        stopPreviewStream();
        await getPreviewStream(
          type === "camera" ? deviceId : previewCameraId,
          type === "mic" ? deviceId : previewMicId
        );
      } catch (error) {
        console.error("Failed to update preview:", error);
      }
    }
  };

  const handleReplaceStream = async () => {
    try {
      // setIsLoading(true);
      // const newStream = await navigator.mediaDevices.getUserMedia({
      //   video: previewCameraId
      //     ? { deviceId: { exact: previewCameraId } }
      //     : true,
      //   audio: previewMicId ? { deviceId: { exact: previewMicId } } : true,
      // });
      // await replaceMediaStream(newStream);
      // console.log("Media stream replaced successfully!");
    } catch (error) {
      console.error("Failed to replace stream:", error);
      console.log("Failed to replace media stream");
    } finally {
      setIsLoading(false);
    }
  };

  // Create room function
  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      alert("Please enter a room name");
      return;
    }

    try {
      setIsCreatingRoom(true);
      const room = await client.createRoom({
        name: newRoomName,
        type: newRoomType,
        autoJoin: false, // Don't auto-join, let user choose
      });

      console.log("Room created successfully:", room);
      alert(`Room created! Room code: ${room.code}`);

      // Reset form
      setNewRoomName("");
      setNewRoomType("main");

      // Switch to room list to show the new room
      setCurrentView("list");
      await fetchAvailableRooms();
    } catch (error) {
      console.error("Failed to create room:", error);
      alert("Failed to create room. Please try again.");
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // Fetch available rooms function
  const fetchAvailableRooms = async () => {
    try {
      setIsLoadingRooms(true);
      const rooms = await client.getRooms({ page: 1, perPage: 20 });
      console.log("Fetched rooms:", rooms);

      setAvailableRooms(rooms.filter((room: any) => room.room_type !== 'sub') || []);
    } catch (error) {
      console.error("Failed to fetch rooms:", error);
      alert("Failed to fetch rooms. Please try again.");
    } finally {
      setIsLoadingRooms(false);
    }
  };

  // Join room from list
  const handleJoinRoomFromList = async (room: any) => {
    try {
      setIsLoading(true);
      setRoomCode(room.room_code);

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

      await joinRoom(room.room_code, streamToUse);
      setCurrentView("join"); // Reset view after joining
    } catch (error) {
      console.error("Failed to join room:", error);
      alert("Failed to join room");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle close sub rooms
  const handleCloseSubRooms = async () => {
    try {
      setIsClosingSubRooms(true);
      await closeSubRoom();
      setHasActiveSubRooms(false);
      alert("✅ Sub rooms đã được đóng thành công!");
    } catch (error) {
      console.error("Failed to close sub rooms:", error);
      alert("❌ Lỗi khi đóng sub rooms. Vui lòng thử lại.");
    } finally {
      setIsClosingSubRooms(false);
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

    // If only 1 participant and no screen shares, show full screen
    if (totalParticipants === 1 && (!screenShareStreams || screenShareStreams.size === 0)) {
      // Only local user - show full screen
      return (
        <ParticipantVideoContainer
          key="local"
          $isPinned={pinnedUserId === userId}
        >
          <video ref={localVideoRef} autoPlay playsInline muted />
          {!videoEnabled && (
            <LocalVideoOverlay>
              <MdVideocamOff />
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            You ({userId})
            {!micEnabled && (
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
                {pinnedUserId === userId ? (
                  <MdPushPin size={16} />
                ) : (
                  <MdOutlinePushPin size={16} />
                )}
              </ActionButton>

              <PinMenu $show={pinMenuOpen === userId}>
                <PinMenuItem onClick={() => togglePin(userId, "local")}>
                  <MdPushPin size={14} />
                  Pin locally
                </PinMenuItem>
                <PinMenuItem
                  $disabled={!isHost}
                  onClick={() => togglePin(userId, "everyone")}
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

    // Add screen share tiles
    console.log("Screen share streams in render:", screenShareStreams);
    console.log("Screen share streams size:", screenShareStreams?.size || 0);
    const screenShareTiles = Array.from(
      screenShareStreams?.entries() || [],
      ([screenShareUserId, data]: [string, ScreenShareData]) => ({
        userId: `${screenShareUserId}-screenshare`,
        isLocal: screenShareUserId === userId,
        isAudioEnabled: false,
        isVideoEnabled: true,
        isScreenShare: true,
        screenShareUserId: screenShareUserId,
        userName: data.userName,
        stream: data.stream,
        role: undefined,
      })
    );
    console.log("Screen share tiles:", screenShareTiles);

    // Combine regular participants with screen share tiles
    const allTiles = [...allParticipants, ...screenShareTiles];
    console.log("All tiles (participants + screen shares):", allTiles);

    // Check if there's a pinned participant
    const hasPinned = !!pinnedUserId;
    const pinnedParticipant = hasPinned ? allTiles.find(p => p.userId === pinnedUserId) : null;
    const unpinnedParticipants = hasPinned ? allTiles.filter(p => p.userId !== pinnedUserId) : allTiles;

    // Helper function to render a single participant
    const renderParticipant = (participant: any, isInSidebar: boolean = false) => {
      const isPinned = pinnedUserId === participant.userId;
      const isScreenShareTile = participant.isScreenShare === true;

      return (
        <ParticipantVideoContainer
          key={participant.userId}
          $isPinned={isPinned}
          $isScreenShare={isScreenShareTile}
          $isInSidebar={isInSidebar}
        >
          <video
            autoPlay
            playsInline
            muted={participant.isLocal && isScreenShareTile}
            ref={
              participant.isLocal && !isScreenShareTile
                ? localVideoRef
                : (videoElement) => {
                  if (videoElement) {
                    videoRefs.current.set(participant.userId, videoElement);
                    if (participant.stream) {
                      console.log(`Setting srcObject for ${participant.userId}:`, participant.stream);
                      videoElement.srcObject = participant.stream;
                    }
                  } else {
                    videoRefs.current.delete(participant.userId);
                  }
                }
            }
          />
          {/* Show camera off overlay for both local and remote (but not for screen shares) */}
          {!participant.isVideoEnabled && !isScreenShareTile && (
            <LocalVideoOverlay>
              <MdVideocamOff />
            </LocalVideoOverlay>
          )}
          <ParticipantInfo>
            {isScreenShareTile
              ? participant.isLocal
                ? "You"
                : participant.userName
              : participant.isLocal ? "You" : participant.userId
            }
            {!participant.isAudioEnabled && !isScreenShareTile && (
              <span>
                <MdMicOff />
              </span>
            )}
            {participant.role === "owner" && !isScreenShareTile && <OwnerBadge>OWNER</OwnerBadge>}
            {isScreenShareTile && (
              <ScreenShareBadge>
                <MdScreenShare size={12} />
                SCREEN SHARE
              </ScreenShareBadge>
            )}
            {!isScreenShareTile && (participant as any).isScreenSharing && (
              <span title="Sharing screen">📺</span>
            )}
            {!isScreenShareTile && (participant as any).isHandRaised && (
              <span title="Hand raised" style={{ color: "#ffa500" }}>
                <MdPanTool />
              </span>
            )}
            {isPinned && !isInSidebar && (
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
                  setPinMenuOpen(
                    pinMenuOpen === participant.userId
                      ? null
                      : participant.userId
                  );
                }}
                title="Pin options"
              >
                {isPinned ? (
                  <MdPushPin size={16} />
                ) : (
                  <MdOutlinePushPin size={16} />
                )}
              </ActionButton>

              <PinMenu $show={pinMenuOpen === participant.userId}>
                <PinMenuItem
                  onClick={() => togglePin(participant.userId, "local")}
                >
                  <MdPushPin size={14} />
                  Pin locally
                </PinMenuItem>
                <PinMenuItem
                  $disabled={!isHost}
                  onClick={() => togglePin(participant.userId, "everyone")}
                >
                  <MdPushPin size={14} />
                  Pin for everyone
                </PinMenuItem>
              </PinMenu>
            </PinButtonContainer>
          </ParticipantActions>
        </ParticipantVideoContainer>
      );
    };

    // If someone is pinned, show pinned layout
    if (hasPinned && pinnedParticipant) {
      return (
        <>
          <SidebarParticipants>
            {unpinnedParticipants.map((p) => renderParticipant(p, true))}
          </SidebarParticipants>
          <PinnedVideoContainer>
            {renderParticipant(pinnedParticipant, false)}
          </PinnedVideoContainer>
        </>
      );
    }

    // No pinned participant, show normal grid
    return allTiles.map((participant: any) => renderParticipant(participant, false));
  };

  return (
    <Container>
      {/* Login Section */}
      {!isConnected && (
        <LoginSection>
          <h2 style={{ color: "black" }}>Join Meeting</h2>
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

      {/* Room Management Section */}
      {isConnected && !inRoom && (
        <LoginSection>
          {/* Navigation Tabs */}
          <div style={{
            display: "flex",
            borderBottom: "2px solid #e0e0e0",
            marginBottom: "20px",
            backgroundColor: "#f8f9fa"
          }}>
            <div
              onClick={() => setCurrentView("join")}
              style={{
                flex: 1,
                padding: "12px 20px",
                textAlign: "center",
                cursor: "pointer",
                borderBottom: currentView === "join" ? "3px solid #007bff" : "3px solid transparent",
                backgroundColor: currentView === "join" ? "#ffffff" : "transparent",
                color: currentView === "join" ? "#007bff" : "#6c757d",
                fontWeight: currentView === "join" ? "600" : "normal",
                transition: "all 0.3s ease",
                borderTopLeftRadius: "8px",
                borderTopRightRadius: currentView === "join" ? "8px" : "0px"
              }}
              onMouseEnter={(e) => {
                if (currentView !== "join") {
                  e.currentTarget.style.backgroundColor = "#f0f0f0";
                  e.currentTarget.style.color = "#495057";
                }
              }}
              onMouseLeave={(e) => {
                if (currentView !== "join") {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6c757d";
                }
              }}
            >
              Join Room
            </div>
            <div
              onClick={() => setCurrentView("create")}
              style={{
                flex: 1,
                padding: "12px 20px",
                textAlign: "center",
                cursor: "pointer",
                borderBottom: currentView === "create" ? "3px solid #007bff" : "3px solid transparent",
                backgroundColor: currentView === "create" ? "#ffffff" : "transparent",
                color: currentView === "create" ? "#007bff" : "#6c757d",
                fontWeight: currentView === "create" ? "600" : "normal",
                transition: "all 0.3s ease"
              }}
              onMouseEnter={(e) => {
                if (currentView !== "create") {
                  e.currentTarget.style.backgroundColor = "#f0f0f0";
                  e.currentTarget.style.color = "#495057";
                }
              }}
              onMouseLeave={(e) => {
                if (currentView !== "create") {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6c757d";
                }
              }}
            >
              Create Room
            </div>
            <div
              onClick={() => {
                setCurrentView("list");
                fetchAvailableRooms();
              }}
              style={{
                flex: 1,
                padding: "12px 20px",
                textAlign: "center",
                cursor: "pointer",
                borderBottom: currentView === "list" ? "3px solid #007bff" : "3px solid transparent",
                backgroundColor: currentView === "list" ? "#ffffff" : "transparent",
                color: currentView === "list" ? "#007bff" : "#6c757d",
                fontWeight: currentView === "list" ? "600" : "normal",
                transition: "all 0.3s ease",
                borderTopRightRadius: "8px",
                borderTopLeftRadius: currentView === "list" ? "8px" : "0px"
              }}
              onMouseEnter={(e) => {
                if (currentView !== "list") {
                  e.currentTarget.style.backgroundColor = "#f0f0f0";
                  e.currentTarget.style.color = "#495057";
                }
              }}
              onMouseLeave={(e) => {
                if (currentView !== "list") {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6c757d";
                }
              }}
            >
              Room List
            </div>
          </div>

          {/* Join Room Section */}
          {currentView === "join" && (
            <>
              <h2>Join Room</h2>
              <Input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="Enter room code"
                onKeyPress={(e) => e.key === "Enter" && handleJoinRoom()}
              />
            </>
          )}

          {/* Create Room Section */}
          {currentView === "create" && (
            <>
              <h2>Create New Room</h2>
              <Input
                type="text"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Enter room name"
                style={{ marginBottom: "10px" }}
              />
              <select
                value={newRoomType}
                onChange={(e) => setNewRoomType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  marginBottom: "20px",
                  fontSize: "16px",
                }}
              >
                <option value="main">Main Room</option>
                <option value="breakout">Breakout Room</option>
                <option value="presentation">Presentation Room</option>
                <option value="discussion">Discussion Room</option>
              </select>
              <Button
                onClick={handleCreateRoom}
                disabled={isCreatingRoom || !newRoomName.trim()}
                style={{ marginBottom: "20px" }}
              >
                {isCreatingRoom ? "Creating..." : "Create Room"}
              </Button>
            </>
          )}

          {/* Room List Section */}
          {currentView === "list" && (
            <>
              <h2>Available Rooms</h2>
              <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                <Button
                  onClick={fetchAvailableRooms}
                  disabled={isLoadingRooms}
                  style={{ flex: 1 }}
                >
                  {isLoadingRooms ? "Loading..." : "Refresh"}
                </Button>
              </div>

              <div
                style={{
                  maxHeight: "300px",
                  overflowY: "auto",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  padding: "10px",
                  marginBottom: "20px",
                }}
              >
                {isLoadingRooms ? (
                  <p>Loading rooms...</p>
                ) : availableRooms.length === 0 ? (
                  <p>No rooms available</p>
                ) : (
                  availableRooms.map((room) => (
                    <div
                      key={room.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px",
                        border: "1px solid #eee",
                        borderRadius: "4px",
                        marginBottom: "8px",
                        backgroundColor: "#f9f9f9",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: "bold", color: "#333" }}>
                          {room.room_name}
                        </div>
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          Code: {room.room_code} | Type: {room.room_type}
                        </div>
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          Created: {new Date(room.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <Button
                        onClick={() => handleJoinRoomFromList(room)}
                        disabled={isLoading}
                        style={{
                          padding: "6px 12px",
                          fontSize: "12px",
                          background: "#28a745",
                        }}
                      >
                        {isLoading ? "Joining..." : "Join"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {(currentView === "join" || currentView === "create") && (
            <>
              <div style={{ marginTop: "20px", width: "100%" }}>
                <h3 style={{ marginBottom: "10px" }}>Select Devices</h3>
                <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                  <select
                    value={previewCameraId}
                    onChange={(e) => handleDeviceChange("camera", e.target.value)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                    }}
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
                    onChange={(e) => handleDeviceChange("mic", e.target.value)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                    }}
                  >
                    <option value="">Default Microphone</option>
                    {devices?.microphones?.map((mic: any) => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  {!showPreview ? (
                    <Button
                      onClick={handleStartPreview}
                      disabled={isLoading}
                      style={{ flex: 1 }}
                    >
                      Start Preview
                    </Button>
                  ) : (
                    <Button
                      onClick={handleStopPreview}
                      style={{ flex: 1, background: "#dc3545" }}
                    >
                      Stop Preview
                    </Button>
                  )}
                </div>
              </div>

              {currentView === "join" && (
                <Button
                  onClick={handleJoinRoom}
                  disabled={isLoading}
                  style={{ marginTop: "20px" }}
                >
                  {isLoading ? "Joining..." : "Join Room"}
                </Button>
              )}
            </>
          )}
        </LoginSection>
      )}

      <VideoContainer style={{ display: inRoom ? "block" : "none" }}>
        <MainVideoStyled
          $totalParticipants={participants.size + 1 + (screenShareStreams?.size || 0)}
          $hasPinned={!!currentRoom?.pinnedParticipant?.userId}
        >
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
              {micEnabled ? <MdMic size={20} /> : <MdMicOff size={20} />}
            </ControlButton>

            <ControlButton
              variant="video"
              $isActive={videoEnabled}
              onClick={toggleCamera}
              title={videoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {videoEnabled ? (
                <MdVideocam size={20} />
              ) : (
                <MdVideocamOff size={20} />
              )}
            </ControlButton>

            <ControlButton
              $isActive={handRaised}
              onClick={toggleRaiseHand}
              title={handRaised ? "Lower hand" : "Raise hand"}
            >
              <MdPanTool size={20} />
            </ControlButton>

            <ControlButton
              $isActive={isScreenSharing}
              onClick={toggleScreenShare}
              title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
            >
              {isScreenSharing ? (
                <MdStopScreenShare size={20} />
              ) : (
                <MdScreenShare size={20} />
              )}
            </ControlButton>

            <ControlButton
              $isActive={showDeviceSettings}
              onClick={() => setShowDeviceSettings(!showDeviceSettings)}
              title="Device settings"
            >
              <MdSettings size={20} />
            </ControlButton>

            {/* SubRoom button - only show for hosts */}
            {currentRoom?.localParticipant?.role === "owner" && (
              <>
                <ControlButton
                  onClick={() => setShowSubRoomPopup(true)}
                  title="Create Breakout Rooms"
                >
                  <MdGroups size={20} />
                </ControlButton>

                {/* Close Sub Rooms button - only show when there are active sub rooms */}
                {hasActiveSubRooms && (
                  <ControlButton
                    variant="leave"
                    onClick={handleCloseSubRooms}
                    disabled={isClosingSubRooms}
                    title="Close All Sub Rooms"
                  >
                    {isClosingSubRooms ? (
                      <div
                        style={{
                          width: "16px",
                          height: "16px",
                          border: "2px solid transparent",
                          borderTop: "2px solid white",
                          borderRadius: "50%",
                          animation: "spin 1s linear infinite",
                        }}
                      />
                    ) : (
                      <MdClose size={20} />
                    )}
                  </ControlButton>
                )}
              </>
            )}

            <ControlButton
              variant="leave"
              onClick={leaveRoom}
              title="Leave room"
            >
              <MdCallEnd size={20} />
            </ControlButton>
          </ControlsContainer>
        )}

        {inRoom && (
          <DeviceSettingsPanel $show={showDeviceSettings}>
            <DeviceSettingsTitle>Device Settings</DeviceSettingsTitle>

            <DeviceGroup>
              <DeviceLabel>Camera</DeviceLabel>
              <DeviceSelect
                value={selectedDevices?.camera || ""}
                onChange={(e) => {
                  console.log(e.target.value);
                  switchCamera(e.target.value);
                }}
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
                value={selectedDevices?.microphone || ""}
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

            <DeviceGroup style={{ marginTop: "20px" }}>
              <DeviceLabel>Replace Entire Stream</DeviceLabel>
              <div
                style={{ display: "flex", gap: "10px", marginBottom: "10px" }}
              >
                <select
                  value={previewCameraId}
                  onChange={(e) => setPreviewCameraId(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                  }}
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
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                  }}
                >
                  <option value="">Default Microphone</option>
                  {devices?.microphones?.map((mic: any) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={handleReplaceStream}
                disabled={isLoading}
                style={{ width: "100%" }}
              >
                {isLoading ? "Replacing..." : "Replace Stream"}
              </Button>
            </DeviceGroup>
          </DeviceSettingsPanel>
        )}
      </VideoContainer>

      {/* SubRoom Popup */}
      <SubRoomPopup
        isOpen={showSubRoomPopup}
        onClose={() => setShowSubRoomPopup(false)}
        participants={Array.from(participants.values())}
        currentRoom={currentRoom}
        createSubRoom={createSubRoom}
        setHasActiveSubRooms={setHasActiveSubRooms}
      />
    </Container>
  );
}