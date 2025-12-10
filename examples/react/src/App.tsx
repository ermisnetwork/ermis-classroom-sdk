import { useState } from "react"
import { ErmisClassroomProvider } from "@ermisnetwork/ermis-classroom-react"
import { AuthScreen } from "./screens/AuthScreen"
import { PreJoinScreen } from "./screens/PreJoinScreen"
import { MeetingRoom } from "./screens/MeetingRoom"

type AppScreen = "auth" | "prejoin" | "meeting"

function AppContent() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("auth")

  switch (currentScreen) {
    case "auth":
      return <AuthScreen onAuthenticated={() => setCurrentScreen("prejoin")} />
    case "prejoin":
      return <PreJoinScreen onJoined={() => setCurrentScreen("meeting")} />
    case "meeting":
      return <MeetingRoom onLeft={() => setCurrentScreen("prejoin")} />
    default:
      return <AuthScreen onAuthenticated={() => setCurrentScreen("prejoin")} />
  }
}

function App() {
  return (
    <ErmisClassroomProvider
      config={{
        host: "daibo.ermis.network:9937",
        webtpUrl: "https://admin.bandia.vn:9997/meeting/wt",
      }}
    >
      <AppContent />
    </ErmisClassroomProvider>
  )
}

export default App

