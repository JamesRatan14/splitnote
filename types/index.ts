export type PaymentMode = 'Cash' | 'Credit Card' | 'Debit Card' | 'Zelle' | 'Apple Pay' | 'Other';
export type SyncStatus = 'pending' | 'synced';
export type SplitType = 'equal' | 'custom';
export type TaxSplitType = 'equal' | 'proportional' | 'custom';

export interface Participant {
  name: string;
}

export interface Transaction {
  id: string;
  title: string;
  amount: number;           // Total amount paid by user ($)
  mode: PaymentMode;
  date: string;             // ISO date string: "YYYY-MM-DD"
  participants: string[];   // Array of friend names
  splitType: SplitType;
  includeMe: boolean;
  customAmounts?: Record<string, number>;
  tax?: number;                             // tax portion of the total amount
  taxSplitType?: TaxSplitType;             // how to split the tax
  customTaxAmounts?: Record<string, number>;
  note?: string;
  syncStatus: SyncStatus;
  createdAt: string;
}

export type NewTransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'syncStatus'>;
