"use client";

import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/cm/scans";

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useCmScans() {
  const { data, error, isLoading, mutate } = useSWR(KEY, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  return {
    scans: (data ?? []) as unknown[],
    isLoading,
    error,
    refresh: () => mutate(),
  };
}

export const revalidateCmScans = () => globalMutate(KEY);
