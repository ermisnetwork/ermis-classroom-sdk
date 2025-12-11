import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import {
  useErmisClassroom,
  useMediaDevices,
  GridLayout,
  FocusLayout,
  type ParticipantData,
  type ScreenShareData as LayoutScreenShareData,
  type TileData,
} from "@ermisnetwork/ermis-classroom-react"
import { Button } from "@/components/ui/button"
import {
  IconMicrophone, IconMicrophoneOff, IconVideo, IconVideoOff, IconPhoneOff, IconScreenShare, IconHandStop, IconScreenShareOff, IconPin, IconPinnedOff, IconChevronUp
} from "@tabler/icons-react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { cn } from "@/lib/utils"

interface MeetingRoomProps {
  onLeft: () => void
}

function CustomParticipantTile({
  participant,
  size,
  onPin,
  canPin,
}: {
  participant: ParticipantData
  size: { width: number; height: number }
  onPin?: (id: string) => void
  canPin: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream
    }
  }, [participant.stream])

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPin?.(participant.id)
  }

  return (
    <div
      className={cn(
        "relative bg-slate-800 rounded-lg overflow-hidden group",
        participant.isPinned && "ring-2 ring-blue-500"
      )}
      style={{ width: size.width, height: size.height }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        className={cn("w-full h-full object-fill", participant.isVideoOff && "hidden")}
      />
      {participant.isVideoOff && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-700">
          <div className="h-16 w-16 rounded-full bg-slate-600 flex items-center justify-center">
            <span className="text-2xl font-semibold text-white">
              {participant.name.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}
      {canPin && onPin && (
        <button
          onClick={handlePinClick}
          className={cn(
            "absolute top-2 right-2 p-1.5 rounded-full transition-opacity",
            "bg-black/50 hover:bg-black/70",
            participant.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          title={participant.isPinned ? "Unpin" : "Pin"}
        >
          {participant.isPinned ? (
            <IconPinnedOff className="h-4 w-4 text-white" />
          ) : (
            <IconPin className="h-4 w-4 text-white" />
          )}
        </button>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium truncate">
            {participant.name} {participant.isLocal && "(You)"}
          </span>
          <div className="flex items-center gap-1">
            {participant.isPinned && (
              <div className="p-1 rounded bg-blue-500">
                <IconPin className="h-3 w-3 text-white" />
              </div>
            )}
            {participant.isHandRaised && (
              <div className="p-1 rounded bg-yellow-500">
                <IconHandStop className="h-3 w-3 text-white" />
              </div>
            )}
            {participant.isMuted && (
              <div className="p-1 rounded bg-red-500">
                <IconMicrophoneOff className="h-3 w-3 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CustomTile({
  tile,
  size,
  onPin,
  canPin,
}: {
  tile: TileData
  size: { width: number; height: number }
  onPin?: (id: string) => void
  canPin: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && tile.stream) {
      videoRef.current.srcObject = tile.stream
    }
  }, [tile.stream])

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPin?.(tile.id)
  }

  const isScreenShare = tile.type === 'screenShare'

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden group",
        isScreenShare ? "bg-slate-900" : "bg-slate-800",
        tile.isPinned && "ring-2 ring-blue-500"
      )}
      style={{ width: size.width, height: size.height }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={cn(
          "w-full h-full",
          isScreenShare ? "object-contain" : "object-cover",
          !isScreenShare && tile.isVideoOff && "hidden"
        )}
      />
      {!isScreenShare && tile.isVideoOff && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-700">
          <div className="h-16 w-16 rounded-full bg-slate-600 flex items-center justify-center">
            <span className="text-2xl font-semibold text-white">
              {tile.name.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}
      {canPin && onPin && (
        <button
          onClick={handlePinClick}
          className={cn(
            "absolute top-2 right-2 p-1.5 rounded-full transition-opacity",
            "bg-black/50 hover:bg-black/70",
            tile.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          title={tile.isPinned ? "Unpin" : "Pin"}
        >
          {tile.isPinned ? (
            <IconPinnedOff className="h-4 w-4 text-white" />
          ) : (
            <IconPin className="h-4 w-4 text-white" />
          )}
        </button>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium truncate flex items-center gap-1">
            {isScreenShare && <IconScreenShare className="h-4 w-4" />}
            {tile.name} {tile.isLocal && "(You)"}
            {isScreenShare && "'s screen"}
          </span>
          <div className="flex items-center gap-1">
            {tile.isPinned && (
              <div className="p-1 rounded bg-blue-500">
                <IconPin className="h-3 w-3 text-white" />
              </div>
            )}
            {tile.isHandRaised && (
              <div className="p-1 rounded bg-yellow-500">
                <IconHandStop className="h-3 w-3 text-white" />
              </div>
            )}
            {tile.isMuted && (
              <div className="p-1 rounded bg-red-500">
                <IconMicrophoneOff className="h-3 w-3 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MeetingRoom({ onLeft }: MeetingRoomProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    participants,
    remoteStreams,
    localStream,
    micEnabled,
    videoEnabled,
    handRaised,
    isScreenSharing,
    screenShareStreams,
    toggleMicrophone,
    toggleCamera,
    toggleRaiseHand,
    toggleScreenShare,
    leaveRoom,
    userId,
    currentRoom,
    togglePin,
  } = useErmisClassroom()

  const {
    microphones,
    cameras,
    selectedMicrophone,
    selectedCamera,
    selectMicrophone,
    selectCamera,
  } = useMediaDevices()

  const [localPinnedUserId, setLocalPinnedUserId] = useState<string | null>(null)

  const remotePinnedUserId = currentRoom?.pinnedParticipant?.userId || null

  useEffect(() => {
    if (remotePinnedUserId && remotePinnedUserId !== localPinnedUserId) {
      setLocalPinnedUserId(remotePinnedUserId)
    }
  }, [remotePinnedUserId, localPinnedUserId])

  const pinnedUserId = localPinnedUserId

  const handleLeave = async () => {
    try {
      await leaveRoom()
      onLeft()
    } catch (err) {
      console.error("Failed to leave room:", err)
    }
  }

  const participantList = useMemo(() => {
    return Array.from(participants.values())
  }, [participants])

  const totalParticipants = useMemo(() => {
    return 1 + participantList.filter(p => p.userId !== userId).length
  }, [participantList, userId])

  const canPin = totalParticipants > 1

  const handlePin = useCallback((participantId: string) => {
    if (!canPin) return
    if (localPinnedUserId === participantId) {
      setLocalPinnedUserId(null)
    } else {
      setLocalPinnedUserId(participantId)
    }
    togglePin(participantId, 'local')
  }, [localPinnedUserId, togglePin, canPin])

  const allTiles: TileData[] = useMemo(() => {
    const tiles: TileData[] = []

    Array.from(screenShareStreams.entries())
      .filter(([, data]) => data.stream)
      .forEach(([id, data]) => {
        tiles.push({
          id: `screen-${id}`,
          stream: data.stream!,
          name: data.userName,
          type: 'screenShare',
          isPinned: pinnedUserId === `screen-${id}`,
        })
      })

    tiles.push({
      id: userId || 'local',
      stream: localStream,
      name: userId || 'You',
      type: 'participant',
      isLocal: true,
      isMuted: !micEnabled,
      isVideoOff: !videoEnabled,
      isHandRaised: false,
      isPinned: pinnedUserId === (userId || 'local'),
    })

    participantList
      .filter((p) => p.userId !== userId)
      .forEach((participant) => {
        tiles.push({
          id: participant.userId,
          stream: remoteStreams.get(participant.userId) || null,
          name: participant.userId,
          type: 'participant',
          isLocal: false,
          isMuted: !participant.isAudioEnabled,
          isVideoOff: !participant.isVideoEnabled,
          isHandRaised: participant.isHandRaised,
          isPinned: pinnedUserId === participant.userId,
        })
      })

    return tiles
  }, [userId, localStream, micEnabled, videoEnabled, participantList, remoteStreams, pinnedUserId, screenShareStreams])

  const allParticipants: ParticipantData[] = useMemo(() => {
    return allTiles.filter(t => t.type === 'participant') as ParticipantData[]
  }, [allTiles])

  const screenShares: LayoutScreenShareData[] = useMemo(() => {
    return Array.from(screenShareStreams.entries())
      .filter(([, data]) => data.stream)
      .map(([id, data]) => ({
        id,
        stream: data.stream!,
        userName: data.userName,
      }))
  }, [screenShareStreams])

  const renderTile = useCallback(
    (tile: TileData, size: { width: number; height: number }) => (
      <CustomTile
        tile={tile}
        size={size}
        onPin={handlePin}
        canPin={canPin}
      />
    ),
    [handlePin, canPin]
  )

  const renderParticipant = useCallback(
    (participant: ParticipantData, size: { width: number; height: number }) => (
      <CustomParticipantTile
        participant={participant}
        size={size}
        onPin={handlePin}
        canPin={canPin}
      />
    ),
    [handlePin, canPin]
  )

  const renderScreenShare = useCallback(
    (screenShare: LayoutScreenShareData, size: { width: number; height: number }) => (
      <CustomTile
        tile={{
          id: `screen-${screenShare.id}`,
          stream: screenShare.stream,
          name: screenShare.userName,
          type: 'screenShare',
          isPinned: pinnedUserId === `screen-${screenShare.id}`,
        }}
        size={size}
        onPin={handlePin}
        canPin={canPin}
      />
    ),
    [handlePin, canPin, pinnedUserId]
  )

  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-4 overflow-hidden"
      >
        {pinnedUserId ? (
          <FocusLayout
            tiles={allTiles}
            focusedTileId={pinnedUserId}
            renderTile={renderTile}
          />
        ) : (
          <GridLayout
            participants={allParticipants}
            screenShares={screenShares}
            renderParticipant={renderParticipant}
            renderScreenShare={renderScreenShare}
          />
        )}
      </div>

      <div className="flex-shrink-0 bg-slate-800 border-t border-slate-700 p-4">
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <div className="flex items-center bg-slate-700 rounded-full">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-12 sm:w-12 rounded-full hover:bg-slate-600"
                  title="Select microphone"
                >
                  <IconChevronUp className="h-4 w-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] bg-slate-800 rounded-lg p-1 shadow-lg border border-slate-600 z-50"
                  sideOffset={8}
                  side="top"
                >
                  {microphones.map((mic) => (
                    <DropdownMenu.Item
                      key={mic.deviceId}
                      className={cn(
                        "px-3 py-2 text-sm text-white rounded cursor-pointer outline-none",
                        "hover:bg-slate-700 focus:bg-slate-700",
                        selectedMicrophone === mic.deviceId && "bg-slate-600"
                      )}
                      onSelect={() => selectMicrophone(mic.deviceId)}
                    >
                      {mic.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Button
              variant={micEnabled ? "secondary" : "destructive"}
              size="icon"
              onClick={toggleMicrophone}
              className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
              title={micEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {micEnabled ? <IconMicrophone className="h-4 w-4 sm:h-5 sm:w-5" /> : <IconMicrophoneOff className="h-4 w-4 sm:h-5 sm:w-5" />}
            </Button>
          </div>

          <div className="flex items-center bg-slate-700 rounded-full">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-12 sm:w-12 rounded-full hover:bg-slate-600"
                  title="Select camera"
                >
                  <IconChevronUp className="h-4 w-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] bg-slate-800 rounded-lg p-1 shadow-lg border border-slate-600 z-50"
                  sideOffset={8}
                  side="top"
                >
                  {cameras.map((cam) => (
                    <DropdownMenu.Item
                      key={cam.deviceId}
                      className={cn(
                        "px-3 py-2 text-sm text-white rounded cursor-pointer outline-none",
                        "hover:bg-slate-700 focus:bg-slate-700",
                        selectedCamera === cam.deviceId && "bg-slate-600"
                      )}
                      onSelect={() => selectCamera(cam.deviceId)}
                    >
                      {cam.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Button
              variant={videoEnabled ? "secondary" : "destructive"}
              size="icon"
              onClick={toggleCamera}
              className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
              title={videoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {videoEnabled ? <IconVideo className="h-4 w-4 sm:h-5 sm:w-5" /> : <IconVideoOff className="h-4 w-4 sm:h-5 sm:w-5" />}
            </Button>
          </div>

          <Button
            variant={handRaised ? "default" : "secondary"}
            size="icon"
            onClick={toggleRaiseHand}
            className={cn("h-10 w-10 sm:h-12 sm:w-12 rounded-full", handRaised && "bg-yellow-500 hover:bg-yellow-600")}
            title={handRaised ? "Lower hand" : "Raise hand"}
          >
            <IconHandStop className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>

          <Button
            variant={isScreenSharing ? "default" : "secondary"}
            size="icon"
            onClick={toggleScreenShare}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
          >
            {isScreenSharing ? <IconScreenShareOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <IconScreenShare className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={handleLeave}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
            title="Leave meeting"
          >
            <IconPhoneOff className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

