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
  IconMicrophone, IconMicrophoneOff, IconVideo, IconVideoOff, IconPhoneOff, IconScreenShare, IconHandStop, IconScreenShareOff, IconPin, IconPinnedOff, IconChevronUp, IconUsers, IconDoorExit, IconPlayerStop, IconUserMinus, IconBan, IconBroadcast, IconBroadcastOff, IconPlayerRecord, IconPlayerRecordFilled
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
  // Host action props
  isHost,
  onMuteParticipant,
  onUnmuteParticipant,
  onDisableCamera,
  onEnableCamera,
  onDisableScreenShare,
  onEnableScreenShare,
  onRemoveParticipant,
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
  // Host action props
  isHost?: boolean
  onMuteParticipant?: (id: string) => void
  onUnmuteParticipant?: (id: string) => void
  onDisableCamera?: (id: string) => void
  onEnableCamera?: (id: string) => void
  onDisableScreenShare?: (id: string) => void
  onEnableScreenShare?: (id: string) => void
  onRemoveParticipant?: (id: string, reason?: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream
    }
  }, [participant.stream])

  const isPinned = isPinnedLocal || isPinnedForEveryone
  const showHostActions = isHost && !participant.isLocal

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
      {(canPin || showHostActions) && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                "absolute top-2 right-2 p-1.5 rounded-full transition-opacity",
                "bg-black/50 hover:bg-black/70",
                isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              title="Options"
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
              {canPin && (
                <>
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
                </>
              )}

              {/* Host Actions */}
              {showHostActions && (
                <>
                  {canPin && <DropdownMenu.Separator className="h-px bg-slate-600 my-1" />}

                  {/* Mute/Unmute - Use isMicBanned to check host ban status */}
                  {participant.isMicBanned ? (
                    <DropdownMenu.Item
                      className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                      onSelect={(e) => {
                        e.preventDefault()
                        onUnmuteParticipant?.(participant.id)
                      }}
                    >
                      <IconMicrophone className="h-4 w-4 text-green-400" />
                      Unmute participant
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item
                      className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                      onSelect={(e) => {
                        e.preventDefault()
                        onMuteParticipant?.(participant.id)
                      }}
                    >
                      <IconMicrophoneOff className="h-4 w-4 text-orange-400" />
                      Mute participant
                    </DropdownMenu.Item>
                  )}

                  {/* Disable/Enable Camera - Use isCameraBanned to check host ban status */}
                  {participant.isCameraBanned ? (
                    <DropdownMenu.Item
                      className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                      onSelect={(e) => {
                        e.preventDefault()
                        onEnableCamera?.(participant.id)
                      }}
                    >
                      <IconVideo className="h-4 w-4 text-green-400" />
                      Enable camera
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item
                      className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                      onSelect={(e) => {
                        e.preventDefault()
                        onDisableCamera?.(participant.id)
                      }}
                    >
                      <IconVideoOff className="h-4 w-4 text-orange-400" />
                      Disable camera
                    </DropdownMenu.Item>
                  )}

                  {/* Disable/Enable Screen Share - Use isScreenShareBanned to check host ban status */}
                  {participant.isScreenShareBanned ? (
                    <DropdownMenu.Item
                      className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                      onSelect={(e) => {
                        e.preventDefault()
                        onEnableScreenShare?.(participant.id)
                      }}
                    >
                      <IconScreenShare className="h-4 w-4 text-green-400" />
                      Enable screen share
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item
                      className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                      onSelect={(e) => {
                        e.preventDefault()
                        onDisableScreenShare?.(participant.id)
                      }}
                    >
                      <IconScreenShareOff className="h-4 w-4 text-orange-400" />
                      Disable screen share
                    </DropdownMenu.Item>
                  )}

                  <DropdownMenu.Separator className="h-px bg-slate-600 my-1" />

                  {/* Kick */}
                  <DropdownMenu.Item
                    className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-red-600 focus:bg-red-600 flex items-center gap-2"
                    onSelect={(e) => {
                      e.preventDefault()
                      const reason = prompt(`Enter reason to remove ${participant.name} (optional):`)
                      if (reason !== null) {
                        onRemoveParticipant?.(participant.id, reason)
                      }
                    }}
                  >
                    <IconUserMinus className="h-4 w-4 text-red-400" />
                    Remove from meeting
                  </DropdownMenu.Item>
                </>
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
            {/* Show ban indicator or mute indicator */}
            {participant.isMicBanned ? (
              <div className="p-1 rounded bg-red-700 ring-1 ring-red-400" title="Mic banned by host">
                <IconBan className="h-3 w-3 text-white" />
              </div>
            ) : participant.isMuted && (
              <div className="p-1 rounded bg-red-500" title="Muted">
                <IconMicrophoneOff className="h-3 w-3 text-white" />
              </div>
            )}
            {participant.isCameraBanned && (
              <div className="p-1 rounded bg-red-700 ring-1 ring-red-400" title="Camera banned by host">
                <IconVideoOff className="h-3 w-3 text-white" />
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
    endRoom,
    isRoomOwner,
    userId,
    currentRoom,
    togglePin,
    onRoomEnded,
    // Host actions
    muteParticipant,
    unmuteParticipant,
    disableParticipantCamera,
    enableParticipantCamera,
    disableParticipantScreenShare,
    enableParticipantScreenShare,
    removeParticipant,
    // Livestream
    startLivestream,
    stopLivestream,
    isLivestreamActive,
    // Recording
    startRecording,
    stopRecording,
    isRecordingActive,
  } = useErmisClassroom()

  const {
    microphones,
    cameras,
    selectedMicrophone,
    selectedCamera,
    selectMicrophone,
    selectCamera,
  } = useMediaDevices()

  // Listen for room ended event to navigate back
  useEffect(() => {
    const unsubscribe = onRoomEnded(() => {
      onLeft()
    })
    return unsubscribe
  }, [onRoomEnded, onLeft])

  // Get local participant ban status
  const localParticipant = useMemo(() => {
    if (!userId) return null
    return participants.get(userId) || null
  }, [participants, userId])

  const isMicBanned = localParticipant?.isMicBanned ?? false
  const isCameraBanned = localParticipant?.isCameraBanned ?? false

  // Screen share permission states
  const [screenShareApproved, setScreenShareApproved] = useState(false)
  const [pendingScreenShareRequest, setPendingScreenShareRequest] = useState(false)
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
  const [incomingPermissionRequest, setIncomingPermissionRequest] = useState<{
    requestId: string
    participantAuthId: string
    permissionType: string
    reason: string
  } | null>(null)

  // Kick notification state
  const [kickedState, setKickedState] = useState<{
    reason: string
  } | null>(null)

  // Helper function to generate request ID
  const generateRequestId = () => `req_${Math.random().toString(36).substring(2, 12)}`

  // Listen for custom events (permission requests/approvals)
  useEffect(() => {
    if (!currentRoom) return

    const unsubscribe = currentRoom.onCustomEvent((event: any) => {
      const eventData = event?.value || event

      log('[MeetingRoom] Received custom event:', eventData)

      // Host receives permission request
      if (eventData?.type === 'permission_request' && isRoomOwner) {
        if (eventData.permissionType === 'screenShare') {
          setIncomingPermissionRequest({
            requestId: eventData.requestId,
            participantAuthId: eventData.participantAuthId,
            permissionType: eventData.permissionType,
            reason: eventData.reason,
          })
        }
      }

      // Member receives approval
      if (eventData?.type === 'permission_approved' && !isRoomOwner) {
        if (eventData.permissionType === 'screenShare' && eventData.requestId === pendingRequestId) {
          setScreenShareApproved(true)
          setPendingScreenShareRequest(false)
          setPendingRequestId(null)
          log('[MeetingRoom] Screen share permission approved!')
        }
      }
    })

    return () => { unsubscribe() }
  }, [currentRoom, isRoomOwner, pendingRequestId])

  // Handle screen share button click
  const handleScreenShareClick = useCallback(async () => {
    // If currently sharing, just toggle off
    if (isScreenSharing) {
      toggleScreenShare()
      setScreenShareApproved(false)
      return
    }

    // Host can share directly
    if (isRoomOwner) {
      toggleScreenShare()
      return
    }

    // Member: if already approved, share screen and reset
    if (screenShareApproved) {
      toggleScreenShare()
      setScreenShareApproved(false)
      return
    }

    // Member: request permission
    if (!pendingScreenShareRequest && currentRoom) {
      const requestId = generateRequestId()
      setPendingRequestId(requestId)
      setPendingScreenShareRequest(true)

      try {
        await currentRoom.sendCustomEvent([], {
          type: 'permission_request',
          requestId,
          participantAuthId: userId,
          permissionType: 'screenShare',
          reason: 'Requesting screen share permission',
          timestamp: new Date().toISOString(),
        })
        log('[MeetingRoom] Sent screen share permission request:', requestId)
      } catch (error) {
        console.error('Failed to send permission request:', error)
        setPendingScreenShareRequest(false)
        setPendingRequestId(null)
      }
    }
  }, [isScreenSharing, isRoomOwner, screenShareApproved, pendingScreenShareRequest, currentRoom, userId, toggleScreenShare])

  // Host approves permission request
  const handleApprovePermission = useCallback(async () => {
    if (!incomingPermissionRequest || !currentRoom) return

    try {
      await currentRoom.sendCustomEvent([], {
        type: 'permission_approved',
        requestId: incomingPermissionRequest.requestId,
        permissionType: incomingPermissionRequest.permissionType,
        approvedBy: userId,
        timestamp: new Date().toISOString(),
      })
      log('[MeetingRoom] Approved permission request:', incomingPermissionRequest.requestId)
    } catch (error) {
      console.error('Failed to send permission approval:', error)
    }

    setIncomingPermissionRequest(null)
  }, [incomingPermissionRequest, currentRoom, userId])

  // Host rejects permission request
  const handleRejectPermission = useCallback(() => {
    setIncomingPermissionRequest(null)
  }, [])

  // Listen for participant removed (kick) event
  useEffect(() => {
    if (!currentRoom) return

    const handleParticipantRemoved = (event: any) => {
      log('[MeetingRoom] Participant removed:', event)
      // Check if we are the one being removed
      if (event.isLocal) {
        setKickedState({
          reason: event.reason || 'Host removed you from the meeting'
        })

        // Auto leave after 3s
        setTimeout(async () => {
          try {
            await leaveRoom()
          } catch (e) {
            console.error('[MeetingRoom] Error leaving after kick:', e)
          } finally {
            onLeft()
          }
        }, 3000)
      }
    }

    currentRoom.on('participantRemovedByHost', handleParticipantRemoved)
    return () => {
      currentRoom.off('participantRemovedByHost', handleParticipantRemoved)
    }
  }, [currentRoom, leaveRoom, onLeft])

  // Livestream toggle handler
  const handleLivestreamToggle = useCallback(async () => {
    if (isLivestreamActive) {
      try {
        await stopLivestream()
        log("[MeetingRoom] Livestream stopped")
      } catch (error) {
        console.error("[MeetingRoom] Failed to stop livestream:", error)
      }
    } else {
      try {
        await startLivestream()
        log("[MeetingRoom] Livestream started successfully")
      } catch (error) {
        console.error("[MeetingRoom] Failed to start livestream:", error)
      }
    }
  }, [isLivestreamActive, startLivestream, stopLivestream])

  // Recording toggle handler
  const handleRecordToggle = useCallback(async () => {
    if (isRecordingActive) {
      try {
        await stopRecording()
        log("[MeetingRoom] Recording stopped")
      } catch (error) {
        console.error("[MeetingRoom] Failed to stop recording:", error)
      }
    } else {
      try {
        await startRecording()
        log("[MeetingRoom] Recording started successfully")
      } catch (error) {
        console.error("[MeetingRoom] Failed to start recording:", error)
      }
    }
  }, [isRecordingActive, startRecording, stopRecording])



  // Independent pin states
  const [localPinnedUserId, setLocalPinnedUserId] = useState<string | null>(null)
  const [everyonePinnedUserId, setEveryonePinnedUserId] = useState<string | null>(null)
  const localPinChangeTimeRef = useRef<number>(0)
  const prevRemotePinnedUserId = useRef<string | null>(null)

  // Get remote pin info - include pinType to determine if it's a screen share
  const remotePinnedParticipant = currentRoom?.pinnedParticipant || null
  const remotePinnedPinType = currentRoom?.pinnedPinType || null

  // Generate the correct tile ID based on pinType
  // pinType 2 = ScreenShare, so tile ID should be "screen-{userId}"
  const remotePinnedTileId = remotePinnedParticipant
    ? (remotePinnedPinType === 2 ? `screen-${remotePinnedParticipant.userId}` : remotePinnedParticipant.userId)
    : null

  // Sync "everyone" pin state from server
  useEffect(() => {
    // Only act when remote actually changes
    if (remotePinnedTileId === prevRemotePinnedUserId.current) {
      return
    }

    log('[MeetingRoom] Remote pin changed:', {
      prev: prevRemotePinnedUserId.current,
      current: remotePinnedTileId,
      pinType: remotePinnedPinType
    })

    const timeSinceLocalChange = Date.now() - localPinChangeTimeRef.current
    const isRecentLocalChange = timeSinceLocalChange < 1000

    if (!isRecentLocalChange) {
      // We're a receiver, sync from remote
      setEveryonePinnedUserId(remotePinnedTileId)
    }

    // Always update previous value
    prevRemotePinnedUserId.current = remotePinnedTileId
  }, [remotePinnedTileId, remotePinnedPinType])

  // Determine which user should be focused (everyone pin takes priority)
  const focusedUserId = everyonePinnedUserId || localPinnedUserId

  const handleLeave = async () => {
    try {
      await leaveRoom()
    } catch (err) {
      console.error("Failed to leave room:", err)
    } finally {
      onLeft()
    }
  }

  const handleEndMeeting = async () => {
    try {
      await endRoom()
    } catch (err) {
      console.error("Failed to end meeting:", err)
    } finally {
      onLeft()
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
          isMicBanned: participant.isMicBanned,
          isCameraBanned: participant.isCameraBanned,
          isScreenShareBanned: participant.isScreenShareBanned,
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
        // Host actions
        isHost={isRoomOwner}
        onMuteParticipant={muteParticipant}
        onUnmuteParticipant={unmuteParticipant}
        onDisableCamera={disableParticipantCamera}
        onEnableCamera={enableParticipantCamera}
        onDisableScreenShare={disableParticipantScreenShare}
        onEnableScreenShare={enableParticipantScreenShare}
        onRemoveParticipant={removeParticipant}
      />
    ),
    [handlePinLocal, handleUnpinLocal, handlePinForEveryone, handleUnpinForEveryone, canPin, localPinnedUserId, everyonePinnedUserId, isRoomOwner, muteParticipant, unmuteParticipant, disableParticipantCamera, enableParticipantCamera, disableParticipantScreenShare, enableParticipantScreenShare, removeParticipant]
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
              variant={isMicBanned ? "destructive" : micEnabled ? "secondary" : "destructive"}
              size="icon"
              onClick={isMicBanned ? undefined : toggleMicrophone}
              disabled={isMicBanned}
              className={cn(
                "h-10 w-10 sm:h-12 sm:w-12 rounded-full",
                isMicBanned && "opacity-70 cursor-not-allowed ring-2 ring-red-400"
              )}
              title={isMicBanned ? "Mic banned by host" : micEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {isMicBanned ? (
                <IconBan className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : micEnabled ? (
                <IconMicrophone className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : (
                <IconMicrophoneOff className="h-4 w-4 sm:h-5 sm:w-5" />
              )}
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
              variant={isCameraBanned ? "destructive" : videoEnabled ? "secondary" : "destructive"}
              size="icon"
              onClick={isCameraBanned ? undefined : toggleCamera}
              disabled={isCameraBanned}
              className={cn(
                "h-10 w-10 sm:h-12 sm:w-12 rounded-full",
                isCameraBanned && "opacity-70 cursor-not-allowed ring-2 ring-red-400"
              )}
              title={isCameraBanned ? "Camera banned by host" : videoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {isCameraBanned ? (
                <IconBan className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : videoEnabled ? (
                <IconVideo className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : (
                <IconVideoOff className="h-4 w-4 sm:h-5 sm:w-5" />
              )}
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
            variant={isScreenSharing ? "default" : screenShareApproved ? "default" : pendingScreenShareRequest ? "outline" : "secondary"}
            size="icon"
            onClick={handleScreenShareClick}
            disabled={pendingScreenShareRequest}
            className={cn(
              "h-10 w-10 sm:h-12 sm:w-12 rounded-full",
              screenShareApproved && !isScreenSharing && "bg-green-500 hover:bg-green-600",
              pendingScreenShareRequest && "opacity-70 animate-pulse"
            )}
            title={
              isScreenSharing
                ? "Stop sharing"
                : screenShareApproved
                  ? "Click to share screen (approved)"
                  : pendingScreenShareRequest
                    ? "Waiting for host approval..."
                    : isRoomOwner
                      ? "Share screen"
                      : "Request to share screen"
            }
          >
            {isScreenSharing ? <IconScreenShareOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <IconScreenShare className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          {/* Livestream Button */}
          <Button
            variant={isLivestreamActive ? "default" : "secondary"}
            size="icon"
            onClick={handleLivestreamToggle}
            className={cn(
              "h-10 w-10 sm:h-12 sm:w-12 rounded-full",
              isLivestreamActive && "bg-red-500 hover:bg-red-600 animate-pulse"
            )}
            title={isLivestreamActive ? "Stop Livestream" : "Start Livestream"}
          >
            {isLivestreamActive ? <IconBroadcastOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <IconBroadcast className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          {/* Record Button */}
          <Button
            variant={isRecordingActive ? "default" : "secondary"}
            size="icon"
            onClick={handleRecordToggle}
            className={cn(
              "h-10 w-10 sm:h-12 sm:w-12 rounded-full",
              isRecordingActive && "bg-red-500 hover:bg-red-600 animate-pulse"
            )}
            title={isRecordingActive ? "Stop Recording" : "Start Recording"}
          >
            {isRecordingActive ? <IconPlayerRecordFilled className="h-4 w-4 sm:h-5 sm:w-5" /> : <IconPlayerRecord className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="destructive"
                size="icon"
                className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
                title="Leave or End meeting"
              >
                <IconPhoneOff className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[180px] bg-slate-800 rounded-lg p-1 shadow-lg border border-slate-600 z-50"
                sideOffset={8}
                side="top"
              >
                <DropdownMenu.Item
                  className="px-3 py-2 text-sm text-white rounded cursor-pointer outline-none hover:bg-slate-700 focus:bg-slate-700 flex items-center gap-2"
                  onSelect={handleLeave}
                >
                  <IconDoorExit className="h-4 w-4 text-yellow-400" />
                  Leave Meeting
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="h-px bg-slate-600 my-1" />

                <DropdownMenu.Item
                  className={cn(
                    "px-3 py-2 text-sm rounded flex items-center gap-2",
                    isRoomOwner
                      ? "text-white cursor-pointer outline-none hover:bg-red-600 focus:bg-red-600"
                      : "text-slate-500 cursor-not-allowed"
                  )}
                  disabled={!isRoomOwner}
                  onSelect={(e) => {
                    if (!isRoomOwner) {
                      e.preventDefault()
                      return
                    }
                    handleEndMeeting()
                  }}
                >
                  <IconPlayerStop className={cn("h-4 w-4", isRoomOwner ? "text-red-400" : "text-slate-500")} />
                  End Meeting {!isRoomOwner && "(Host only)"}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Permission Request Modal for Host */}
      {incomingPermissionRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl border border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">
              📢 Screen Share Permission Request
            </h3>
            <div className="space-y-3 mb-6">
              <p className="text-slate-300">
                <span className="font-medium text-white">{incomingPermissionRequest.participantAuthId}</span> is requesting screen share permission.
              </p>
              <p className="text-sm text-slate-400">
                {incomingPermissionRequest.reason}
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleApprovePermission}
              >
                ✓ Approve
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleRejectPermission}
              >
                ✗ Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Kick Notification Modal */}
      {kickedState && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl border border-red-500/50">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-full bg-red-900/50 flex items-center justify-center mb-4">
                <IconUserMinus className="h-6 w-6 text-red-500" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                You have been removed from the meeting
              </h3>
              <p className="text-slate-300 mb-6">
                {kickedState.reason}
              </p>
              <p className="text-sm text-slate-500 mb-6">
                Leaving automatically in a few seconds...
              </p>
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleLeave}
              >
                Leave Now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

