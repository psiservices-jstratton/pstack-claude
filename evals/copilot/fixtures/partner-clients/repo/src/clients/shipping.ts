import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";

export type Parcel = { weightGrams: number; toZip: string };

export function createShippingClient(deps: { http: Http; sleep: Sleep }) {
  async function send(url: string, body: unknown): Promise<HttpResponse> {
    let attempt = 0;
    while (true) {
      const res = await deps.http({ method: "POST", url, body });
      if (res.status < 500) return res;
      attempt++;
      if (attempt >= 3) throw new PartnerError("shipping", res.status);
      await deps.sleep(100 * 2 ** (attempt - 1));
    }
  }

  return {
    async quote(parcel: Parcel): Promise<number> {
      const res = await send("https://ship.example/quote", parcel);
      if (res.status !== 200) throw new PartnerError("shipping", res.status);
      return (res.body as { cents: number }).cents;
    },
  };
}
