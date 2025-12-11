import {useState} from "react"
import {useErmisClassroom} from "@ermisnetwork/ermis-classroom-react"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card"
import {Label} from "@/components/ui/label"
import {IconLoader2, IconVideo} from "@tabler/icons-react"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select.tsx";
import {AppConfig} from "@/lib/config.ts";
import {useAppContext} from "@/components/AppContext.tsx";

interface AuthScreenProps {
  onAuthenticated: () => void
}

export function AuthScreen({onAuthenticated}: AuthScreenProps) {
  const [userId, setUserId] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {authenticate} = useErmisClassroom()
  const {apiHost, node, setConfig} = useAppContext();

  const handleAuthenticate = async () => {
    if (!userId.trim()) {
      setError("Please enter a user ID")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await authenticate(userId.trim())
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAuthenticate()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <IconVideo className="h-6 w-6 text-primary-foreground"/>
          </div>
          <CardTitle className="text-2xl">Ermis Classroom</CardTitle>
          <CardDescription>Enter your user ID to get started</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className='space-y-2'>
            <Label htmlFor={"apiHost"}>API Host</Label>
            <Select value={apiHost} onValueChange={value => setConfig(value, node)}>
              <SelectTrigger>
                <SelectValue/>
              </SelectTrigger>
              <SelectContent>
                {AppConfig.apiHosts.map(node => (
                  <SelectItem key={node} value={node}>
                    {node}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor={"node"}>Meeting Node</Label>
            <Select value={node} onValueChange={value => setConfig(apiHost, value)}>
              <SelectTrigger>
                <SelectValue/>
              </SelectTrigger>
              <SelectContent>
                {AppConfig.nodes.map(node => (
                  <SelectItem key={node} value={node}>
                    {node}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="userId">User ID</Label>
            <Input
              id="userId"
              placeholder="Enter your user ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}
          <Button
            className="w-full"
            onClick={handleAuthenticate}
            disabled={isLoading || !userId.trim()}
          >
            {isLoading ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin"/>
                Authenticating...
              </>
            ) : (
              "Authenticate"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

