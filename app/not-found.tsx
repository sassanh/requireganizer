"use client";

import { Button, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { currentHrefOf } from "lib/routes";

/** A missing page; a link from before projects moved to the query is sent on. */
export default function NotFound() {
  const router = useRouter();
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const current = currentHrefOf(pathname, search, hash);
    if (current != null) router.replace(current);
  }, [router]);
  return (
    <Stack sx={{ alignItems: "center", py: 6, gap: 2 }}>
      <Typography variant="h5">This page does not exist.</Typography>
      <Button component={Link} href="/">
        Projects
      </Button>
    </Stack>
  );
}
