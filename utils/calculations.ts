import { Transaction } from '../types';

function round(n: number) { return Math.round(n * 100) / 100; }

export function calculateSplit(amount: number, participantCount: number, includeMe: boolean) {
  if (participantCount <= 0) return { perPerson: 0, totalToCollect: 0, totalPeople: 1, myShare: 0 };
  if (includeMe) {
    const totalPeople = participantCount + 1;
    const perPerson = round(amount / totalPeople);
    const totalToCollect = round(perPerson * participantCount);
    return { perPerson, totalToCollect, totalPeople, myShare: round(amount - totalToCollect) };
  } else {
    const perPerson = round(amount / participantCount);
    return { perPerson, totalToCollect: amount, totalPeople: participantCount, myShare: 0 };
  }
}

// Returns per-person breakdown: { itemAmount, taxAmount, total } for each participant
export function getPersonBreakdown(transaction: Transaction): Record<string, { item: number; tax: number; total: number }> {
  const tax = transaction.tax ?? 0;
  const subtotal = transaction.amount; // amount is items-only; total = amount + tax
  const n = transaction.participants.length;
  const includeMe = transaction.includeMe ?? false;
  const people = includeMe ? n + 1 : n;

  // Step 1: item amounts per person
  const itemAmounts: Record<string, number> = {};
  if (transaction.splitType === 'custom' && transaction.customAmounts) {
    for (const p of transaction.participants) {
      itemAmounts[p] = transaction.customAmounts[p] ?? 0;
    }
  } else {
    const perPerson = people > 0 ? round(subtotal / people) : 0;
    for (const p of transaction.participants) {
      itemAmounts[p] = perPerson;
    }
  }

  // Step 2: tax amounts per person
  const taxAmounts: Record<string, number> = {};
  if (tax > 0) {
    const taxSplitType = transaction.taxSplitType ?? 'equal';
    if (taxSplitType === 'custom' && transaction.customTaxAmounts) {
      for (const p of transaction.participants) {
        taxAmounts[p] = transaction.customTaxAmounts[p] ?? 0;
      }
    } else if (taxSplitType === 'proportional') {
      const friendsItemTotal = Object.values(itemAmounts).reduce((s, v) => s + v, 0);
      // When payer is included, their item share is part of the subtotal too
      const totalItems = includeMe ? subtotal : friendsItemTotal;
      for (const p of transaction.participants) {
        taxAmounts[p] = totalItems > 0 ? round((itemAmounts[p] / totalItems) * tax) : 0;
      }
    } else {
      // equal tax
      const perTax = people > 0 ? round(tax / people) : 0;
      for (const p of transaction.participants) {
        taxAmounts[p] = perTax;
      }
    }
  } else {
    for (const p of transaction.participants) taxAmounts[p] = 0;
  }

  // Step 3: combine
  const result: Record<string, { item: number; tax: number; total: number }> = {};
  for (const p of transaction.participants) {
    const item = itemAmounts[p] ?? 0;
    const taxAmt = taxAmounts[p] ?? 0;
    result[p] = { item, tax: taxAmt, total: round(item + taxAmt) };
  }
  return result;
}

export function getTotalToCollect(transaction: Transaction): number {
  const breakdown = getPersonBreakdown(transaction);
  return round(Object.values(breakdown).reduce((s, v) => s + v.total, 0));
}

export function getTotalPending(transactions: Transaction[]): number {
  return round(
    transactions.filter(t => t.syncStatus === 'pending').reduce((s, t) => s + getTotalToCollect(t), 0)
  );
}

export function getOwedByFriend(transactions: Transaction[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const t of transactions) {
    if (t.syncStatus !== 'pending') continue;
    const breakdown = getPersonBreakdown(t);
    for (const [name, { total }] of Object.entries(breakdown)) {
      map[name] = (map[name] ?? 0) + total;
    }
  }
  const rounded: Record<string, number> = {};
  for (const [name, val] of Object.entries(map)) rounded[name] = round(val);
  return rounded;
}
