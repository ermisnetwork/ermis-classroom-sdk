import { useState } from "react"
import { AuthScreen } from "./screens/AuthScreen"
import { PreJoinScreen } from "./screens/PreJoinScreen"
import { MeetingRoom } from "./screens/MeetingRoom"
import { ErmisClassroomProvider } from '@ermisnetwork/ermis-classroom-react';
import { CustomEventModal } from "./components/CustomEventModal"
import { IconBolt } from "@tabler/icons-react"

type AppScreen = "auth" | "prejoin" | "meeting"

function AppContent() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("auth")
  const [isCustomEventModalOpen, setIsCustomEventModalOpen] = useState(false)

  return (
    <>
      {currentScreen === "auth" && (
        <AuthScreen onAuthenticated={() => setCurrentScreen("prejoin")} />
      )}
      {currentScreen === "prejoin" && (
        <PreJoinScreen onJoined={() => setCurrentScreen("meeting")} />
      )}
      {currentScreen === "meeting" && (
        <MeetingRoom onLeft={() => setCurrentScreen("prejoin")} />
      )}

      {/* Floating button to open Custom Event Modal */}
      <button
        onClick={() => setIsCustomEventModalOpen(true)}
        className="fixed bottom-4 right-4 z-40 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-colors"
        title="Custom Event Tester"
      >
        <IconBolt className="h-6 w-6" />
      </button>

      <CustomEventModal
        isOpen={isCustomEventModalOpen}
        onClose={() => setIsCustomEventModalOpen(false)}
      />
    </>
  )
}

function App() {
  return (
    <ErmisClassroomProvider
      config={{
        host: "daibo.ermis.network:9935",
        webtpUrl: "https://admin.bandia.vn:9995/meeting/wt",
      }}
    >
      <AppContent />
    </ErmisClassroomProvider>
  )
}

export default App

