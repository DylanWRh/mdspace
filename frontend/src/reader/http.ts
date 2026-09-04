interface ErrorPayload {
  error?: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function getJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorPayload = payload as ErrorPayload;
    throw new HttpError(
      errorPayload.error ?? `Request failed: ${response.status}`,
      response.status,
    );
  }
  return payload as T;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
