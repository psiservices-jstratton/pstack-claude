import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";

export function createTaxClient(deps: { http: Http; sleep: Sleep }) {
  async function get(url: string): Promise<HttpResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await deps.sleep(50);
      try {
        const res = await deps.http({ method: "GET", url });
        if (res.status !== 503) return res;
        lastError = new PartnerError("tax", res.status);
      } catch (error) {
        if (error instanceof PartnerError) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  return {
    async rate(zip: string): Promise<number> {
      const res = await get(`https://tax.example/rates/${zip}`);
      if (res.status !== 200) throw new PartnerError("tax", res.status);
      return (res.body as { rate: number }).rate;
    },
  };
}
