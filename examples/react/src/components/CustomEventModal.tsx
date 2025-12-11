import { useState, useEffect, useCallback } from "react"
import { useErmisClassroom } from "@ermisnetwork/ermis-classroom-react"
import { RoomServiceClient } from "@ermisnetwork/ermis-classroom-sdk"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IconX, IconSend, IconRefresh } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface CustomEventModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ReceivedEvent {
  id: string
  timestamp: number
  data: unknown
}

const API_HOST = "https://daibo.ermis.network:9935/meeting"

export function CustomEventModal({ isOpen, onClose }: CustomEventModalProps) {
  const { currentRoom } = useErmisClassroom()
  
  const [serviceToken, setServiceToken] = useState<string>("")
  const [roomServiceClient, setRoomServiceClient] = useState<RoomServiceClient | null>(null)
  const [isLoadingToken, setIsLoadingToken] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)
  
  const [eventType, setEventType] = useState("test_event")
  const [eventPayload, setEventPayload] = useState('{"message": "Hello from custom event!"}')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  
  const [receivedEvents, setReceivedEvents] = useState<ReceivedEvent[]>([])

  const getDummyServiceToken = useCallback(async () => {
    setIsLoadingToken(true)
    setTokenError(null)
    try {
      const response = await fetch(`${API_HOST}/get-service-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issuer: "test@example.com" }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setServiceToken(data.access_token)
      const rsClient = new RoomServiceClient(API_HOST, data.access_token)
      setRoomServiceClient(rsClient)
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : "Failed to get token")
    } finally {
      setIsLoadingToken(false)
    }
  }, [])

  useEffect(() => {
    if (!currentRoom) return

    const unsubscribe = currentRoom.onCustomEvent((event) => {
      console.log('Received custom event via Room.onCustomEvent:', event);
      setReceivedEvents(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        data: event,
      }, ...prev].slice(0, 20))
    })

    return () => { unsubscribe() }
  }, [currentRoom])

  const handleSendViaSDK = async () => {
    if (!currentRoom) return
    setIsSending(true)
    setSendError(null)
    setSendSuccess(false)
    try {
      const payload = JSON.parse(eventPayload)
      await currentRoom.sendCustomEvent([], { type: eventType, ...payload })
      setSendSuccess(true)
      setTimeout(() => setSendSuccess(false), 2000)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send")
    } finally {
      setIsSending(false)
    }
  }

  const handleSendViaService = async () => {
    if (!roomServiceClient || !currentRoom) return
    setIsSending(true)
    setSendError(null)
    setSendSuccess(false)
    try {
      const payload = JSON.parse(eventPayload)
      await roomServiceClient.sendCustomEvent({
        room_id: currentRoom.id,
        event: {
          sender_stream_id: currentRoom.streamId || "",
          target: { type: "room" },
          value: { type: eventType, ...payload },
        },
      })
      setSendSuccess(true)
      setTimeout(() => setSendSuccess(false), 2000)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send")
    } finally {
      setIsSending(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Custom Event Tester</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded">
            <IconX className="h-5 w-5 text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-white">Service Token</Label>
            <div className="flex gap-2">
              <Input value={serviceToken} readOnly placeholder="Click to get token..." className="flex-1 bg-slate-700 text-white text-xs" />
              <Button onClick={getDummyServiceToken} disabled={isLoadingToken} size="sm">
                <IconRefresh className={cn("h-4 w-4", isLoadingToken && "animate-spin")} />
              </Button>
            </div>
            {tokenError && <p className="text-red-400 text-sm">{tokenError}</p>}
            {serviceToken && <p className="text-green-400 text-sm">Token acquired!</p>}
          </div>
          <div className="space-y-2">
            <Label className="text-white">Event Type</Label>
            <Input value={eventType} onChange={(e) => setEventType(e.target.value)} className="bg-slate-700 text-white" />
          </div>
          <div className="space-y-2">
            <Label className="text-white">Event Payload (JSON)</Label>
            <textarea value={eventPayload} onChange={(e) => setEventPayload(e.target.value)} className="w-full h-20 bg-slate-700 text-white rounded p-2 text-sm font-mono" />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSendViaSDK} disabled={isSending || !currentRoom} className="flex-1">
              <IconSend className="h-4 w-4 mr-2" /> Send via SDK
            </Button>
            <Button onClick={handleSendViaService} disabled={isSending || !roomServiceClient || !currentRoom} variant="secondary" className="flex-1">
              <IconSend className="h-4 w-4 mr-2" /> Send via Service
            </Button>
          </div>
          {sendError && <p className="text-red-400 text-sm">{sendError}</p>}
          {sendSuccess && <p className="text-green-400 text-sm">Event sent successfully!</p>}
          <div className="space-y-2">
            <Label className="text-white">Received Events ({receivedEvents.length})</Label>
            <div className="bg-slate-900 rounded p-2 h-40 overflow-y-auto text-xs font-mono">
              {receivedEvents.length === 0 ? (
                <p className="text-slate-500">No events received yet...</p>
              ) : (
                receivedEvents.map((evt) => (
                  <div key={evt.id} className="text-slate-300 mb-2 pb-2 border-b border-slate-700">
                    <span className="text-slate-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    <pre className="whitespace-pre-wrap">{JSON.stringify(evt.data, null, 2)}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

