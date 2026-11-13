// Generates realistic demo bank statements (14 months up to today) in five different formats.
// Dates are relative to the day you run it, so "dormant" / "upcoming" logic always looks right.
//   npm run samples          -> writes the files into sample/
import fs from 'node:fs';
import path from 'node:path';

function rng(seed) {                       // mulberry32: deterministic pseudo-random numbers
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = {
  'DD/MM/YY': (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`,
  'DD-MM-YYYY': (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
  'DD MMM YYYY': (d) => `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`,
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayOfMonth = (y, m, day) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));

export function generateSamples(today = new Date()) {
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(today.getFullYear(), today.getMonth() - 14, 1);
  const r = rng(20261113);
  const ref = (len = 6) => Array.from({ length: len }, () => Math.floor(r() * 10)).join('');
  // reference codes like "K7Q2X" always contain a digit, as real ones do
  const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(r() * 24)]).join('') + Math.floor(r() * 10);
  const between = (a, b) => Math.round(a + r() * (b - a));
  const inRange = (d) => d >= start && d <= today;

  /** monthly charges on a day of month, optional from/to month offsets (0 = start month) */
  function monthly(day, fn, { fromMonth = 0, toMonth = 99 } = {}) {
    const out = [];
    for (let i = fromMonth; i <= Math.min(toMonth, 15); i++) {
      const d = dayOfMonth(start.getFullYear(), start.getMonth() + i, day);
      if (inRange(d)) out.push(fn(d, i));
    }
    return out;
  }
  function every(days, first, fn) {
    const out = [];
    for (let d = first, i = 0; d <= today; d = addDays(d, days), i++) if (inRange(d)) out.push(fn(d, i));
    return out;
  }
  function randomly(perMonth, fn) {
    const out = [];
    const totalDays = Math.round((today - start) / 864e5);
    const n = Math.round((perMonth * totalDays) / 30);
    for (let i = 0; i < n; i++) out.push(fn(addDays(start, Math.floor(r() * (totalDays + 1)))));
    return out;
  }
  const monthsTotal = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth();
  const priceRiseMonth = monthsTotal - 4;   // Netflix gets more expensive 4 months ago
  const gymStopMonth = monthsTotal - 4;     // gym charges stop 4 months ago -> dormant
  const icloudUpgrade = monthsTotal - 6;

  // ---------------- HDFC savings (Apeksha) ----------------
  const card = () => `4821XXXXXXXX${ref(4)}`;
  const hdfc = [
    ...monthly(5, (d, i) => [d, `POS ${card()} NETFLIX.COM ${ref()}`, i >= priceRiseMonth ? 649 : 499]),
    ...monthly(20, (d) => [d, `UPI/SPOTIFY/${ref(10)}/AUTOPAY`, 119]),
    ...monthly(12, (d) => [d, `NACH/CULT FIT GYM/${ref(8)}`, 1200], { toMonth: gymStopMonth }),
    ...monthly(1, (d) => [d, `IMPS/HOUSE RENT/${ref(8)}`, 25000]),
    ...every(28, addDays(start, 3), (d) => [d, `NACH/AIRTEL PREPAID/${ref(6)}`, 299]),
    ...monthly(18, (d) => [d, `BILLDESK/BESCOM ELECTRICITY/${ref(6)}`, between(850, 1750)]),
    [dayOfMonth(today.getFullYear(), today.getMonth() - 13, 22), `AMAZON PRIME*${code()}`, 1499],
    [dayOfMonth(today.getFullYear(), today.getMonth() - 1, 22), `AMAZON PRIME*${code()}`, 1499],
    ...randomly(7, (d) => [d, `UPI/SWIGGY/${ref(10)}/PAYMENT`, between(180, 760)]),
    ...randomly(3, (d) => [d, `UPI/ZOMATO/${ref(10)}/PAYMENT`, between(220, 900)]),
    ...randomly(4, (d) => [d, `UPI/BIGBASKET/${ref(10)}/PAYMENT`, between(400, 2600)]),
    ...randomly(2, (d) => [d, `AMAZON.IN ORDER #${ref(9)}`, between(300, 4200)]),
    ...randomly(6, (d) => [d, `SQ *COFFEE${ref(4)}`, between(140, 320)]),
    ...randomly(2, (d) => [d, `POS ${card()} HP PETROL PUMP`, between(800, 2500)]),
  ];
  // financial deja vu: the same order charged twice on consecutive days
  const dvDate = addDays(today, -19);
  hdfc.push([dvDate, `AMAZON.IN ORDER #${ref(9)}`, 2499], [addDays(dvDate, 1), `AMAZON.IN ORDER #${ref(9)}`, 2499]);
  const hdfcCredits = monthly(28, (d) => [d, 'NEFT/SALARY ACME ANALYTICS PVT LTD', 85000]);
  const hdfcRows = [
    ...hdfc.map(([d, n, a]) => ({ d, n, w: a, dep: '' })),
    ...hdfcCredits.map(([d, n, a]) => ({ d, n, w: '', dep: a })),
  ].sort((a, b) => a.d - b.d);
  let balance = 120000;
  const hdfcCsv = ['Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance'];
  for (const x of hdfcRows) {
    balance += (x.dep || 0) - (x.w || 0);
    hdfcCsv.push([fmt['DD/MM/YY'](x.d), `"${x.n}"`, ref(12), fmt['DD/MM/YY'](x.d),
      x.w === '' ? '' : x.w.toFixed(2), x.dep === '' ? '' : x.dep.toFixed(2), balance.toFixed(2)].join(','));
  }
  hdfcCsv.push(`31/02/${String(today.getFullYear()).slice(2)},"UPI/SWIGGY/0000000000/PAYMENT",${ref(12)},,350.00,,0.00`); // bad date row

  // ---------------- ICICI credit card (Apeksha) ----------------
  const cancelledAudibleMonth = monthsTotal - 3;
  const icici = [
    ...monthly(9, (d) => [d, `GOOGLE *YOUTUBEPREMIUM ${code()}`, 129]),
    ...every(91, addDays(start, 10), (d) => [d, `DISNEY HOTSTAR ${ref(6)}`, 299]),
    ...monthly(15, (d) => [d, `OPENAI *CHATGPT SUBSCR ${code()}`, 1999]),
    ...monthly(25, (d) => [d, `AUDIBLE INDIA ${ref(5)}`, 199]),
    ...monthly(3, (d, i) => [d, `APPLE.COM/BILL ICLOUD ${ref(4)}`, i >= icloudUpgrade ? 219 : 75]),
    ...randomly(2, (d) => [d, `MYNTRA DESIGNS ${ref(6)}`, between(700, 3500)]),
    ...randomly(2, (d) => [d, `FLIPKART INTERNET ${ref(6)}`, between(350, 6000)]),
    ...randomly(2, (d) => [d, `TRUFFLES RESTAURANT ${ref(4)}`, between(900, 2600)]),
  ];
  const mmt = addDays(today, -33);
  icici.push([mmt, `MAKEMYTRIP INDIA ${ref(6)}`, 4520], [mmt, `MAKEMYTRIP INDIA ${ref(6)}`, 4520]);
  const iciciRows = [
    ...icici.map(([d, n, a]) => ({ d, n, a, t: 'Dr' })),
    ...monthly(27, (d) => ({ d, n: 'PAYMENT RECEIVED - THANK YOU', a: between(8000, 15000), t: 'Cr' })),
  ].sort((a, b) => a.d - b.d);
  const iciciCsv = ['Transaction Date,Details,Amount (INR),Type,Reference Number'];
  for (const x of iciciRows) iciciCsv.push([fmt['DD-MM-YYYY'](x.d), `"${x.n}"`, x.a.toFixed(2), x.t, ref(11)].join(','));

  // ---------------- Paytm wallet JSON (Apeksha) ----------------
  const firstMonday = addDays(start, (8 - start.getDay()) % 7);
  const paytm = [
    ...every(7, firstMonday, (d) => ({ d, name: 'THE HINDU EPAPER', v: 30, cat: 'NEWS' })),
    ...every(7, addDays(firstMonday, 2), (d) => ({ d, name: 'COUNTRY DELIGHT MILK', v: 420, cat: 'GROCERY' })),
    ...randomly(5, (d) => ({ d, name: 'RAPIDO BIKE TAXI', v: between(45, 180), cat: 'TRAVEL' })),
    ...randomly(4, (d) => ({ d, name: 'NAMMA METRO RECHARGE', v: [200, 300, 500][between(0, 2)], cat: 'TRAVEL' })),
    ...randomly(5, (d) => ({ d, name: 'CHAI POINT', v: between(40, 160), cat: 'FOOD' })),
  ].sort((a, b) => a.d - b.d);
  const paytmJson = {
    statement: {
      wallet: 'Paytm', holder: 'Apeksha Ashok', currency: 'INR', generatedAt: new Date().toISOString(),
      transactions: [
        ...paytm.map((x) => ({
          id: `PTM${ref(10)}`, postedOn: `${iso(x.d)}T${pad(between(8, 21))}:${pad(between(0, 59))}:00+05:30`,
          direction: 'DEBIT', merchant: { name: x.name, category: x.cat, vpa: `${x.name.split(' ')[0].toLowerCase()}@paytm` },
          amount: { value: x.v, currency: 'INR' }, status: 'SUCCESS',
        })),
        ...monthly(2, (d) => ({ id: `PTM${ref(10)}`, postedOn: `${iso(d)}T09:00:00+05:30`, direction: 'CREDIT',
          merchant: { name: 'ADD MONEY FROM HDFC' }, amount: { value: 2000, currency: 'INR' }, status: 'SUCCESS' })),
      ],
    },
  };

  // ---------------- SBI savings (Avanthika) ----------------
  const sbi = [
    ...monthly(21, (d) => [d, `BY DEBIT CARD SPOTIFY INDIA ${ref(6)}`, 119]),
    ...monthly(6, (d) => [d, `TO SI COURSERA PLUS ${ref(6)}`, 3299], { fromMonth: 5 }),
    ...monthly(2, (d) => [d, `NACH GOLDS GYM ${ref(6)}`, 1500]),
    ...every(28, addDays(start, 6), (d) => [d, `UPI JIO PREPAID ${ref(8)}`, 239]),
    ...randomly(6, (d) => [d, `UPI SWIGGY ${ref(8)}`, between(150, 650)]),
    ...randomly(4, (d) => [d, `UPI UBER INDIA ${ref(8)}`, between(120, 540)]),
    ...randomly(4, (d) => [d, `UPI BLINKIT ${ref(8)}`, between(200, 1400)]),
  ];
  const sbiRows = [
    ...sbi.map(([d, n, a]) => ({ d, n, dr: a, cr: '' })),
    ...monthly(30, (d) => ({ d, n: 'BY TRANSFER SALARY', dr: '', cr: 62000 })),
  ].sort((a, b) => a.d - b.d);
  const sbiCsv = ['Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance'];
  let bal2 = 50000;
  for (const x of sbiRows) {
    bal2 += (x.cr || 0) - (x.dr || 0);
    sbiCsv.push([fmt['DD MMM YYYY'](x.d), fmt['DD MMM YYYY'](x.d), `"${x.n}"`, ref(10),
      x.dr === '' ? '' : x.dr.toFixed(2), x.cr === '' ? '' : x.cr.toFixed(2), bal2.toFixed(2)].join(','));
  }

  // ---------------- tiny generic CSV (format example) ----------------
  const generic = ['date,description,amount',
    ...monthly(7, (d) => `${iso(d)},LINKEDIN PREMIUM ${code()},1599`, { fromMonth: monthsTotal - 5 }),
    ...randomly(1, (d) => `${iso(d)},CROSSWORD BOOKSTORE,${between(300, 900)}`)];

  return {
    priceRiseMonth, gymStopMonth, cancelledAudibleMonth,
    files: [
      { owner: 'apeksha', account: 'HDFC Savings', filename: 'hdfc_savings.csv', content: hdfcCsv.join('\n') + '\n' },
      { owner: 'apeksha', account: 'ICICI Credit Card', filename: 'icici_credit_card.csv', content: iciciCsv.join('\n') + '\n' },
      { owner: 'apeksha', account: 'Paytm Wallet', filename: 'paytm_wallet.json', content: JSON.stringify(paytmJson, null, 2) + '\n' },
      { owner: 'avanthika', account: 'SBI Savings', filename: 'sbi_savings.csv', content: sbiCsv.join('\n') + '\n' },
      { owner: null, account: null, filename: 'generic_statement.csv', content: generic.join('\n') + '\n' },
    ],
  };
}

export function writeSamples(dir, today) {
  const out = generateSamples(today);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of out.files) fs.writeFileSync(path.join(dir, f.filename), f.content);
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'sample');
  const out = writeSamples(dir);
  console.log(`Wrote ${out.files.length} sample statements to ${dir}`);
}
