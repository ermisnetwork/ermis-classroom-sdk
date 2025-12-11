import {createContext, useContext, useState} from "react";
import {AppConfig} from "@/lib/config.ts";

export interface AppContextType {
  apiHost: string;
  node: string;
  setConfig: (apiHost: string, node: string) => void;
}

export const AppContext = createContext<AppContextType>({
  apiHost: AppConfig.apiHosts[0],
  node: AppConfig.nodes[0],
  setConfig: () => {},
});
export const useAppContext = () => useContext(AppContext);


export const AppContextProvider = ({children}: {children: React.ReactNode}) => {
  const [apiHost, setApiHost] = useState(AppConfig.apiHosts[0])
  const [node, setNode] = useState(AppConfig.nodes[0])
  
  return (
    <AppContext.Provider value={{
      apiHost,
      node,
      setConfig: (apiHost, node) => {
        setApiHost(apiHost)
        setNode(node)
      },
    }}>
      {children}
    </AppContext.Provider>
  )
}