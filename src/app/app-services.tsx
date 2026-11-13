import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { StartupErrorScreen, StartupLoadingScreen } from "@/ui/layout/startup-screen";

import type { AppServices } from "./services";
import { describeError, StartupError, startApp, type StartupFailureReason } from "./startup";

const AppServicesContext = createContext<AppServices | null>(null);

type StartupState =
  | { status: "loading" }
  | { status: "ready"; services: AppServices }
  | { status: "failed"; reason: StartupFailureReason; details: string };

/**
 * Starts the app (database, migrations, services) and renders `children`
 * with the services once it is ready – until then a loading screen, on
 * failure an error screen with the details.
 *
 * The start runs in an effect, i.e. only in the WebView: the prerendered SPA
 * shell (Node) contains the loading screen.
 */
export function AppServicesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<StartupState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    startApp().then(
      (services) => {
        if (active) setState({ status: "ready", services });
      },
      (error: unknown) => {
        console.error("App start failed", error);
        if (active) {
          setState({
            status: "failed",
            reason: error instanceof StartupError ? error.reason : "error",
            details: describeError(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  switch (state.status) {
    case "loading":
      return <StartupLoadingScreen />;
    case "failed":
      return (
        <StartupErrorScreen
          reason={state.reason}
          details={state.details}
          onRetry={() => window.location.reload()}
        />
      );
    case "ready":
      return (
        <AppServicesContext.Provider value={state.services}>{children}</AppServicesContext.Provider>
      );
  }
}

/** The app's services; only below {@link AppServicesProvider}. */
export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) {
    throw new Error("useAppServices() must be used below <AppServicesProvider>");
  }
  return services;
}
