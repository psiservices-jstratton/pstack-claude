export type CatalogItem = {
  id: string;
  title: string;
  priceCents: number;
  active: boolean;
};

export type FetchCatalogItem = (id: string) => Promise<CatalogItem>;
