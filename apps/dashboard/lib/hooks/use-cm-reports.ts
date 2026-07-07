"use client";

import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/cm/reports";

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useCmReports() {
  const { data, error, isLoading, mutate } = useSWR(KEY, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  return {
    reports: (data ?? []) as unknown[],
    isLoading,
    error,
    refresh: () => mutate(),
  };
}

export const revalidateCmReports = () => globalMutate(KEY);
