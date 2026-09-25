export type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type Http = (req: HttpRequest) => Promise<HttpResponse>;
export type Sleep = (ms: number) => Promise<void>;

export class PartnerError extends Error {
  status: number;
  constructor(partner: string, status: number) {
    super(`${partner} request failed with status ${status}`);
    this.status = status;
  }
}

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
