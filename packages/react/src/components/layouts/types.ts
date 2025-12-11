import type { ReactNode, HTMLAttributes } from 'react';

export interface ParticipantData {
  id: string;
  stream: MediaStream | null;
  name: string;
  isLocal?: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isHandRaised?: boolean;
  isPinned?: boolean;
}

export interface ScreenShareData {
  id: string;
  stream: MediaStream;
  userName: string;
  isPinned?: boolean;
}

export interface GridLayoutInfo {
  columns: number;
  rows: number;
  maxTiles: number;
  tileWidth: number;
  tileHeight: number;
}

export interface GridLayoutProps extends HTMLAttributes<HTMLDivElement> {
  participants: ParticipantData[];
  screenShares?: ScreenShareData[];
  children?: ReactNode;
  gap?: number;
  onParticipantClick?: (participant: ParticipantData) => void;
  renderParticipant?: (participant: ParticipantData, size: { width: number; height: number }) => ReactNode;
  renderScreenShare?: (screenShare: ScreenShareData, size: { width: number; height: number }) => ReactNode;
}

export interface CarouselLayoutProps extends HTMLAttributes<HTMLDivElement> {
  participants: ParticipantData[];
  screenShares?: ScreenShareData[];
  children?: ReactNode;
  orientation?: 'horizontal' | 'vertical';
  tileWidth?: number;
  tileHeight?: number;
  gap?: number;
  maxVisibleTiles?: number;
  onParticipantClick?: (participant: ParticipantData) => void;
  renderParticipant?: (participant: ParticipantData, size: { width: number; height: number }) => ReactNode;
  renderScreenShare?: (screenShare: ScreenShareData, size: { width: number; height: number }) => ReactNode;
}

export interface FocusLayoutProps extends HTMLAttributes<HTMLDivElement> {
  participants: ParticipantData[];
  screenShares?: ScreenShareData[];
  children?: ReactNode;
  focusedParticipantId?: string;
  sidebarWidth?: number;
  sidebarTileHeight?: number;
  gap?: number;
  onParticipantClick?: (participant: ParticipantData) => void;
  renderParticipant?: (participant: ParticipantData, size: { width: number; height: number }) => ReactNode;
  renderScreenShare?: (screenShare: ScreenShareData, size: { width: number; height: number }) => ReactNode;
  renderOverflow?: (count: number, size: { width: number; height: number }) => ReactNode;
}

export interface FocusLayoutContainerProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export interface ParticipantTileProps extends HTMLAttributes<HTMLDivElement> {
  participant: ParticipantData;
  width?: number;
  height?: number;
  onPin?: (participantId: string) => void;
}

export interface ScreenShareTileProps extends HTMLAttributes<HTMLDivElement> {
  screenShare: ScreenShareData;
  width?: number;
  height?: number;
}

export interface PaginationState {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginationActions {
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
}

