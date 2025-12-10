import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import { useErmisClassroom } from "@ermisnetwork/ermis-classroom-react"
import { Button } from "@/components/ui/button"
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Monitor, Hand, MonitorOff
} from "lucide-react"
import { cn } from "@/lib/utils"

interface MeetingRoomProps {
  onLeft: () => void
}

interface ParticipantTileProps {
  stream: MediaStream | null
  name: string
  isLocal?: boolean
  isMuted?: boolean
  isVideoOff?: boolean
  isHandRaised?: boolean
  width: number
  height: number
}

function ParticipantTile({ stream, name, isLocal, isMuted, isVideoOff, isHandRaised, width, height }: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div
      className="relative bg-slate-800 rounded-lg overflow-hidden"
      style={{ width, height }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn("w-full h-full object-cover", isVideoOff && "hidden")}
      />
      {isVideoOff && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-700">
          <div className="h-16 w-16 rounded-full bg-slate-600 flex items-center justify-center">
            <span className="text-2xl font-semibold text-white">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}
      {/* Participant info overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium truncate">
            {name} {isLocal && "(You)"}
          </span>
          <div className="flex items-center gap-1">
            {isHandRaised && (
              <div className="p-1 rounded bg-yellow-500">
                <Hand className="h-3 w-3 text-white" />
              </div>
            )}
            {isMuted && (
              <div className="p-1 rounded bg-red-500">
                <MicOff className="h-3 w-3 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScreenShareTile({ stream, name, width, height }: { stream: MediaStream; name: string; width: number; height: number }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div
      className="relative bg-slate-900 rounded-lg overflow-hidden"
      style={{ width, height }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain"
      />
      <div className="absolute top-2 left-2 px-2 py-1 bg-blue-600 rounded text-white text-sm flex items-center gap-1">
        <Monitor className="h-4 w-4" />
        {name}'s screen
      </div>
    </div>
  )
}

// Calculate optimal grid layout based on container size and tile count
function useGridLayout(containerRef: React.RefObject<HTMLDivElement | null>, tileCount: number) {
  const [layout, setLayout] = useState({ cols: 1, rows: 1, tileWidth: 0, tileHeight: 0 })

  const calculateLayout = useCallback(() => {
    if (!containerRef.current || tileCount === 0) {
      setLayout({ cols: 1, rows: 1, tileWidth: 0, tileHeight: 0 })
      return
    }

    const container = containerRef.current
    const style = getComputedStyle(container)
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)

    // Available space after padding
    const containerWidth = container.clientWidth - paddingX
    const containerHeight = container.clientHeight - paddingY

    if (containerWidth <= 0 || containerHeight <= 0) {
      setLayout({ cols: 1, rows: 1, tileWidth: 0, tileHeight: 0 })
      return
    }

    const gap = 8 // 8px gap between tiles
    const aspectRatio = 16 / 9

    let bestLayout = { cols: 1, rows: 1, tileWidth: 0, tileHeight: 0, area: 0 }

    // Try different column counts and find the one that maximizes tile area
    for (let cols = 1; cols <= tileCount; cols++) {
      const rows = Math.ceil(tileCount / cols)

      // Available space for tiles (minus gaps)
      const availableWidth = containerWidth - (cols - 1) * gap
      const availableHeight = containerHeight - (rows - 1) * gap

      // Calculate tile size maintaining aspect ratio
      let tileWidth = availableWidth / cols
      let tileHeight = tileWidth / aspectRatio

      // If tiles are too tall, constrain by height
      if (tileHeight * rows + (rows - 1) * gap > containerHeight) {
        tileHeight = availableHeight / rows
        tileWidth = tileHeight * aspectRatio
      }

      // Make sure tiles fit within available width too
      if (tileWidth * cols + (cols - 1) * gap > containerWidth) {
        tileWidth = availableWidth / cols
        tileHeight = tileWidth / aspectRatio
      }

      // Skip invalid layouts
      if (tileWidth <= 0 || tileHeight <= 0) continue

      const area = tileWidth * tileHeight

      if (area > bestLayout.area) {
        bestLayout = { cols, rows, tileWidth: Math.floor(tileWidth), tileHeight: Math.floor(tileHeight), area }
      }
    }

    setLayout(bestLayout)
  }, [containerRef, tileCount])

  useEffect(() => {
    calculateLayout()

    const resizeObserver = new ResizeObserver(() => {
      calculateLayout()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [calculateLayout, containerRef])

  return layout
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
  } = useErmisClassroom()

  const handleLeave = async () => {
    try {
      await leaveRoom()
      onLeft()
    } catch (err) {
      console.error("Failed to leave room:", err)
    }
  }

  // Convert participants map to array
  const participantList = useMemo(() => {
    return Array.from(participants.values())
  }, [participants])

  // Get screen share streams as array
  const screenShares = useMemo(() => {
    return Array.from(screenShareStreams.entries()).filter(([, data]) => data.stream)
  }, [screenShareStreams])

  // Total tile count (local + remote participants + screen shares)
  const tileCount = useMemo(() => {
    const remoteCount = participantList.filter(p => p.userId !== userId).length
    return 1 + remoteCount + screenShares.length // 1 for local
  }, [participantList, userId, screenShares.length])

  // Calculate optimal layout
  const layout = useGridLayout(containerRef, tileCount)

  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
      {/* Main content area - takes remaining space, never overflows */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-4 overflow-hidden"
      >
        <div
          className="w-full h-full flex flex-wrap justify-center items-center content-center gap-2"
        >
          {/* Screen shares */}
          {screenShares.map(([odUserId, data]) => (
            <ScreenShareTile
              key={`screen-${odUserId}`}
              stream={data.stream!}
              name={data.userName}
              width={layout.tileWidth}
              height={layout.tileHeight}
            />
          ))}

          {/* Local participant */}
          <ParticipantTile
            stream={localStream}
            name={userId || "You"}
            isLocal
            isMuted={!micEnabled}
            isVideoOff={!videoEnabled}
            width={layout.tileWidth}
            height={layout.tileHeight}
          />

          {/* Remote participants */}
          {participantList
            .filter((p) => p.userId !== userId)
            .map((participant) => {
              const stream = remoteStreams.get(participant.userId)
              return (
                <ParticipantTile
                  key={participant.userId}
                  stream={stream || null}
                  name={participant.userId}
                  isMuted={!participant.isAudioEnabled}
                  isVideoOff={!participant.isVideoEnabled}
                  isHandRaised={participant.isHandRaised}
                  width={layout.tileWidth}
                  height={layout.tileHeight}
                />
              )
            })}
        </div>
      </div>

      {/* Controls bar - fixed at bottom */}
      <div className="flex-shrink-0 bg-slate-800 border-t border-slate-700 p-4">
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <Button
            variant={micEnabled ? "secondary" : "destructive"}
            size="icon"
            onClick={toggleMicrophone}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
            title={micEnabled ? "Mute microphone" : "Unmute microphone"}
          >
            {micEnabled ? <Mic className="h-4 w-4 sm:h-5 sm:w-5" /> : <MicOff className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          <Button
            variant={videoEnabled ? "secondary" : "destructive"}
            size="icon"
            onClick={toggleCamera}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
            title={videoEnabled ? "Turn off camera" : "Turn on camera"}
          >
            {videoEnabled ? <Video className="h-4 w-4 sm:h-5 sm:w-5" /> : <VideoOff className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          <Button
            variant={isScreenSharing ? "default" : "secondary"}
            size="icon"
            onClick={toggleScreenShare}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
          >
            {isScreenSharing ? <MonitorOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <Monitor className="h-4 w-4 sm:h-5 sm:w-5" />}
          </Button>

          <Button
            variant={handRaised ? "default" : "secondary"}
            size="icon"
            onClick={toggleRaiseHand}
            className={cn("h-10 w-10 sm:h-12 sm:w-12 rounded-full", handRaised && "bg-yellow-500 hover:bg-yellow-600")}
            title={handRaised ? "Lower hand" : "Raise hand"}
          >
            <Hand className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={handleLeave}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
            title="Leave meeting"
          >
            <PhoneOff className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

