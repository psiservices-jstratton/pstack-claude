import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";

export function createPaymentsClient(deps: { http: Http; sleep: Sleep }) {
  async function send(url: string, body: unknown): Promise<HttpResponse> {
    for (let attempt = 1; ; attempt++) {
      const res = await deps.http({ method: "POST", url, body });
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable) return res;
      if (attempt === 5) throw new PartnerError("payments", res.status);
      const retryAfter = Number(res.headers["retry-after"]);
      const delay = res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
      await deps.sleep(delay);
    }
  }

  return {
    async charge(customerId: string, cents: number): Promise<string> {
      const res = await send("https://pay.example/charges", { customerId, cents });
      if (res.status !== 201) throw new PartnerError("payments", res.status);
      return (res.body as { id: string }).id;
    },
  };
}
