import { useState, useEffect, useRef, useCallback } from "react"
import { useErmisClassroom } from "@ermisnetwork/ermis-classroom-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IconLoader2, IconMicrophone, IconMicrophoneOff, IconVideo, IconVideoOff, IconSettings, IconCopy, IconCheck, IconRefresh, IconPlus, IconDoor } from "@tabler/icons-react"
import type { RoomData } from "@ermisnetwork/ermis-classroom-sdk"

interface PreJoinScreenProps {
  onJoined: () => void
}

export function PreJoinScreen({ onJoined }: PreJoinScreenProps) {
  const [roomCode, setRoomCode] = useState("5g33-wdpe-dwhs")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Rooms list state
  const [rooms, setRooms] = useState<RoomData[]>([])
  const [isLoadingRooms, setIsLoadingRooms] = useState(false)
  const [roomsError, setRoomsError] = useState<string | null>(null)

  // Create room state
  const [newRoomName, setNewRoomName] = useState("")
  const [isCreatingRoom, setIsCreatingRoom] = useState(false)
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null)
  const [createRoomError, setCreateRoomError] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  const {
    client,
    isAuthenticated,
    devices,
    selectedDevices,
    switchCamera,
    switchMicrophone,
    getPreviewStream,
    stopPreviewStream,
    previewStream,
    joinRoom,
    // Recording permission methods
    requestRecordingPermissions,
    isRecordingPermissionGranted,
    releaseRecordingPermissions,
    connectRoom,
  } = useErmisClassroom()

  // Start preview stream on mount
  useEffect(() => {
    let mounted = true
    const startPreview = async () => {
      try {
        if (mounted) {
          await getPreviewStream()
        }
      } catch (err) {
        console.error("Failed to get preview stream:", err)
      }
    }
    startPreview()

    return () => {
      mounted = false
      stopPreviewStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach preview stream to video element
  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream
    }
  }, [previewStream])

  const handleJoinRoom = async () => {
    if (!roomCode.trim()) {
      setError("Please enter a room code")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Check if user is already in a room
      const { is_in_room } = await connectRoom(roomCode.trim())
      
      let replace = false
      if (is_in_room) {
        const confirmed = window.confirm(
          "You are already in a meeting room. Do you want to leave it and join this one?"
        )
        if (confirmed) {
          replace = true
        } else {
          setIsLoading(false)
          return
        }
      }

      await joinRoom(roomCode.trim(), previewStream ?? undefined, replace)
      onJoined()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room")
    } finally {
      setIsLoading(false)
    }
  }

  const handleCameraChange = async (deviceId: string) => {
    try {
      await switchCamera(deviceId)
      await getPreviewStream(deviceId, selectedDevices?.microphone ?? undefined)
    } catch (err) {
      console.error("Failed to switch camera:", err)
    }
  }

  const handleMicChange = async (deviceId: string) => {
    try {
      await switchMicrophone(deviceId)
      await getPreviewStream(selectedDevices?.camera ?? undefined, deviceId)
    } catch (err) {
      console.error("Failed to switch microphone:", err)
    }
  }

  const toggleMic = () => {
    setMicEnabled(!micEnabled)
    if (previewStream) {
      previewStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = !micEnabled
      })
    }
  }

  const toggleCamera = () => {
    setCameraEnabled(!cameraEnabled)
    if (previewStream) {
      previewStream.getVideoTracks().forEach(track => {
        track.enabled = !cameraEnabled
      })
    }
  }

  // Load rooms list
  const loadRooms = useCallback(async () => {
    if (!client || !isAuthenticated) return

    setIsLoadingRooms(true)
    setRoomsError(null)

    try {
      const roomsList = await client.getRooms({ page: 1, perPage: 20 })
      setRooms(roomsList)
    } catch (err) {
      console.error("Failed to load rooms:", err)
      setRoomsError(err instanceof Error ? err.message : "Failed to load rooms")
    } finally {
      setIsLoadingRooms(false)
    }
  }, [client, isAuthenticated])

  // Create new room
  const handleCreateRoom = async () => {
    if (!client || !isAuthenticated || !newRoomName.trim()) return

    setIsCreatingRoom(true)
    setCreateRoomError(null)
    setCreatedRoomCode(null)

    try {
      const room = await client.createRoom({ name: newRoomName.trim(), autoJoin: false })
      setCreatedRoomCode(room.code)
      setNewRoomName("")
      // Reload rooms list
      await loadRooms()
    } catch (err) {
      console.error("Failed to create room:", err)
      setCreateRoomError(err instanceof Error ? err.message : "Failed to create room")
    } finally {
      setIsCreatingRoom(false)
    }
  }

  // Copy room code to clipboard
  const handleCopyCode = async () => {
    if (!createdRoomCode) return

    try {
      await navigator.clipboard.writeText(createdRoomCode)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  // Select a room from list
  const handleSelectRoom = (code: string) => {
    setRoomCode(code)
  }

  // Load rooms on mount when authenticated
  useEffect(() => {
    let cancelled = false

    if (client && isAuthenticated) {
      // Small delay to batch with other state updates
      const timer = setTimeout(() => {
        if (!cancelled) {
          loadRooms()
        }
      }, 100)

      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }
  }, [client, isAuthenticated, loadRooms])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Join Meeting</h1>
          <p className="text-slate-400">Configure your settings before joining</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Video Preview */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Camera Preview</CardTitle>
              <CardDescription className="text-slate-400">
                Check your video before joining
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${!cameraEnabled ? 'hidden' : ''}`}
                />
                {!cameraEnabled && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <IconVideoOff className="h-16 w-16 text-slate-600" />
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-4">
                <Button
                  variant={micEnabled ? "secondary" : "destructive"}
                  size="icon"
                  onClick={toggleMic}
                  className="h-12 w-12 rounded-full"
                >
                  {micEnabled ? <IconMicrophone className="h-5 w-5" /> : <IconMicrophoneOff className="h-5 w-5" />}
                </Button>
                <Button
                  variant={cameraEnabled ? "secondary" : "destructive"}
                  size="icon"
                  onClick={toggleCamera}
                  className="h-12 w-12 rounded-full"
                >
                  {cameraEnabled ? <IconVideo className="h-5 w-5" /> : <IconVideoOff className="h-5 w-5" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Settings */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <IconSettings className="h-5 w-5" />
                Settings
              </CardTitle>
              <CardDescription className="text-slate-400">
                Configure your meeting settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Room Code */}
              <div className="space-y-2">
                <Label htmlFor="roomCode" className="text-white">Room Code</Label>
                <Input
                  id="roomCode"
                  placeholder="Enter room code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white"
                />
              </div>

              {/* Camera Select */}
              <div className="space-y-2">
                <Label className="text-white">Camera</Label>
                <Select
                  value={selectedDevices?.camera || undefined}
                  onValueChange={handleCameraChange}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-600 text-white">
                    <SelectValue placeholder="Select camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices?.cameras
                      ?.filter((device) => device.deviceId)
                      .map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Microphone Select */}
              <div className="space-y-2">
                <Label className="text-white">Microphone</Label>
                <Select
                  value={selectedDevices?.microphone || undefined}
                  onValueChange={handleMicChange}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-600 text-white">
                    <SelectValue placeholder="Select microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices?.microphones
                      ?.filter((device) => device.deviceId)
                      .map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleJoinRoom}
                disabled={isLoading || !roomCode.trim()}
              >
                {isLoading ? (
                  <>
                    <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining...
                  </>
                ) : (
                  "Join Room"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Create Room Section */}
        <div className="mt-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <IconPlus className="h-5 w-5" />
                Create New Room
              </CardTitle>
              <CardDescription className="text-slate-400">
                Create a new meeting room and share the code with participants
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  placeholder="Enter room name"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white flex-1"
                />
                <Button
                  onClick={handleCreateRoom}
                  disabled={isCreatingRoom || !newRoomName.trim()}
                >
                  {isCreatingRoom ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <IconPlus className="h-4 w-4 mr-2" />
                      Create
                    </>
                  )}
                </Button>
              </div>

              {createRoomError && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {createRoomError}
                </div>
              )}

              {createdRoomCode && (
                <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-green-400 text-sm font-medium mb-1">Room Created Successfully!</p>
                      <p className="text-white font-mono text-lg">{createdRoomCode}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyCode}
                      className="border-green-600 text-green-400 hover:bg-green-900/50"
                    >
                      {copiedCode ? (
                        <>
                          <IconCheck className="h-4 w-4 mr-2" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <IconCopy className="h-4 w-4 mr-2" />
                          Copy Code
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Room List Section */}
        <div className="mt-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white flex items-center gap-2">
                    <IconDoor className="h-5 w-5" />
                    Available Rooms
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Select a room to join or enter a room code manually
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadRooms}
                  disabled={isLoadingRooms}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  {isLoadingRooms ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <IconRefresh className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {roomsError && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md mb-4">
                  {roomsError}
                </div>
              )}

              {isLoadingRooms ? (
                <div className="flex items-center justify-center py-8">
                  <IconLoader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : rooms.length === 0 ? (
                <div className="text-center py-8">
                  <IconDoor className="h-12 w-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No active rooms available</p>
                  <p className="text-slate-500 text-sm mt-1">Create a new room or enter a room code above</p>
                </div>
              ) : (
                <div className="grid gap-3 max-h-64 overflow-y-auto">
                  {rooms.filter(room => room.room_code).map((room) => (
                    <div
                      key={room.id}
                      className={`bg-slate-900 border rounded-lg p-4 cursor-pointer transition-all hover:border-blue-500 ${roomCode === room.room_code ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700'
                        }`}
                      onClick={() => handleSelectRoom(room.room_code!)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-medium">{room.room_name}</p>
                          <p className="text-slate-400 text-sm font-mono">{room.room_code}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {roomCode === room.room_code && (
                            <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Selected</span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectRoom(room.room_code!)
                            }}
                            className="text-slate-300 hover:text-white hover:bg-slate-700"
                          >
                            Select
                          </Button>
                        </div>
                      </div>
                      {room.created_at && (
                        <p className="text-slate-500 text-xs mt-2">
                          Created: {new Date(room.created_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recording Permission Demo Section */}
        <div className="mt-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                🎥 Recording Permission Demo
              </CardTitle>
              <CardDescription className="text-slate-400">
                Request screen sharing permission before joining the meeting.
                This allows teachers to grant permission in the waiting room.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Button
                  onClick={async () => {
                    const result = await requestRecordingPermissions()
                    if (!result.granted) {
                      if (result.missingVideo) {
                        alert("Screen sharing requires video. Please share your screen.")
                      } else if (result.missingAudio) {
                        alert("Tab audio is required. Please enable audio when sharing.")
                      } else {
                        alert(`Permission denied: ${result.error?.message}`)
                      }
                    } else if (result.audioUnavailable) {
                      alert("Permission granted! Note: Tab audio unavailable (you shared window/screen instead of tab)")
                    } else {
                      alert("Permission granted! Both video and audio available.")
                    }
                  }}
                  disabled={isRecordingPermissionGranted()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isRecordingPermissionGranted() ? "✓ Permission Granted" : "Request Recording Permission"}
                </Button>

                {isRecordingPermissionGranted() && (
                  <Button
                    variant="outline"
                    onClick={releaseRecordingPermissions}
                    className="border-red-600 text-red-400 hover:bg-red-900/50"
                  >
                    Release Permission
                  </Button>
                )}
              </div>

              {isRecordingPermissionGranted() && (
                <div className="mt-4 p-2 bg-green-900/30 rounded-lg">
                  <p className="text-green-400 text-sm">✓ Screen sharing permission granted. Ready to record.</p>
                </div>
              )}

              <div className="text-slate-500 text-xs">
                <p>💡 Tip: When joining as a teacher, call this before joinRoom() to pre-grant permission.</p>
                <p>Then startRecording() will use the pre-granted stream without showing a dialog.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

