"use client";

import useSWR, { mutate as globalMutate } from "swr";

function key(id: string | null) {
  return id ? `/api/cm/scans/${id}` : null;
}

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useCmScanDetail(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(key(id), fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  return {
    detail: data as unknown,
    isLoading,
    error,
    refresh: () => mutate(),
  };
}

export const revalidateCmScanDetail = (id: string) => globalMutate(`/api/cm/scans/${id}`);
