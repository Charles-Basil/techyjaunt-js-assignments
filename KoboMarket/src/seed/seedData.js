// Demo data for `npm run seed`. Prices are kobo (100 kobo = NGN 1).
const PASSWORD = 'Password123';
const BUYER_FUNDING_KOBO = 5_000_000; // NGN 50,000 each

const img = (name) => `https://picsum.photos/seed/${name}/600/600`;

const admin = { email: 'admin@kobomarket.test', firstName: 'Kobo', lastName: 'Admin' };

const vendors = [
  {
    email: 'vendor1@kobomarket.test',
    firstName: 'Tunde',
    lastName: 'Bakare',
    storeName: 'Lagos Gadget Hub',
    description: 'Phones, accessories and smart home gear from Computer Village.',
    bank: { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456781', accountName: 'Tunde Bakare' },
  },
  {
    email: 'vendor2@kobomarket.test',
    firstName: 'Chiamaka',
    lastName: 'Okafor',
    storeName: 'Ankara & Aso Couture',
    description: 'Handmade Ankara, adire and beauty essentials from Aba.',
    bank: { bankName: 'Access Bank', bankCode: '044', accountNumber: '0234567892', accountName: 'Chiamaka Okafor' },
  },
  {
    email: 'vendor3@kobomarket.test',
    firstName: 'Musa',
    lastName: 'Abdullahi',
    storeName: 'Naija Pantry',
    description: 'Groceries, spices and home essentials, delivered fresh.',
    // Ends in 0000: the mock bank transfer FAILS, for the failed-payout demo.
    bank: { bankName: 'Zenith Bank', bankCode: '057', accountNumber: '0345670000', accountName: 'Musa Abdullahi' },
  },
];

// vendor: index into `vendors`. Products with variants: base stock = sum of variant stock.
const products = [
  // ---- Lagos Gadget Hub (electronics, home) ----
  {
    vendor: 0,
    name: 'Tecno Spark 20 Pro Smartphone',
    category: 'electronics',
    description: '6.78" display, 256GB storage, 108MP camera.',
    priceKobo: 21_500_000,
    tags: ['phone', 'android', 'tecno'],
    variants: [
      { name: 'Moonlit Black', sku: 'TSP20-BLK', attributes: { colour: 'black' }, priceKobo: 21_500_000, stock: 8 },
      { name: 'Frosty Ivory', sku: 'TSP20-IVR', attributes: { colour: 'ivory' }, priceKobo: 21_500_000, stock: 5 },
      { name: 'Magic Skin Green', sku: 'TSP20-GRN', attributes: { colour: 'green' }, priceKobo: 22_000_000, stock: 3 },
    ],
  },
  { vendor: 0, name: 'Oraimo FreePods 4 Earbuds', category: 'electronics', description: 'Noise cancelling, 35h battery.', priceKobo: 2_850_000, stock: 40, tags: ['audio', 'oraimo'] },
  { vendor: 0, name: '20000mAh Fast-Charge Power Bank', category: 'electronics', description: 'Charges a phone 4 times. NEPA-proof.', priceKobo: 1_800_000, stock: 60, tags: ['power', 'charger'] },
  { vendor: 0, name: 'Hisense 43" Smart TV', category: 'electronics', description: 'Full HD, Netflix and YouTube built in.', priceKobo: 32_000_000, stock: 6, tags: ['tv', 'hisense'] },
  { vendor: 0, name: 'Rechargeable Standing Fan 16"', category: 'home', description: 'Runs 8 hours on battery with solar input.', priceKobo: 4_500_000, stock: 25, tags: ['fan', 'solar'] },
  { vendor: 0, name: 'Binatone Electric Kettle 1.7L', category: 'home', description: 'Stainless steel, auto shut-off.', priceKobo: 1_450_000, stock: 30, tags: ['kitchen'] },
  { vendor: 0, name: 'Smart Wi-Fi LED Bulb (4-pack)', category: 'home', description: 'App control, 16 million colours.', priceKobo: 1_200_000, stock: 50, tags: ['lighting', 'smart-home'] },

  // ---- Ankara & Aso Couture (fashion, beauty) ----
  {
    vendor: 1,
    name: 'Ankara Wrap Maxi Dress',
    category: 'fashion',
    description: 'Hand-tailored in Aba, 100% cotton wax print.',
    priceKobo: 2_500_000,
    tags: ['ankara', 'dress', 'women'],
    variants: [
      { name: 'Size S', sku: 'ANK-DRS-S', attributes: { size: 'S' }, priceKobo: 2_500_000, stock: 6 },
      { name: 'Size M', sku: 'ANK-DRS-M', attributes: { size: 'M' }, priceKobo: 2_500_000, stock: 10 },
      { name: 'Size L', sku: 'ANK-DRS-L', attributes: { size: 'L' }, priceKobo: 2_700_000, stock: 7 },
    ],
  },
  {
    vendor: 1,
    name: 'Adire Kampala Shirt',
    category: 'fashion',
    description: 'Indigo-dyed adire from Abeokuta, unisex fit.',
    priceKobo: 1_800_000,
    tags: ['adire', 'shirt', 'men'],
    variants: [
      { name: 'Indigo / M', sku: 'ADR-IND-M', attributes: { size: 'M', colour: 'indigo' }, priceKobo: 1_800_000, stock: 9 },
      { name: 'Indigo / L', sku: 'ADR-IND-L', attributes: { size: 'L', colour: 'indigo' }, priceKobo: 1_800_000, stock: 9 },
      { name: 'Rust / L', sku: 'ADR-RST-L', attributes: { size: 'L', colour: 'rust' }, priceKobo: 1_950_000, stock: 4 },
    ],
  },
  {
    vendor: 1,
    name: 'Handmade Leather Palm Slippers',
    category: 'fashion',
    description: 'Genuine leather, made in Kano.',
    priceKobo: 1_500_000,
    tags: ['shoes', 'leather', 'men'],
    variants: [
      { name: 'Size 42 / Brown', sku: 'PLM-42-BRN', attributes: { size: '42', colour: 'brown' }, priceKobo: 1_500_000, stock: 5 },
      { name: 'Size 43 / Brown', sku: 'PLM-43-BRN', attributes: { size: '43', colour: 'brown' }, priceKobo: 1_500_000, stock: 5 },
      { name: 'Size 44 / Black', sku: 'PLM-44-BLK', attributes: { size: '44', colour: 'black' }, priceKobo: 1_600_000, stock: 3 },
    ],
  },
  { vendor: 1, name: 'Aso-Oke Gele Headtie', category: 'fashion', description: 'Ready-to-tie, for owambe season.', priceKobo: 1_200_000, stock: 20, tags: ['gele', 'aso-oke'] },
  { vendor: 1, name: 'Shea Butter Body Cream 500g', category: 'beauty', description: 'Unrefined shea from Kwara, with coconut oil.', priceKobo: 650_000, stock: 45, tags: ['skincare', 'shea'] },
  { vendor: 1, name: 'African Black Soap (3 bars)', category: 'beauty', description: 'Ose dudu, handmade with plantain ash.', priceKobo: 450_000, stock: 70, tags: ['skincare', 'soap'] },
  { vendor: 1, name: 'Hair Growth Oil with Chebe', category: 'beauty', description: 'For natural hair, 120ml.', priceKobo: 800_000, stock: 35, tags: ['haircare'] },

  // ---- Naija Pantry (groceries, home, beauty) ----
  { vendor: 2, name: 'Mama Gold Rice 25kg', category: 'groceries', description: 'Long grain parboiled rice.', priceKobo: 4_800_000, stock: 30, tags: ['rice', 'staples'] },
  { vendor: 2, name: 'Ofada Rice 5kg', category: 'groceries', description: 'Local unpolished rice, stone-free.', priceKobo: 1_100_000, stock: 40, tags: ['rice', 'local'] },
  { vendor: 2, name: 'Pure Palm Oil 4L', category: 'groceries', description: 'Fresh red oil from Imo.', priceKobo: 950_000, stock: 50, tags: ['oil', 'cooking'] },
  { vendor: 2, name: 'Suya Spice Mix (Yaji) 250g', category: 'groceries', description: 'Authentic northern pepper blend.', priceKobo: 300_000, stock: 100, tags: ['spice', 'suya'] },
  { vendor: 2, name: 'Non-stick Pot Set (5 pieces)', category: 'home', description: 'For jollof that does not burn.', priceKobo: 2_200_000, stock: 15, tags: ['kitchen', 'cookware'] },
  { vendor: 2, name: 'Coconut Oil Cold-Pressed 1L', category: 'beauty', description: 'For cooking, skin and hair.', priceKobo: 700_000, stock: 40, tags: ['coconut', 'natural'] },
].map((p, i) => {
  const stock = p.variants ? p.variants.reduce((sum, v) => sum + v.stock, 0) : p.stock;
  return { ...p, stock, images: [img(`kobo-${i + 1}`)] };
});

const buyers = [
  { email: 'buyer1@kobomarket.test', firstName: 'Adaeze', lastName: 'Nwosu' },
  { email: 'buyer2@kobomarket.test', firstName: 'Femi', lastName: 'Adeyemi' },
  { email: 'buyer3@kobomarket.test', firstName: 'Zainab', lastName: 'Bello' },
  { email: 'buyer4@kobomarket.test', firstName: 'Emeka', lastName: 'Eze' },
  { email: 'buyer5@kobomarket.test', firstName: 'Kemi', lastName: 'Oladipo' },
];

module.exports = { PASSWORD, BUYER_FUNDING_KOBO, admin, vendors, products, buyers };
