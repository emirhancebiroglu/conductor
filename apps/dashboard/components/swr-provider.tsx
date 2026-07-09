"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 3000,
        revalidateOnFocus: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
