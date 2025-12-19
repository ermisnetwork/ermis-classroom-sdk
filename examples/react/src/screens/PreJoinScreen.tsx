import { useState, useEffect, useRef } from "react"
import { useErmisClassroom } from "@ermisnetwork/ermis-classroom-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IconLoader2, IconMicrophone, IconMicrophoneOff, IconVideo, IconVideoOff, IconSettings } from "@tabler/icons-react"

interface PreJoinScreenProps {
  onJoined: () => void
}

export function PreJoinScreen({ onJoined }: PreJoinScreenProps) {
  const [roomCode, setRoomCode] = useState("5fq9-audt-x7xb")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  const {
    devices,
    selectedDevices,
    switchCamera,
    switchMicrophone,
    getPreviewStream,
    stopPreviewStream,
    previewStream,
    joinRoom,
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
      await joinRoom(roomCode.trim(), previewStream ?? undefined)
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
      previewStream.getAudioTracks().forEach(track => {
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
      </div>
    </div>
  )
}

