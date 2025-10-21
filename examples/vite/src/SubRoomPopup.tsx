import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { MdClose, MdOpenInNew } from "react-icons/md";

const Overlay = styled.div`
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

const PopupContainer = styled.div`
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
`;

const Header = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f8f9fa;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 20px;
  color: #666;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    background: #e9ecef;
    color: #333;
  }
`;

const Content = styled.div`
  padding: 24px;
`;

const Step1Content = styled.div``;

const Step2Content = styled.div``;

const RoomCountSection = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.h3`
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
`;

const RoomCountInput = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const CountButton = styled.button<{ $disabled?: boolean }>`
  width: 36px;
  height: 36px;
  border: 1px solid #ddd;
  background: white;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  color: ${(props) => (props.$disabled ? "#ccc" : "#333")};

  &:hover:not(:disabled) {
    background: #f8f9fa;
    border-color: #999;
  }
`;

const CountDisplay = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: #333;
  min-width: 40px;
  text-align: center;
`;

const OptionSection = styled.div`
  margin-bottom: 24px;
`;

const OptionItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: #007bff;
    background: #f8fbff;
  }

  &.selected {
    border-color: #007bff;
    background: #f0f7ff;
  }
`;

const RadioButton = styled.div<{ $selected: boolean }>`
  width: 18px;
  height: 18px;
  border: 2px solid ${(props) => (props.$selected ? "#007bff" : "#ddd")};
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${(props) => (props.$selected ? "#007bff" : "transparent")};
  }
`;

const OptionText = styled.div`
  flex: 1;
`;

const OptionTitle = styled.div`
  font-weight: 500;
  color: #333;
  margin-bottom: 2px;
`;

const OptionDescription = styled.div`
  font-size: 12px;
  color: #666;
`;

// const ParticipantsPerRoom = styled.div`
//   display: flex;
//   align-items: center;
//   gap: 8px;
//   font-size: 14px;
//   color: #666;
// `;

const CreateButton = styled.button`
  width: 100%;
  background: #007bff;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;

  &:hover {
    background: #0056b3;
  }

  &:disabled {
    background: #6c757d;
    cursor: not-allowed;
  }
`;

// Step 2 Styles
const RoomsList = styled.div`
  max-height: 400px;
  overflow-y: auto;
  margin-bottom: 20px;
`;

const RoomCard = styled.div`
  border: 1px solid #e9ecef;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
`;

const RoomHeader = styled.div`
  background: #f8f9fa;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e9ecef;
`;

const RoomName = styled.div`
  font-weight: 600;
  color: #333;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ParticipantCount = styled.span`
  background: #6c757d;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
`;

const RoomContent = styled.div`
  padding: 12px 16px;
`;

const ParticipantItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f8f9fa;

  &:last-child {
    border-bottom: none;
  }
`;

const ParticipantInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ParticipantAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #007bff;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
`;

const ParticipantName = styled.div`
  color: #333;
  font-size: 14px;
`;

// const ParticipantActions = styled.div`
//   display: flex;
//   gap: 4px;
// `;

// const ActionButton = styled.button`
//   background: none;
//   border: 1px solid #ddd;
//   padding: 4px 8px;
//   border-radius: 4px;
//   font-size: 12px;
//   color: #666;
//   cursor: pointer;

//   &:hover {
//     background: #f8f9fa;
//     border-color: #999;
//   }
// `;

const FooterActions = styled.div`
  display: flex;
  gap: 12px;
`;

// const AddRoomButton = styled.button`
//   display: flex;
//   align-items: center;
//   gap: 8px;
//   background: none;
//   border: 1px dashed #ddd;
//   padding: 10px 16px;
//   border-radius: 6px;
//   color: #666;
//   cursor: pointer;
//   font-size: 14px;

//   &:hover {
//     border-color: #007bff;
//     color: #007bff;
//   }
// `;

const OpenAllButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: #28a745;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    background: #218838;
  }
`;

// Main Component
interface SubRoomPopupProps {
  isOpen: boolean;
  onClose: () => void;
  participants: any[];
  currentRoom: any;
  createSubRoom: any;
  setHasActiveSubRooms?: (hasActive: boolean) => void;
}

const SubRoomPopup: React.FC<SubRoomPopupProps> = ({
  isOpen,
  onClose,
  participants,
  currentRoom,
  createSubRoom,
  setHasActiveSubRooms,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [roomCount, setRoomCount] = useState(3);
  const [breakoutRooms, setBreakoutRooms] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const remoteParticipants = participants.filter(
    (p) => !p.isLocal && p.role !== "owner"
  );

  // Hàm chia participants random vào các phòng (Bước 1)
  const distributeParticipantsRandomly = (roomCount: number) => {
    const shuffledParticipants = [...remoteParticipants].sort(
      () => Math.random() - 0.5
    );
    const distributedRooms: any = [];

    for (let i = 0; i < roomCount; i++) {
      distributedRooms.push({
        room_name: `Room ${i + 1}`,
        participants: [],
      });
    }

    // Chia đều participants vào các phòng
    shuffledParticipants.forEach((participant, index) => {
      const roomIndex = index % roomCount;
      distributedRooms[roomIndex].participants.push({
        user_id: participant.userId,
        stream_id: participant.streamId,
      });
    });

    return distributedRooms;
  };

  useEffect(() => {
    if (isOpen) {
      // Reset về step 1 khi mở popup
      setStep(1);
      setRoomCount(2);
      setBreakoutRooms([]);
      setIsCreating(false);
    }
  }, [isOpen]);

  // Khi roomCount thay đổi, tự động chia lại participants
  useEffect(() => {
    if (isOpen && step === 2) {
      const distributedRooms = distributeParticipantsRandomly(roomCount);
      setBreakoutRooms(distributedRooms);
      console.log("🎲 Randomly distributed participants:", distributedRooms);
    }
  }, [isOpen, step, roomCount, remoteParticipants.length]);

  // Step 1 handlers
  const handleCreateBreakoutRooms = async () => {
    console.log("➡️ Moving to step 2 with room count:", roomCount);
    console.log(
      "👥 Total participants to distribute:",
      remoteParticipants.length
    );
    setStep(2);
  };

  if (!isOpen) return null;

  // Step 2 handlers: Create and open all breakout rooms
  const handleOpenAllRooms = async () => {
    if (!breakoutRooms.length || !currentRoom) {
      console.error("Cannot create rooms: Missing required data");
      alert("❌ Không thể tạo phòng: Thiếu dữ liệu cần thiết");
      return;
    }

    try {
      setIsCreating(true);
      console.log("🔄 Creating breakout rooms with configuration:", breakoutRooms);

      // Validate participants have required data
      const hasValidParticipants = breakoutRooms.every(room =>
        room.participants.every((p: any) => p.user_id && p.stream_id)
      );

      if (!hasValidParticipants) {
        throw new Error("Some participants are missing required data");
      }

      // Format data for API
      const formattedRooms = breakoutRooms.map((room) => ({
        room_name: room.room_name,
        participants: room.participants.map((p: any) => ({
          user_id: p.user_id,
          stream_id: p.stream_id,
        })),
      }));

      console.log("📦 Calling createSubRoom API with:", {
        main_room_id: currentRoom.id,
        rooms: formattedRooms,
      });

      const result = await createSubRoom({
        main_room_id: currentRoom.id,
        rooms: formattedRooms,
      });

      console.log("✅ Breakout rooms created:", result);
      alert(`🎉 Tạo breakout rooms thành công!`);

      onClose();
      setHasActiveSubRooms && setHasActiveSubRooms(true);
    } catch (error: any) {
      console.error("❌ Failed to create breakout rooms:", error);
      const errorMessage = error?.message || "Unknown error occurred";
      alert(`❌ Lỗi khi tạo breakout rooms: ${errorMessage}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Add a new room
  // const handleAddRoom = () => {
  //   setBreakoutRooms((prev) => [
  //     ...prev,
  //     {
  //       room_name: `Room ${prev.length + 1}`,
  //       participants: [],
  //     },
  //   ]);
  // };

  const getParticipantDisplayName = (participant: any) => {
    return participant.name || participant.user_id || "Unknown User";
  };

  const getParticipantInitial = (participant: any) => {
    const name = getParticipantDisplayName(participant);
    return name.charAt(0).toUpperCase();
  };

  // Tính participants per room (cho Bước 1)
  const participantsPerRoom = Math.ceil(remoteParticipants.length / roomCount);

  return (
    <Overlay onClick={onClose}>
      <PopupContainer onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>
            {step === 1
              ? "Create breakout room"
              : "Breakout Rooms Configuration"}
          </Title>
          <CloseButton onClick={onClose}>
            <MdClose />
          </CloseButton>
        </Header>

        <Content>
          {step === 1 ? (
            <Step1Content>
              <RoomCountSection>
                <SectionTitle>Create breakout rooms</SectionTitle>
                <RoomCountInput>
                  <CountButton
                    $disabled={roomCount <= 1}
                    onClick={() =>
                      setRoomCount((prev) => Math.max(1, prev - 1))
                    }
                  >
                    -
                  </CountButton>
                  <CountDisplay>{roomCount}</CountDisplay>
                  <CountButton onClick={() => setRoomCount((prev) => prev + 1)}>
                    +
                  </CountButton>
                </RoomCountInput>
              </RoomCountSection>

              <OptionSection>
                <SectionTitle>Assign participants</SectionTitle>
                <OptionItem className="selected">
                  <RadioButton $selected={true} />
                  <OptionText>
                    <OptionTitle>Assign automatically</OptionTitle>
                    <OptionDescription>
                      Participants will be randomly assigned to rooms
                    </OptionDescription>
                  </OptionText>
                </OptionItem>
              </OptionSection>

              {/* Thông tin summary cho Bước 1 */}
              <div
                style={{
                  background: "#e8f5e8",
                  padding: "15px",
                  borderRadius: "8px",
                  marginTop: "20px",
                  border: "1px solid #c8e6c9",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0", color: "#2e7d32" }}>
                  📊 Summary
                </h4>
                <div style={{ fontSize: "14px", color: "#555" }}>
                  <div>
                    • Số phòng sẽ tạo: <strong>{roomCount}</strong>
                  </div>
                  <div>
                    • Tổng số participants:{" "}
                    <strong>{remoteParticipants.length}</strong>
                  </div>
                  <div>
                    • Số participants mỗi phòng:{" "}
                    <strong>~{participantsPerRoom}</strong>
                  </div>
                </div>
              </div>

              <CreateButton
                onClick={handleCreateBreakoutRooms}
                disabled={remoteParticipants.length === 0}
              >
                Continue to Configuration
              </CreateButton>
            </Step1Content>
          ) : (
            <Step2Content>
              <div
                style={{
                  color: "#666",
                  fontSize: "14px",
                  marginBottom: "16px",
                }}
              >
                Participants have been randomly assigned to rooms
              </div>

              <div
                style={{
                  background: "#fff3cd",
                  padding: "12px",
                  borderRadius: "6px",
                  marginBottom: "16px",
                  fontSize: "14px",
                  color: "#856404",
                  border: "1px solid #ffeaa7",
                }}
              >
                <strong>🎲 Random Assignment Complete</strong>
                <br />
                {breakoutRooms.length} rooms created with{" "}
                {remoteParticipants.length} participants
              </div>

              <RoomsList>
                {breakoutRooms.map((room, roomIndex) => (
                  <RoomCard key={roomIndex}>
                    <RoomHeader>
                      <RoomName>{room.room_name} 🌐</RoomName>
                      <ParticipantCount>
                        {room.participants?.length || 0}
                      </ParticipantCount>
                    </RoomHeader>
                    <RoomContent>
                      {room.participants?.map(
                        (participant: any, participantIndex: number) => (
                          <ParticipantItem
                            key={participant.user_id || participantIndex}
                          >
                            <ParticipantInfo>
                              <ParticipantAvatar>
                                {getParticipantInitial(participant)}
                              </ParticipantAvatar>
                              <ParticipantName>
                                {getParticipantDisplayName(participant)}
                              </ParticipantName>
                            </ParticipantInfo>
                          </ParticipantItem>
                        )
                      )}
                      {(!room.participants ||
                        room.participants.length === 0) && (
                          <div
                            style={{
                              color: "#999",
                              fontSize: "14px",
                              textAlign: "center",
                              padding: "20px",
                            }}
                          >
                            No participants assigned
                          </div>
                        )}
                    </RoomContent>
                  </RoomCard>
                ))}
              </RoomsList>

              <FooterActions>
                <OpenAllButton
                  onClick={handleOpenAllRooms}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <>
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
                      Creating Rooms...
                    </>
                  ) : (
                    <>
                      <MdOpenInNew size={16} />
                      Create & Open Rooms
                    </>
                  )}
                </OpenAllButton>
              </FooterActions>

              <style>
                {`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}
              </style>
            </Step2Content>
          )}
        </Content>
      </PopupContainer>
    </Overlay>
  );
};

export default SubRoomPopup;
