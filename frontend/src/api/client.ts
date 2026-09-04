export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type JsonObject = Record<string, unknown>;

export class ApiClient {
  constructor(private readonly workspaceToken: string) {}

  get<T>(url: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(url, options);
  }

  put<T>(url: string, body: JsonObject): Promise<T> {
    return this.request<T>(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  postForm<T>(url: string, body: FormData): Promise<T> {
    return this.request<T>(url, { method: "POST", body });
  }

  private async request<T>(url: string, options: RequestInit): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("X-Workspace-Token", this.workspaceToken);
    const response = await fetch(url, { ...options, headers });
    const payload = (await response.json().catch(() => ({}))) as JsonObject;
    if (!response.ok) {
      throw new ApiError(
        typeof payload.error === "string"
          ? payload.error
          : `Request failed: ${response.status}`,
        response.status,
        payload,
      );
    }
    return payload as T;
  }
}
