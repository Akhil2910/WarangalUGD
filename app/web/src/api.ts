import { CSRF_HEADER } from 'shared';

export interface User {
  id: string;
  email: string;
  name: string;
  designation: string;
  role: string;
  must_change_password: boolean;
  ulb_id: number;
  ulb?: { code: string; short_name: string; name: string; app_title: string };
  role_key: string;
  role_label: string;
  perms: string[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`, data.code);
  return data as T;
}
