// Styled Components
import styled from "styled-components";

export const Container = styled.div`
  padding: 30px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
  width: 100%;
  height: 100%;
`;
export const LoginSection = styled.div`
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;
export const VideoContainer = styled.div`
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
  width: 100%;
`;
export const MainVideoStyled = styled.div<{ $totalParticipants: number }>`
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
    transform: scaleX(-1);
  }
`;
export const ParticipantVideoContainer = styled.div<{
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
    transform: scaleX(-1);
  }

  &:hover .participant-actions {
    opacity: 1;
  }
`;
export const ParticipantInfo = styled.div`
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
export const OwnerBadge = styled.span`
  background: #ffd700;
  color: #000;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: bold;
`;
export const Button = styled.button<{ variant?: "primary" | "danger" }>`
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
export const Input = styled.input`
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  margin-bottom: 10px;
`;
export const ControlsContainer = styled.div`
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 20;
`;
export const ControlButton = styled.button<{
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
export const LocalVideoOverlay = styled.div`
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
export const ConfirmDialog = styled.div`
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
export const ConfirmBox = styled.div`
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;
export const ConfirmTitle = styled.h3`
  margin: 0 0 12px 0;
  font-size: 18px;
  color: #333;
`;
export const ConfirmMessage = styled.p`
  margin: 0 0 20px 0;
  font-size: 14px;
  color: #666;
  line-height: 1.5;
`;
export const ConfirmButtons = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
`;
export const ConfirmButton = styled.button<{ variant?: 'primary' | 'secondary' }>`
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
export const ParticipantActions = styled.div`
  position: absolute;
  bottom: 5px;
  left: 5px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.3s ease;
`;
export const PinButtonContainer = styled.div`
  position: relative;
`;
export const ActionButton = styled.button<{ $isActive?: boolean }>`
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
export const PinMenu = styled.div<{ $show: boolean }>`
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
export const PinMenuItem = styled.button<{ $disabled?: boolean }>`
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

export const DeviceSettingsPanel = styled.div<{ $show: boolean }>`
  position: absolute;
  bottom: 80px;
  right: 20px;
  background: rgba(30, 30, 30, 0.95);
  border-radius: 12px;
  padding: 20px;
  min-width: 300px;
  display: ${props => props.$show ? 'block' : 'none'};
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 1000;
`;

export const DeviceSettingsTitle = styled.h3`
  margin: 0 0 16px 0;
  color: white;
  font-size: 16px;
  font-weight: 600;
`;

export const DeviceGroup = styled.div`
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

export const DeviceLabel = styled.label`
  display: block;
  color: #ccc;
  font-size: 12px;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

export const DeviceSelect = styled.select`
  width: 100%;
  padding: 10px;
  background: rgba(50, 50, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: white;
  font-size: 14px;
  cursor: pointer;

  &:hover {
    border-color: rgba(255, 255, 255, 0.2);
  }

  &:focus {
    outline: none;
    border-color: #4CAF50;
  }

  option {
    background: #2a2a2a;
    color: white;
  }
`;
