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
  IconMicrophone, IconMicrophoneOff, IconVideo, IconVideoOff, IconPhoneOff, IconScreenShare, IconHandStop, IconScreenShareOff, IconPin, IconPinnedOff, IconChevronUp, IconUsers
} from "@tabler/icons-react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { cn } from "@/lib/utils"
import { log } from "@ermisnetwork/ermis-classroom-sdk"

interface MeetingRoomProps {
  onLeft: () => void
}

function CustomParticipantTile({
  participant,
  size,
  isPinnedLocal,
  isPinnedForEveryone,
  onPinLocal,
  onUnpinLocal,
  onPinForEveryone,
  onUnpinForEveryone,
  canPin,
}: {
  participant: ParticipantData
  size: { width: number; height: number }
  isPinnedLocal?: boolean
  isPinnedForEveryone?: boolean
  onPinLocal?: (id: string) => void
  onUnpinLocal?: (id: string) => void
  onPinForEveryone?: (id: string) => void
  onUnpinForEveryone?: (id: string) => void
  canPin: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream
    }
  }, [participant.stream])

  const isPinned = isPinnedLocal || isPinnedForEveryone

  return (
    <div
      className={cn(
        "relative bg-slate-800 rounded-lg overflow-hidden group",
        isPinnedForEveryone && "ring-2 ring-blue-500",
        isPinnedLocal && !isPinnedForEveryone && "ring-2 ring-green-500"
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
      {canPin && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                "absolute top-2 right-2 p-1.5 rounded-full transition-opacity",
                "bg-black/50 hover:bg-black/70",
                isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              title="Pin options"
              onClick={(e) => e.stopPropagation()}
            >
              {isPinned ? (
                <IconPinnedOff className="h-4 w-4 text-white" />
              ) : (
                <IconPin className="h-4 w-4 text-white" />
              )}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[180px] bg-slate-800 rounded-lg p-1 shadow-lg border border-slate-600 z-50"
              sideOffset={5}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Local Pin */}
              {isPinnedLocal ? (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onUnpinLocal?.(participant.id)
                  }}
                >
                  <IconPinnedOff className="h-4 w-4 text-green-400" />
                  Unpin for me
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onPinLocal?.(participant.id)
                  }}
                >
                  <IconPin className="h-4 w-4 text-green-400" />
                  Pin for me
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Separator className="h-px bg-slate-600 my-1" />

              {/* Everyone Pin */}
              {isPinnedForEveryone ? (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onUnpinForEveryone?.(participant.id)
                  }}
                >
                  <IconPinnedOff className="h-4 w-4 text-blue-400" />
                  Unpin for everyone
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onPinForEveryone?.(participant.id)
                  }}
                >
                  <IconUsers className="h-4 w-4 text-blue-400" />
                  Pin for everyone
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium truncate">
            {participant.name} {participant.isLocal && "(You)"}
          </span>
          <div className="flex items-center gap-1">
            {isPinnedForEveryone && (
              <div className="p-1 rounded bg-blue-500" title="Pinned for everyone">
                <IconUsers className="h-3 w-3 text-white" />
              </div>
            )}
            {isPinnedLocal && (
              <div className="p-1 rounded bg-green-500" title="Pinned for me">
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
  isPinnedLocal,
  isPinnedForEveryone,
  onPinLocal,
  onUnpinLocal,
  onPinForEveryone,
  onUnpinForEveryone,
  canPin,
}: {
  tile: TileData
  size: { width: number; height: number }
  isPinnedLocal?: boolean
  isPinnedForEveryone?: boolean
  onPinLocal?: (id: string) => void
  onUnpinLocal?: (id: string) => void
  onPinForEveryone?: (id: string) => void
  onUnpinForEveryone?: (id: string) => void
  canPin: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && tile.stream) {
      videoRef.current.srcObject = tile.stream
    }
  }, [tile.stream])

  const isScreenShare = tile.type === 'screenShare'
  const isPinned = isPinnedLocal || isPinnedForEveryone

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden group",
        isScreenShare ? "bg-slate-900" : "bg-slate-800",
        isPinnedForEveryone && "ring-2 ring-blue-500",
        isPinnedLocal && !isPinnedForEveryone && "ring-2 ring-green-500"
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
      {canPin && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                "absolute top-2 right-2 p-1.5 rounded-full transition-opacity",
                "bg-black/50 hover:bg-black/70",
                isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              title="Pin options"
              onClick={(e) => e.stopPropagation()}
            >
              {isPinned ? (
                <IconPinnedOff className="h-4 w-4 text-white" />
              ) : (
                <IconPin className="h-4 w-4 text-white" />
              )}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[180px] bg-slate-800 rounded-lg p-1 shadow-lg border border-slate-600 z-50"
              sideOffset={5}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Local Pin */}
              {isPinnedLocal ? (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onUnpinLocal?.(tile.id)
                  }}
                >
                  <IconPinnedOff className="h-4 w-4 text-green-400" />
                  Unpin for me
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onPinLocal?.(tile.id)
                  }}
                >
                  <IconPin className="h-4 w-4 text-green-400" />
                  Pin for me
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Separator className="h-px bg-slate-600 my-1" />

              {/* Everyone Pin */}
              {isPinnedForEveryone ? (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onUnpinForEveryone?.(tile.id)
                  }}
                >
                  <IconPinnedOff className="h-4 w-4 text-blue-400" />
                  Unpin for everyone
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onPinForEveryone?.(tile.id)
                  }}
                >
                  <IconUsers className="h-4 w-4 text-blue-400" />
                  Pin for everyone
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium truncate flex items-center gap-1">
            {isScreenShare && <IconScreenShare className="h-4 w-4" />}
            {tile.name} {tile.isLocal && "(You)"}
            {isScreenShare && "'s screen"}
          </span>
          <div className="flex items-center gap-1">
            {isPinnedForEveryone && (
              <div className="p-1 rounded bg-blue-500" title="Pinned for everyone">
                <IconUsers className="h-3 w-3 text-white" />
              </div>
            )}
            {isPinnedLocal && (
              <div className="p-1 rounded bg-green-500" title="Pinned for me">
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

  // Independent pin states
  const [localPinnedUserId, setLocalPinnedUserId] = useState<string | null>(null)
  const [everyonePinnedUserId, setEveryonePinnedUserId] = useState<string | null>(null)
  const localPinChangeTimeRef = useRef<number>(0)
  const prevRemotePinnedUserId = useRef<string | null>(null)

  const remotePinnedUserId = currentRoom?.pinnedParticipant?.userId || null

  // Sync "everyone" pin state from server
  useEffect(() => {
    // Only act when remote actually changes
    if (remotePinnedUserId === prevRemotePinnedUserId.current) {
      return
    }

    log('[MeetingRoom] Remote pin changed:', {
      prev: prevRemotePinnedUserId.current,
      current: remotePinnedUserId
    })

    const timeSinceLocalChange = Date.now() - localPinChangeTimeRef.current
    const isRecentLocalChange = timeSinceLocalChange < 1000

    if (!isRecentLocalChange) {
      // We're a receiver, sync from remote
      setEveryonePinnedUserId(remotePinnedUserId)
    }

    // Always update previous value
    prevRemotePinnedUserId.current = remotePinnedUserId
  }, [remotePinnedUserId])

  // Determine which user should be focused (everyone pin takes priority)
  const focusedUserId = everyonePinnedUserId || localPinnedUserId

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

  // Local pin handlers
  const handlePinLocal = useCallback((participantId: string) => {
    log('[MeetingRoom] handlePinLocal:', { participantId })
    setLocalPinnedUserId(participantId)
  }, [])

  const handleUnpinLocal = useCallback((participantId: string) => {
    log('[MeetingRoom] handleUnpinLocal:', { participantId })
    if (localPinnedUserId === participantId) {
      setLocalPinnedUserId(null)
    }
  }, [localPinnedUserId])

  // Everyone pin handlers
  const handlePinForEveryone = useCallback((participantId: string) => {
    if (!canPin) return
    log('[MeetingRoom] handlePinForEveryone:', { participantId })

    // Mark this as a local change to prevent sync from overwriting
    localPinChangeTimeRef.current = Date.now()

    // Update local state immediately
    setEveryonePinnedUserId(participantId)

    // Send event to server
    togglePin(participantId, 'everyone', 'pin')
  }, [togglePin, canPin])

  const handleUnpinForEveryone = useCallback((participantId: string) => {
    if (!canPin) return
    log('[MeetingRoom] handleUnpinForEveryone:', { participantId })

    // Mark this as a local change to prevent sync from overwriting
    localPinChangeTimeRef.current = Date.now()

    // Update local state immediately
    setEveryonePinnedUserId(null)

    // Send event to server
    togglePin(participantId, 'everyone', 'unpin')
  }, [togglePin, canPin])


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
          isPinned: false, // Will be calculated in render
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
      isPinned: false, // Will be calculated in render
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
          isPinned: false, // Will be calculated in render
        })
      })

    return tiles
  }, [userId, localStream, micEnabled, videoEnabled, participantList, remoteStreams, screenShareStreams])

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
        isPinnedLocal={localPinnedUserId === tile.id}
        isPinnedForEveryone={everyonePinnedUserId === tile.id}
        onPinLocal={handlePinLocal}
        onUnpinLocal={handleUnpinLocal}
        onPinForEveryone={handlePinForEveryone}
        onUnpinForEveryone={handleUnpinForEveryone}
        canPin={canPin}
      />
    ),
    [handlePinLocal, handleUnpinLocal, handlePinForEveryone, handleUnpinForEveryone, canPin, localPinnedUserId, everyonePinnedUserId]
  )

  const renderParticipant = useCallback(
    (participant: ParticipantData, size: { width: number; height: number }) => (
      <CustomParticipantTile
        participant={participant}
        size={size}
        isPinnedLocal={localPinnedUserId === participant.id}
        isPinnedForEveryone={everyonePinnedUserId === participant.id}
        onPinLocal={handlePinLocal}
        onUnpinLocal={handleUnpinLocal}
        onPinForEveryone={handlePinForEveryone}
        onUnpinForEveryone={handleUnpinForEveryone}
        canPin={canPin}
      />
    ),
    [handlePinLocal, handleUnpinLocal, handlePinForEveryone, handleUnpinForEveryone, canPin, localPinnedUserId, everyonePinnedUserId]
  )

  const renderScreenShare = useCallback(
    (screenShare: LayoutScreenShareData, size: { width: number; height: number }) => {
      const screenId = `screen-${screenShare.id}`
      return (
        <CustomTile
          tile={{
            id: screenId,
            stream: screenShare.stream,
            name: screenShare.userName,
            type: 'screenShare',
            isPinned: false,
          }}
          size={size}
          isPinnedLocal={localPinnedUserId === screenId}
          isPinnedForEveryone={everyonePinnedUserId === screenId}
          onPinLocal={handlePinLocal}
          onUnpinLocal={handleUnpinLocal}
          onPinForEveryone={handlePinForEveryone}
          onUnpinForEveryone={handleUnpinForEveryone}
          canPin={canPin}
        />
      )
    },
    [handlePinLocal, handleUnpinLocal, handlePinForEveryone, handleUnpinForEveryone, canPin, localPinnedUserId, everyonePinnedUserId]
  )

  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-4 overflow-hidden"
      >
        {focusedUserId ? (
          <FocusLayout
            tiles={allTiles}
            focusedTileId={focusedUserId}
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

