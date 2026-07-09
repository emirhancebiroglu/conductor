"use client";

import useSWR, { mutate as globalMutate } from "swr";

export const PAGE_LIMIT = 50;

type ReposPage = {
  repos: unknown[];
  total: number;
  page: number;
  limit: number;
};

function reposKey(page: number, search: string) {
  const q = search.trim();
  const searchParam = q ? `&search=${encodeURIComponent(q)}` : "";
  return `/api/cm/repos?page=${page}&limit=${PAGE_LIMIT}${searchParam}`;
}

async function fetcher(url: string): Promise<ReposPage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useCmRepos(page = 0, search = "") {
  const key = reposKey(page, search);
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  return {
    repos: data?.repos ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? page,
    limit: data?.limit ?? PAGE_LIMIT,
    isLoading,
    error,
    refresh: () => mutate(),
    mutate,
  };
}

export const revalidateCmRepos = (page = 0, search = "") => globalMutate(reposKey(page, search));
