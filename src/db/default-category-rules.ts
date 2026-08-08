// Generic auto-categorization rules seeded alongside the default category
// tree (see default-categories.ts). `categoryName` is resolved against the
// household's freshly-seeded categories by exact name match at insert time
// (see src/lib/actions/household.ts).

export interface DefaultCategoryRule {
  matchText: string;
  categoryName: string;
}

export const DEFAULT_CATEGORY_RULES: DefaultCategoryRule[] = [
  // Food / Delivery
  { matchText: "glovo", categoryName: "Delivery" },
  { matchText: "pedidosya", categoryName: "Delivery" },
  { matchText: "uber eats", categoryName: "Delivery" },
  { matchText: "rappi", categoryName: "Delivery" },

  // Food / Groceries
  { matchText: "supermercado", categoryName: "Groceries" },
  { matchText: "carrefour", categoryName: "Groceries" },
  { matchText: "stock", categoryName: "Groceries" },
  { matchText: "superseis", categoryName: "Groceries" },

  // Transport
  { matchText: "cabify", categoryName: "Taxi & Rideshare" },
  { matchText: "ypf", categoryName: "Fuel" },
  { matchText: "petrobras", categoryName: "Fuel" },

  // Health / Pharmacy
  { matchText: "farmacia", categoryName: "Pharmacy" },
  { matchText: "pharmacy", categoryName: "Pharmacy" },

  // Personal / Subscriptions
  { matchText: "spotify", categoryName: "Subscriptions" },
  { matchText: "netflix", categoryName: "Subscriptions" },
  { matchText: "hbo", categoryName: "Subscriptions" },
  { matchText: "youtube premium", categoryName: "Subscriptions" },
  { matchText: "disney+", categoryName: "Subscriptions" },

  // Leisure / Travel — airlines and booking sites
  { matchText: "aerolineas", categoryName: "Travel" },
  { matchText: "iberia", categoryName: "Travel" },
  { matchText: "latam", categoryName: "Travel" },
  { matchText: "ryanair", categoryName: "Travel" },
  { matchText: "vueling", categoryName: "Travel" },
  { matchText: "booking.com", categoryName: "Travel" },
  { matchText: "airbnb", categoryName: "Travel" },

  // Housing / Internet & Phone
  { matchText: "movistar", categoryName: "Internet & Phone" },
  { matchText: "claro", categoryName: "Internet & Phone" },
  { matchText: "personal", categoryName: "Internet & Phone" },

  // Income
  { matchText: "salario", categoryName: "Salary" },
  { matchText: "nomina", categoryName: "Salary" },
];
