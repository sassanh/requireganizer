"use client";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import { getSnapshot } from "mobx-state-tree";
import { useEffect, useState } from "react";

import Link from "components/Link";
import { Store, storeContext } from "store";

import { theme } from "./theme";
let isStoreReloadNeeded = true;

export default function Providers({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState(() => {
    isStoreReloadNeeded = false;
    return Store.create({ productOverview: {} });
  });

  useEffect(() => {
    if (isStoreReloadNeeded) {
      console.warn("Reloading store...");
      const snapshot = getSnapshot(store);
      setStore(Store.create(snapshot));
      isStoreReloadNeeded = false;
      console.warn("...reloading store done!");
    }
  }, [store]);

  return (
    <storeContext.Provider value={store}>
      <AppRouterCacheProvider options={{}}>
        <ThemeProvider theme={theme}>
          <DefaultPropsProvider
            value={{
              MuiLink: { component: Link },
              MuiButtonBase: { LinkComponent: Link },
              MuiTab: { LinkComponent: Link },
            }}
          >
            {children}
          </DefaultPropsProvider>
        </ThemeProvider>
      </AppRouterCacheProvider>
    </storeContext.Provider>
  );
}
