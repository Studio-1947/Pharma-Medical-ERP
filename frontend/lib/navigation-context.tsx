"use client";

import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

interface NavigationCtx {
  isPending: boolean;
  navigate: (href: string) => void;
}

const NavigationContext = createContext<NavigationCtx>({
  isPending: false,
  navigate: () => {},
});

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href as any);
      });
    },
    [router],
  );

  return (
    <NavigationContext.Provider value={{ isPending, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  return useContext(NavigationContext);
}
