import { PaymentMode } from '../types';

export const PAYMENT_MODES: PaymentMode[] = [
  'Cash',
  'Credit Card',
  'Debit Card',
  'Zelle',
  'Apple Pay',
  'Other',
];

export const DEFAULT_PAYMENT_MODE: PaymentMode = 'Cash';
