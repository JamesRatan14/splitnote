import type { PaymentMode, SplitType } from '../../types';

export type Category =
  | 'Food & Drink'
  | 'Groceries'
  | 'Transport'
  | 'Entertainment'
  | 'Travel'
  | 'Shopping'
  | 'Utilities'
  | 'Other';

export const CATEGORIES: Category[] = [
  'Food & Drink',
  'Groceries',
  'Transport',
  'Entertainment',
  'Travel',
  'Shopping',
  'Utilities',
  'Other',
];

/** Output of any expense parser (offline rules now, LLM proxy later). */
export interface ParsedExpense {
  title?: string;
  amount?: number;
  tax?: number;
  mode?: PaymentMode;
  date?: string; // YYYY-MM-DD
  participants: string[];
  includeMe: boolean;
  splitType: SplitType;
}

/** Minimal slice of Transaction the models need; keeps them decoupled from storage. */
export interface HistoryItem {
  title: string;
  amount: number;
  mode: PaymentMode;
  date: string;
  participants: string[];
}
