// Default category tree seeded into every new household. User-editable after.
// `children` become rows with parent_id pointing at the top-level row.

export interface DefaultCategory {
  name: string;
  icon: string;
  children?: { name: string; icon?: string }[];
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: "Food",
    icon: "🍽️",
    children: [
      { name: "Groceries" },
      { name: "Restaurants" },
      { name: "Delivery" },
    ],
  },
  {
    name: "Housing",
    icon: "🏠",
    children: [
      { name: "Rent" },
      { name: "Utilities" },
      { name: "Internet & Phone" },
      { name: "Maintenance" },
    ],
  },
  {
    name: "Transport",
    icon: "🚌",
    children: [
      { name: "Public transport" },
      { name: "Taxi & Rideshare" },
      { name: "Fuel" },
    ],
  },
  {
    name: "Health",
    icon: "🩺",
    children: [{ name: "Pharmacy" }, { name: "Doctor" }, { name: "Insurance" }],
  },
  {
    name: "Personal",
    icon: "🧍",
    children: [
      { name: "Clothing" },
      { name: "Beauty & Care" },
      { name: "Subscriptions" },
    ],
  },
  {
    name: "Leisure",
    icon: "🎉",
    children: [
      { name: "Entertainment" },
      { name: "Travel" },
      { name: "Gifts" },
    ],
  },
  { name: "Education", icon: "📚" },
  { name: "Pets", icon: "🐾" },
  { name: "Fees & Charges", icon: "🏦" },
  {
    name: "Income",
    icon: "💰",
    children: [{ name: "Salary" }, { name: "Freelance" }, { name: "Other" }],
  },
  { name: "Other", icon: "❓" },
];
