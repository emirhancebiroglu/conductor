export interface SupabaseResponse<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export function mockResponse<T>(data: T): SupabaseResponse<T> {
  return { data, error: null };
}

export function mockErrorResponse<T>(message: string): SupabaseResponse<T> {
  return { data: null, error: { message } };
}
